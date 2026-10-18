// Manufact Brain MCP server: notes about any website that agents read before they browse and write
// to after. Built with mcp-use, hosted on Manufact. Every tool talks to the Manufact Brain bridge
// (BRIDGE_URL), which keeps the notes in Postgres, runs explorer agents in headless browsers,
// and merges every hand-in with a librarian.
import { MCPServer } from "mcp-use";
import { z } from "zod";
import { withArmature } from "./analytics.js";

const BRIDGE = (process.env.BRIDGE_URL || "http://localhost:8790").replace(/\/+$/, "");
const NAME = "Manufact Brain";

const server = new MCPServer({
  name: "manufact-brain",
  title: NAME,
  version: "1.0.0",
  description: [
    "Shared notes about websites for agents. Before you browse a site, call site_notes to get what other agents already learned there: how it is laid out, verified step-by-step paths to goals, dead ends not to repeat, login and bot walls, tips.",
    "After you browse, call hand_in with what you found, so the next agent starts ahead of you. A librarian merges every hand-in: shorter verified paths win, nothing repeats, every fact is dated, broken paths are marked stale.",
    "If nobody knows the way yet, find_path searches verified paths by meaning, and explore sends a team of browser agents to discover one while you wait. No account, no key: start with site_notes.",
  ].join(" "),
});

