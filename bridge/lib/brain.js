// The shared brain: one living document of notes per site. Every explorer reads it before it
// works (renderNotes goes into its prompt) and hands back what it learned afterwards; the
// librarian merges the hand-ins into the notes, keeps them lean and dated, and logs every
// change. Replays mark a path stale when it breaks and refresh it when it heals.
import { chat } from "./llm.js";
import { config } from "./config.js";
import { db } from "./store.js";
import { CAPS, siteOf, emptyNotes, countFacts, renderNotes, handInOf, mergeNotes } from "./notes.js";
export { CAPS, siteOf, emptyNotes, countFacts, renderNotes, handInOf, mergeNotes };

const norm = (s) => String(s || "").toLowerCase().replace(/[^a-z0-9]+/g, " ").trim();
const now = () => new Date().toISOString();

export async function readNotes(site) {
  const { data, error } = await db.from("site_notes").select("doc, version").eq("site", site).limit(1);
  if (error) { console.warn("[brain] read:", error.message); return null; }
  return data?.[0] ? { ...emptyNotes(site), ...data[0].doc, version: data[0].version } : null;
}

export async function listNotes() {
  const { data, error } = await db.from("site_notes").select("doc, version, updated_at").order("updated_at", { ascending: false });
  if (error) throw new Error(`supabase: ${error.message}`);
  return data.map((r) => ({ ...emptyNotes(r.doc.site), ...r.doc, version: r.version }));
}

export async function logBrain(site, kind, summary, { explorationId = null, detail = null } = {}) {
  const { error } = await db.from("brain_log").insert({ site, kind, exploration_id: explorationId, summary: String(summary).slice(0, 500), detail });
  if (error) console.warn("[brain] log:", error.message);
}

export async function brainLog({ site = null, limit = 50 } = {}) {
  let q = db.from("brain_log").select("*").order("at", { ascending: false }).limit(limit);
  if (site) q = q.eq("site", site);
  const { data, error } = await q;
  if (error) throw new Error(`supabase: ${error.message}`);
  return data;
}


// ── The librarian ─────────────────────────────────────────────────────────────────────────
const LIBRARIAN = `You are the librarian of a team's shared notes about one website. Agents that just explored the site hand you what they saw. Rewrite the Layout and Tips lists so the next agent gets there faster.

Rules:
- Layout facts describe where things are (menus, search, footer links, URL patterns). Tips are short rules of thumb ("the search box only matches titles").
- Keep every existing fact that is still true. Drop a fact only if the hand-ins show it is wrong; list those under removed, quoting the fact.
- Prefer fewer, sharper facts. Never exceed ${CAPS.layout} layout facts or ${CAPS.tips} tips. One sentence each, under 140 characters.
- Do not repeat known paths, dead ends or walls: they are kept separately. A tip must not restate a layout fact or a path; if you have nothing extra to say, return an empty tips list.
- Plain strings only: no brackets, quotes or numbering around a fact.
- Do not invent anything the hand-ins or existing notes do not support.`;

const LIBRARIAN_SCHEMA = {
  type: "object",
  properties: {
    layout: { type: "array", items: { type: "string" } },
    tips: { type: "array", items: { type: "string" } },
    removed: { type: "array", items: { type: "string" } },
  },
  required: ["layout", "tips", "removed"],
  additionalProperties: false,
};

async function askLibrarian(notes, handIns, goal) {
  const content = [
    `Site: ${notes.site}\nGoal the agents were exploring: ${goal}`,
    `Existing layout facts:\n${notes.layout.map((x) => `- ${x.fact}`).join("\n") || "(none)"}`,
    `Existing tips:\n${notes.tips.map((x) => `- ${x.tip}`).join("\n") || "(none)"}`,
    `Hand-ins from the agents:\n${JSON.stringify(handIns.map((h) => ({ agent: h.agent + 1, strategy: h.strategy, outcome: h.outcome, judged: h.judged, summary: h.summary, pagesSeen: h.pages, path: h.paths[0]?.steps || null, deadEnds: h.deadEnds.map((d) => d.tried) })), null, 1)}`,
  ].join("\n\n");
  // Reasoning tokens count against max_tokens on these models, so leave plenty of room.
  const res = await chat({ model: config.fastModel, system: LIBRARIAN, content, schema: LIBRARIAN_SCHEMA, maxTokens: 6000 });
  if (res.finish === "length") throw new Error("librarian ran out of tokens");
  return { out: res.json(), cost: res.cost };
}

