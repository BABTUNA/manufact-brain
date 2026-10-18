// Explore mode: race N explorer agents (models on Crusoe), each with its own browser and strategy, toward a
// goal on a public site. Every step is saved as it happens (the race page listens
// through Realtime); afterwards a judge model scores each run, and the shortest path the judge
// agrees reached the goal is saved to the library.
import { config } from "./config.js";
import { runExplorer } from "./explorer.js";
import { judgeAgent } from "./judge.js";
import { saveExploration, flushExploration, getExploration, saveWorkflow, uniqueId, slugify } from "./store.js";
import { embed, workflowText } from "./embed.js";
import { rankTrails } from "./trail.js";
import { announce } from "./ask.js";
import { siteOf, readNotes, renderNotes, countFacts, logBrain, learn } from "./brain.js";

const STRATEGIES = [
  "Prefer the site's primary navigation and menus.",
  "Prefer the site search box first, then refine.",
  "Prefer links whose text closely matches the goal wording.",
  "Prefer footer and sitemap links.",
  "Explore breadth-first: open the two most promising links before committing.",
  "Prefer the most specific deep link you can see on the current page.",
];

const round = (n) => Math.round(n * 10000) / 10000;

export async function startExploration({ goal, url, agents, useBrain = true, bench = null }) {
  const n = Math.max(1, Math.min(agents || config.exploreAgents, STRATEGIES.length));
  const site = siteOf(url);
  // Read before you work: every agent in this race gets the team's notes for the site.
  const notes = useBrain ? await readNotes(site).catch(() => null) : null;
  const facts = countFacts(notes);
  const ex = {
    id: `${slugify(goal).slice(0, 48)}-${Date.now().toString(36)}`,
    goal, url, site, mode: "crusoe", model: config.model, judgeModel: config.judgeModel,
    useBrain, brain: notes ? { version: notes.version, facts, paths: notes.paths.filter((p) => !p.stale).length } : { version: 0, facts: 0, paths: 0 },
    brainText: renderNotes(notes), learned: null, ...(bench ? { bench } : {}),
    status: "running", startedAt: new Date().toISOString(), winner: null, cost: 0,
    agents: STRATEGIES.slice(0, n).map((strategy, i) => ({ i, strategy, status: "queued", outcome: null, steps: null, deadEnds: null, trail: null })),
  };
  const save = () => { ex.cost = round(ex.agents.reduce((s, a) => s + (a.cost || 0), 0) + (ex.learned?.cost || 0)); saveExploration(ex); };
  save();
  await flushExploration(ex.id);
  if (useBrain) logBrain(site, "read", notes ? `${n} agents read ${facts} facts (notes v${notes.version}) before exploring "${goal}".` : `${n} agents found no notes for ${site} yet; exploring "${goal}" from zero.`, { explorationId: ex.id, detail: { facts, version: notes?.version || 0 } });

  (async () => {
    await Promise.all(ex.agents.map((a) => runExplorer({ ex, a, save }).catch((err) => {
      Object.assign(a, { status: "error", outcome: "error", error: err.message });
      save();
    })));

    ex.status = "judging"; save();
    await Promise.all(ex.agents.filter((a) => a.trail?.length || a.outcome === "reached").map((a) =>
      judgeAgent(ex, a).catch((err) => console.warn(`[judge] agent ${a.i}: ${err.message}`)).finally(save)));

    // A run wins only if the agent says it reached the goal and the judge agrees (or could not judge).
    const ranked = rankTrails(ex.agents.filter((a) => a.outcome === "reached" && a.judgeSays !== false));
    if (ranked.length) {
      const best = ranked[0];
      const wf = {
        id: await uniqueId(goal),
        task: goal[0].toUpperCase() + goal.slice(1),
        site: new URL(url).hostname.replace(/^www\./, ""),
        startUrl: url,
        taughtBy: "agent",
        agentCount: ex.agents.length,
        explorationId: ex.id,
        recordedBy: `agent-${best.i + 1}`,
        recordedAt: new Date().toISOString(),
        synonyms: "",
        cleanedBy: config.model,
        trail: best.trail.map((s, i) => ({ n: i + 1, ...s })),
      };
      await saveWorkflow(wf, await embed(workflowText(wf)).catch(() => null));
      announce(wf, "discovered");
      ex.winner = { agent: best.i, workflowId: wf.id };
    }
    const final = ex.winner ? "done"
      : ex.agents.some((a) => a.outcome === "login_required") ? "login_required"
      : ex.agents.some((a) => a.outcome === "blocked") && ex.agents.every((a) => ["blocked", "error"].includes(a.outcome)) ? "blocked"
      : "failed";

    // Write after you work: the agents hand in, the librarian merges, the notes move on.
    if (useBrain) {
      ex.status = "learning"; save();
      ex.learned = await learn(ex, { workflowId: ex.winner?.workflowId || null }).catch((err) => { console.warn("[brain] learn:", err.message); return null; });
      if (ex.learned) ex.cost = round(ex.cost + (ex.learned.cost || 0));
    }
    ex.status = final;
    ex.finishedAt = new Date().toISOString();
    save();
    await flushExploration(ex.id);
    console.log(`[explore] ${ex.id}: ${ex.status}${ex.winner ? ` → ${ex.winner.workflowId}` : ""} ($${ex.cost})`);
  })().catch((err) => { console.error("[explore]", err); ex.status = "failed"; ex.error = err.message; save(); });

  return ex;
}

export { getExploration };