// ── helpers ───────────────────────────────────────────────────────────────────────────────
const siteOf = (url: string) => {
  try { return new URL(url).hostname.replace(/^www\./, ""); } catch { return url.replace(/^https?:\/\//, "").replace(/^www\./, "").split("/")[0]; }
};
const withScheme = (url: string) => (/^https?:\/\//.test(url) ? url : `https://${url}`);

async function bridge<T = any>(path: string, init?: RequestInit): Promise<T> {
  const res = await fetch(`${BRIDGE}${path}`, { ...init, headers: { "content-type": "application/json", ...(init?.headers || {}) } });
  const text = await res.text();
  let body: any = null;
  try { body = JSON.parse(text); } catch { body = { error: text.slice(0, 300) }; }
  if (!res.ok) throw new Error(body?.error || `${res.status} from the Manufact Brain bridge at ${BRIDGE}`);
  return body as T;
}

const ok = (text: string, structuredContent?: Record<string, unknown>) => ({ content: [{ type: "text" as const, text }], ...(structuredContent ? { structuredContent } : {}) });
const fail = (err: unknown) => ({ content: [{ type: "text" as const, text: `Manufact Brain could not do that: ${(err as Error).message}. If the bridge is unreachable, try again in a minute; nothing else is required from you.` }], isError: true as const });

const pathLines = (steps: string[]) => steps.map((s, i) => `${i + 1}. ${s}`).join("\n");
// A page on the bridge with a Start guide button: with the Manufact Brain Chrome extension
// installed, it opens the site and highlights each step in the person's own browser.
const guideUrl = (id: string) => `${BRIDGE}/guide/${encodeURIComponent(id)}`;
const GUIDE_HINT = "If a person wants to be walked through it in their own browser, give them the Guide me link: it highlights each step on the real site (needs the Manufact Brain Chrome extension).";

// ── 1. read before you browse ───────────────────────────────────────────────────────────────
export const siteNotes = server.tool(
  {
    name: "site_notes",
    description: "Call this FIRST, before browsing any website. Returns the team notes for the site: layout facts, verified paths (goal → steps) with Guide me links for people, dead ends to avoid, login/bot walls and tips, each with the date it was last verified. Empty notes mean nobody has been here yet: browse, then call hand_in so the next agent benefits. Free, no account needed.",
    inputSchema: z.object({ url: z.string().describe("The site or page you are about to browse, e.g. https://docs.python.org/3/ or sf.gov") }),
    annotations: { readOnlyHint: true, openWorldHint: true },
  },
  async ({ url }) => {
    try {
      const site = siteOf(withScheme(url));
      const n = await bridge<{ site: string; version: number; facts: number; text: string; doc: any }>(`/brain/${encodeURIComponent(site)}.json`);
      const paths = (n.doc?.paths || []).map((p: any) => ({ goal: p.goal, steps: p.steps, stale: Boolean(p.stale), ...(p.workflowId && !p.stale ? { workflowId: p.workflowId, guideUrl: guideUrl(p.workflowId) } : {}) }));
      const guides = paths.filter((p: any) => p.guideUrl).map((p: any) => `- ${p.goal}: ${p.guideUrl}`).join("\n");
      const text = n.facts
        ? `${n.text}${guides ? `\n\nGuide me links (walk a person through a known path in their own browser):\n${guides}` : ""}\n\nUse these notes: follow a known path when one fits your goal, never repeat a listed dead end, and treat facts as true unless the page proves otherwise. When you are done, call hand_in with what you learned.`
        : `No notes for ${site} yet. You are the first agent here. Browse normally, then call hand_in with the steps that worked, any dead ends and anything about the layout worth knowing, so the next agent starts ahead of you.`;
      return ok(text, { site, version: n.version, facts: n.facts, text: n.text, paths });
    } catch (err) { return fail(err); }
  },
);

// ── 2. find a verified path ─────────────────────────────────────────────────────────────────
export const findPath = server.tool(
  {
    name: "find_path",
    description: "Search the library of verified paths by meaning. Each path is a short list of steps a person or agent can follow on a site, recorded by a teammate or discovered by agents and checked by a judge from screenshots. Use it when your goal is a task on a website ('cancel a subscription on X', 'find the glossary on Y'). Returns the best matches with their steps, a replay id for run_path, and a Guide me link a person can click to be walked through the path in their own browser.",
    inputSchema: z.object({
      goal: z.string().describe("What you want to do, in plain words"),
      site: z.string().optional().describe("Limit to one site, e.g. github.com"),
      limit: z.number().int().min(1).max(10).default(3),
    }),
    annotations: { readOnlyHint: true },
  },
  async ({ goal, site, limit }) => {
    try {
      const hits = await bridge<any[]>(`/search/all?q=${encodeURIComponent(goal)}&n=${limit * (site ? 3 : 1)}`);
      const matches = hits
        .filter((h) => !site || h.site === siteOf(withScheme(site)))
        .slice(0, limit)
        .map((h) => ({ id: h.id, task: h.task, site: h.site, steps: h.steps || [], taughtBy: h.taughtBy || "human", score: h.score, guideUrl: guideUrl(h.id) }));
      if (!matches.length) return ok(`No verified path matches "${goal}"${site ? ` on ${site}` : ""}. Call site_notes for the site's layout and tips, browse yourself, or call explore to send agents to discover a path.`, { matches: [] });
      const text = matches.map((m) => `${m.task} (${m.site}, ${m.taughtBy === "agent" ? "discovered by agents" : "recorded by a teammate"}, id ${m.id}):\n${pathLines(m.steps)}\nGuide me: ${m.guideUrl}`).join("\n\n");
      return ok(`${text}\n\n${GUIDE_HINT} To have the path replayed in a headless browser instead (seconds, no model calls), call run_path with the id.`, { matches });
    } catch (err) { return fail(err); }
  },
);

// ── 3. replay a path ────────────────────────────────────────────────────────────────────────
export const runPath = server.tool(
  {
    name: "run_path",
    description: "Replay a verified path from find_path in a headless browser and return what the final page says. Takes seconds and makes no model calls. If the site changed and a step no longer matches, the path heals itself (an explorer agent repairs it and a judge checks the repair) and the notes are updated. Agents never log in; paths that need a login stop at the login wall.",
    inputSchema: z.object({ id: z.string().describe("The path id from find_path"), inputs: z.record(z.string(), z.string()).optional().describe("Values for steps that take input, by field name") }),
    annotations: { readOnlyHint: false, destructiveHint: false, idempotentHint: true, openWorldHint: true },
  },
  async ({ id, inputs }) => {
    try {
      const r = await bridge<any>(`/workflows/${encodeURIComponent(id)}/run`, { method: "POST", body: JSON.stringify({ inputs: inputs || {}, caller: "mcp" }) });
      const steps = (r.steps || []).map((s: any) => `${s.n}. ${s.instruction} [${s.status}]`).join("\n");
      const text = r.ok
        ? `Reached the end of "${r.task}" in ${r.seconds}s${r.healed ? " (the path had broken and healed itself)" : ""}.\nFinal page: ${r.title || ""} ${r.finalUrl}\n\n${steps}\n\nGuide me (walk a person through it in their own browser): ${guideUrl(id)}\n\nPage text (excerpt):\n${String(r.pageText || "").slice(0, 1500)}`
        : `The path "${r.task}" broke at step ${r.failedAt}: ${r.reason}.${r.healFailed ? ` Repair failed: ${r.healFailed}.` : ""} The notes now mark it stale. Call site_notes and browse the last working page yourself, then hand_in the new steps.`;
      return ok(text, { ok: r.ok, workflowId: r.workflowId, seconds: r.seconds, healed: r.healed, failedAt: r.failedAt ?? null, finalUrl: r.finalUrl, title: r.title, guideUrl: guideUrl(id) });
    } catch (err) { return fail(err); }
  },
);

// ── 4. send agents to discover a path ───────────────────────────────────────────────────────
export const explore = server.tool(
  {
    name: "explore",
    description: "Send a team of browser agents to a public site to discover how to reach a goal. They read the site's notes first, race in separate headless browsers, a judge scores every run from screenshots, and the shortest verified path is saved to the library and the notes. Takes one to three minutes; poll exploration_status with the returned id. Only for public pages: agents never log in or create accounts.",
    inputSchema: z.object({
      goal: z.string().max(300).describe("What to find or do, e.g. 'find how to report a pothole'"),
      url: z.string().describe("Where to start, e.g. https://www.sf.gov/"),
      agents: z.number().int().min(1).max(6).default(3).describe("How many agents race (default 3)"),
    }),
    annotations: { readOnlyHint: false, destructiveHint: false, openWorldHint: true },
  },
  async ({ goal, url, agents }) => {
    try {
      const ex = await bridge<any>(`/explore`, { method: "POST", body: JSON.stringify({ goal, url: withScheme(url), agents }) });
      const facts = ex.brain?.facts || 0;
      return ok(`${agents} agents are exploring ${siteOf(withScheme(url))} for "${goal}"${facts ? `, starting from ${facts} facts in the notes` : ", starting from zero (no notes yet)"}. Exploration id: ${ex.id}. Poll exploration_status with this id every 20 seconds or so; watch it live at ${BRIDGE}/explore/${ex.id}.`, { id: ex.id, watchUrl: `${BRIDGE}/explore/${ex.id}`, notesRead: facts });
    } catch (err) { return fail(err); }
  },
);

export const explorationStatus = server.tool(
  {
    name: "exploration_status",
    description: "Check on an exploration started with explore. Returns each agent's outcome and, once finished, the winning path's steps and its id for run_path, plus what the librarian wrote back to the notes.",
    inputSchema: z.object({ id: z.string() }),
    annotations: { readOnlyHint: true },
  },
  async ({ id }) => {
    try {
      const ex = await bridge<any>(`/explorations/${encodeURIComponent(id)}`);
      const agents = ex.agents.map((a: any) => `agent ${a.i + 1}: ${a.status === "done" ? a.outcome : a.status}${a.steps != null ? `, ${a.steps} steps` : ""}${a.judgeSays === false ? " (judge disagreed)" : a.judgeSays === true ? " (judge agreed)" : ""}`).join("\n");
      const running = ["running", "judging", "learning"].includes(ex.status);
      let text = `Exploration "${ex.goal}" on ${ex.site}: ${ex.status}.\n${agents}`;
      let winner: any = null;
      if (ex.winner) {
        const a = ex.agents[ex.winner.agent];
        winner = { workflowId: ex.winner.workflowId, steps: (a.trail || []).map((s: any) => s.instruction), guideUrl: guideUrl(ex.winner.workflowId) };
        text += `\n\nWinning path (id ${ex.winner.workflowId}):\n${pathLines(winner.steps)}\nGuide me: ${winner.guideUrl}\n\nCall run_path with that id to replay it, follow the steps yourself, or give a person the Guide me link.`;
      } else if (!running) text += `\n\nNo verified path. ${ex.status === "login_required" ? "The goal sits behind a login." : ex.status === "blocked" ? "The site blocked the agents (bot protection)." : "The agents could not reach the goal; try a more specific goal or a closer start URL."}`;
      if (ex.learned?.summary) text += `\n\nNotes: ${ex.learned.summary}`;
      if (running) text += `\n\nStill working; check again in about 20 seconds.`;
      return ok(text, { status: ex.status, running, winner, cost: ex.cost, learned: ex.learned?.summary || null });
    } catch (err) { return fail(err); }
  },
);

// ── 5. write after you browse ───────────────────────────────────────────────────────────────
export const handIn = server.tool(
  {
    name: "hand_in",
    description: "Call this AFTER browsing a site, whether or not you reached your goal. Report the steps that worked (they become a known path for the goal), dead ends you backed out of, login or bot walls you hit, and anything about the layout worth knowing. The librarian merges it into the site's notes: a shorter verified path replaces a longer one, nothing repeats, lists stay capped. Takes a second. This is how the next agent starts ahead of you.",
    inputSchema: z.object({
      url: z.string().describe("The site you browsed, e.g. https://www.sf.gov/"),
      goal: z.string().max(200).describe("What you were trying to do"),
      outcome: z.enum(["reached", "gave_up", "login_required", "blocked"]).default("reached"),
      steps: z.array(z.string().max(160)).max(12).default([]).describe("The steps that worked, one short imperative each ('Click Services in the top menu'); leave empty if you did not reach the goal"),
      dead_ends: z.array(z.string().max(160)).max(12).default([]).describe("Things you tried that led away from the goal"),
      walls: z.array(z.string().max(160)).max(5).default([]).describe("Login walls, captchas, bot protection you hit"),
      layout: z.array(z.string().max(160)).max(10).default([]).describe("Facts about where things are on the site, one sentence each"),
      tips: z.array(z.string().max(160)).max(8).default([]).describe("Rules of thumb for this site, one sentence each"),
      agent: z.string().max(60).default("mcp agent").describe("Who you are, e.g. 'claude-code' or 'cursor'"),
    }),
    annotations: { readOnlyHint: false, destructiveHint: false, idempotentHint: false },
  },
  async ({ url, goal, outcome, steps, dead_ends, walls, layout, tips, agent }) => {
    try {
      const r = await bridge<any>(`/brain/handin`, { method: "POST", body: JSON.stringify({ url: withScheme(url), goal, outcome, steps, deadEnds: dead_ends, walls, layout, tips, agent }) });
      return ok(`Thanks. ${r.summary} Read them any time with site_notes.`, { site: r.site, version: r.version, before: r.before, after: r.after, summary: r.summary });
    } catch (err) { return fail(err); }
  },
);

// ── 6. what changed ─────────────────────────────────────────────────────────────────────────
export const brainActivity = server.tool(
  {
    name: "brain_activity",
    description: "Recent activity on the shared notes: which agents read which site, what they handed in, what the librarian merged, which paths broke or healed. Useful to see whether a site is well known before you plan.",
    inputSchema: z.object({ site: z.string().optional(), limit: z.number().int().min(1).max(50).default(15) }),
    annotations: { readOnlyHint: true },
  },
  async ({ site, limit }) => {
    try {
      const r = await bridge<any>(`/brain.json?limit=${limit}${site ? `&site=${encodeURIComponent(siteOf(withScheme(site)))}` : ""}`);
      const sites = (r.sites || []).map((s: any) => `${s.site}: ${s.facts} facts (v${s.version}), ${s.counts.paths} paths, ${s.counts.deadEnds} dead ends`).join("\n");
      const log = (r.log || []).map((e: any) => `${e.at.slice(0, 16).replace("T", " ")} ${e.kind.padEnd(6)} ${e.summary}`).join("\n");
      return ok(`Sites with notes:\n${sites || "(none yet)"}\n\nRecent activity:\n${log || "(nothing yet)"}`, { sites: r.sites?.map((s: any) => ({ site: s.site, facts: s.facts, version: s.version })) || [], log: r.log || [] });
    } catch (err) { return fail(err); }
  },
);

// ── resources and a prompt, for clients that read before they call ─────────────────────────
server.resource(
  { name: "getting-started", uri: "brain://getting-started", mimeType: "text/markdown", description: "How an agent uses Manufact Brain, in four lines." },
  async (uri) => ({
    contents: [{
      uri: uri.href, mimeType: "text/markdown",
      text: `# Manufact Brain for agents\n\n1. Before you browse a site, call \`site_notes\` with its URL. Follow a known path if one fits; never repeat a listed dead end.\n2. If your goal is a task on a site, try \`find_path\` first; replay a match with \`run_path\` (seconds, no model calls).\n3. If nobody knows the way, call \`explore\` and poll \`exploration_status\`; agents race in headless browsers and a judge verifies the result.\n4. After you browse, call \`hand_in\` with what worked and what did not. The next agent starts ahead of you.\n\nNo account, no key, nothing to install. Notes live at ${BRIDGE}/brain.`,
    }],
  }),
);

server.resource(
  { name: "sites", uri: "brain://sites", mimeType: "application/json", description: "Every site with notes, with fact counts and versions." },
  async (uri) => {
    const r = await bridge<any>(`/brain.json?limit=1`).catch(() => ({ sites: [] }));
    return { contents: [{ uri: uri.href, mimeType: "application/json", text: JSON.stringify((r.sites || []).map((s: any) => ({ site: s.site, facts: s.facts, version: s.version, updatedAt: s.updatedAt, counts: s.counts })), null, 2) }] };
  },
);

server.prompt(
  {
    name: "browse_with_the_brain",
    description: "Do a task on a website the Manufact Brain way: read the notes, act, hand in.",
    schema: z.object({ goal: z.string(), url: z.string() }),
  },
  async ({ goal, url }) => ({
    messages: [{
      role: "user",
      content: { type: "text", text: `Goal: ${goal}\nSite: ${url}\n\nFirst call site_notes for the site and read it. If a known path fits, follow it (or replay it with run_path). Otherwise call find_path; if nothing matches, browse the site yourself using the layout facts and avoiding the dead ends, or call explore and poll exploration_status. When you are done, whatever the outcome, call hand_in with the steps that worked, the dead ends, any walls, and layout facts worth keeping. Then report the result to me.` },
    }],
  }),
);

// Armature analytics: scored sessions for every agent that uses the server (off without a key).
withArmature(server);

export default server;