/** Write with optimistic concurrency: two races on one site never overwrite each other. */
async function writeNotes(notes, expectedVersion) {
  const version = (expectedVersion || 0) + 1;
  const doc = { ...notes, version };
  if (!expectedVersion) {
    const { error } = await db.from("site_notes").insert({ site: notes.site, doc, version });
    if (error) return null;
    return version;
  }
  const { data, error } = await db.from("site_notes").update({ doc, version, updated_at: now() }).eq("site", notes.site).eq("version", expectedVersion).select("version");
  if (error) { console.warn("[brain] write:", error.message); return null; }
  return data?.length ? version : null;
}

/**
 * After a race: every finished agent hands in, the librarian merges, the notes are written back.
 * Returns a summary for the exploration document. Never throws.
 */
export async function learn(ex, { workflowId = null } = {}) {
  const site = ex.site || siteOf(ex.url);
  const handIns = ex.agents.filter((a) => a.status === "done" || a.outcome).map((a) => handInOf(ex, a));
  if (!handIns.length) return null;
  let cost = 0, librarian = null;
  for (let attempt = 0; attempt < 3; attempt++) {
    const current = (await readNotes(site)) || emptyNotes(site);
    // No evidence, no librarian: agents that never saw a page have nothing to teach.
    const evidence = handIns.some((h) => h.pages.length || h.paths.length);
    if (!librarian && !evidence) librarian = { layout: current.layout.map((x) => x.fact), tips: current.tips.map((x) => x.tip), removed: [] };
    if (!librarian) {
      try { ({ out: librarian, cost } = await askLibrarian(current, handIns, ex.goal)); }
      catch (err) { console.warn("[brain] librarian:", err.message); librarian = { layout: current.layout.map((x) => x.fact), tips: current.tips.map((x) => x.tip), removed: [] }; }
    }
    const { notes, changes } = mergeNotes(current, handIns, { source: ex.id, librarian, workflowId });
    const version = await writeNotes(notes, current.version);
    if (version == null) { console.warn(`[brain] ${site}: version ${current.version} moved, merging again`); continue; }
    const before = countFacts(current), after = countFacts(notes);
    const bits = [];
    if (changes.pathsAdded) bits.push(`${changes.pathsAdded} new path${changes.pathsAdded > 1 ? "s" : ""}`);
    if (changes.pathsReplaced) bits.push(`${changes.pathsReplaced} path${changes.pathsReplaced > 1 ? "s" : ""} replaced by a shorter one`);
    if (changes.pathsConfirmed) bits.push(`${changes.pathsConfirmed} path${changes.pathsConfirmed > 1 ? "s" : ""} re-verified`);
    if (changes.deadEndsAdded) bits.push(`${changes.deadEndsAdded} dead end${changes.deadEndsAdded > 1 ? "s" : ""}`);
    if (changes.wallsAdded) bits.push(`${changes.wallsAdded} wall${changes.wallsAdded > 1 ? "s" : ""}`);
    if (changes.layoutRemoved.length) bits.push(`${changes.layoutRemoved.length} stale fact${changes.layoutRemoved.length > 1 ? "s" : ""} dropped`);
    const summary = `${handIns.length} agent${handIns.length > 1 ? "s" : ""} handed in after "${ex.goal}": ${bits.join(", ") || "nothing new"}. Notes v${version}: ${before} → ${after} facts.`;
    await logBrain(site, "merge", summary, { explorationId: ex.id, detail: { ...changes, before, after, version, cost: Math.round(cost * 1e5) / 1e5, handIns: handIns.map((h) => ({ agent: h.agent, outcome: h.outcome, judged: h.judged, paths: h.paths.length, deadEnds: h.deadEnds.length, walls: h.walls.length })) } });
    return { version, before, after, cost: Math.round(cost * 1e5) / 1e5, handIns: handIns.length, changes, summary };
  }
  await logBrain(site, "merge", `Could not write notes for ${site} after 3 tries (busy).`, { explorationId: ex.id });
  return null;
}

/** A replay broke on this path: tell the next agent so it finds a new way instead of trusting it. */
export async function markPathStale(site, workflowId, reason) {
  const n = await readNotes(site);
  const p = n?.paths.find((x) => x.workflowId === workflowId);
  if (!p || p.stale) return false;
  Object.assign(p, { stale: true, staleAt: now(), staleReason: String(reason || "").slice(0, 120) });
  if (await writeNotes(n, n.version) == null) return false;
  await logBrain(site, "stale", `Path "${p.goal}" broke on replay (${p.staleReason}); marked stale so agents stop trusting it.`, { detail: { workflowId } });
  return true;
}

/** A path healed: the fixed steps replace the stale ones. */
export async function refreshPath(site, wf) {
  const n = (await readNotes(site)) || emptyNotes(site);
  const steps = (wf.trail || []).filter((s) => s.kind !== "verify").map((s) => s.instruction);
  const i = n.paths.findIndex((x) => x.workflowId === wf.id || norm(x.goal) === norm(wf.task));
  const fresh = { goal: wf.task, url: wf.startUrl, steps, verifiedAt: now(), source: `heal:${wf.id}`, workflowId: wf.id };
  if (i < 0) n.paths.unshift(fresh); else n.paths[i] = fresh;
  if (await writeNotes(n, n.version) == null) return false;
  await logBrain(site, "heal", `Path "${wf.task}" healed; notes now carry the repaired ${steps.length}-step path.`, { detail: { workflowId: wf.id } });
  return true;
}

/**
 * A hand-in from any agent, not only our explorers: an MCP client that browsed a site with its
 * own tools reports what it found, in the same shape the librarian merges. Facts the agent
 * states outright (layout, tips) go through the same caps; a path is kept only with steps.
 */
export async function handInExternal({ url, goal, outcome = "reached", steps = [], deadEnds = [], walls = [], layout = [], tips = [], agent = "external agent", summary = "" }) {
  const site = siteOf(url);
  const clean = (xs, n = 160) => (Array.isArray(xs) ? xs : []).map((x) => String(x || "").trim().slice(0, n)).filter(Boolean).slice(0, 12);
  const h = {
    agent: 0, strategy: agent, outcome, judged: null, summary: String(summary).slice(0, 300), steps: clean(steps).length,
    paths: outcome === "reached" && clean(steps).length && goal ? [{ goal: String(goal).slice(0, 200), url, steps: clean(steps), length: clean(steps).length }] : [],
    deadEnds: clean(deadEnds).map((tried) => ({ tried, why: "" })),
    walls: clean(walls).map((what) => ({ what })),
    pages: [],
  };
  // New facts first, so when a list is at its cap the oldest fact drops, not the newest.
  const librarian = (current) => ({ layout: [...clean(layout), ...current.layout.map((x) => x.fact)], tips: [...clean(tips), ...current.tips.map((x) => x.tip)], removed: [] });
  const source = `handin:${String(agent).replace(/[^a-z0-9._-]+/gi, "-").slice(0, 40)}:${Date.now().toString(36)}`;
  for (let attempt = 0; attempt < 3; attempt++) {
    const current = (await readNotes(site)) || emptyNotes(site);
    const { notes, changes } = mergeNotes(current, [h], { source, librarian: librarian(current) });
    const version = await writeNotes(notes, current.version);
    if (version == null) continue;
    const before = countFacts(current), after = countFacts(notes);
    const nl = clean(layout).length, nt = clean(tips).length;
    const bits = [changes.pathsAdded && "1 new path", changes.pathsReplaced && "1 path replaced", changes.deadEndsAdded && `${changes.deadEndsAdded} dead end${changes.deadEndsAdded > 1 ? "s" : ""}`, changes.wallsAdded && `${changes.wallsAdded} wall${changes.wallsAdded > 1 ? "s" : ""}`, nl && `${nl} layout fact${nl > 1 ? "s" : ""}`, nt && `${nt} tip${nt > 1 ? "s" : ""}`].filter(Boolean);
    const summaryLine = `${agent} handed in after "${goal || url}": ${bits.join(", ") || "nothing new"}. Notes v${version}: ${before} → ${after} facts.`;
    await logBrain(site, "handin", summaryLine, { detail: { ...changes, before, after, version, agent } });
    return { site, version, before, after, changes, summary: summaryLine };
  }
  throw new Error("notes are busy, try again");
}

export async function resetNotes(site) {
  await db.from("site_notes").delete().eq("site", site);
  await logBrain(site, "reset", `Notes for ${site} were reset to empty.`);
}
