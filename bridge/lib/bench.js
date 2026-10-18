// Measures what the shared brain is worth. A benchmark runs the same test goals on one site
// twice: cold (agents read nothing and write nothing) and warm (agents read the notes that
// earlier races built), with a learning pass on separate training goals in between. The test
// goals are held out, so the warm gain comes from layout facts, tips and dead ends, not from
// a memorized path. Every race is a normal exploration, saved and watchable like any other.
import { startExploration } from "./explore.js";
import { getExploration, flushExploration, db } from "./store.js";
import { resetNotes, readNotes, countFacts, siteOf } from "./brain.js";
import { config } from "./config.js";

let running = null;
export const benchRunning = () => running?.id || null;
const round = (n, d = 2) => (n == null ? null : Math.round(n * 10 ** d) / 10 ** d);

export function metricsOf(ex) {
  const win = ex.winner ? ex.agents[ex.winner.agent] : null;
  return {
    goal: ex.goal, explorationId: ex.id, status: ex.status, found: Boolean(ex.winner),
    steps: win?.steps ?? null,
    deadEnds: ex.agents.reduce((n, a) => n + (a.deadEnds || 0), 0),
    actions: ex.agents.reduce((n, a) => n + (a.trace?.length || 0), 0),
    reached: ex.agents.filter((a) => a.outcome === "reached" && a.judgeSays !== false).length,
    agents: ex.agents.length,
    seconds: ex.finishedAt ? round((new Date(ex.finishedAt) - new Date(ex.startedAt)) / 1000, 0) : null,
    cost: round(ex.cost || 0, 4),
    brain: ex.brain || null,
    learned: ex.learned ? { version: ex.learned.version, before: ex.learned.before, after: ex.learned.after } : null,
  };
}

export function summarize(runs) {
  const done = runs.filter((r) => r.status && !["running", "judging", "learning"].includes(r.status));
  const found = done.filter((r) => r.found);
  const avg = (xs) => (xs.length ? round(xs.reduce((n, x) => n + x, 0) / xs.length, 2) : null);
  return {
    races: done.length, found: found.length, foundRate: done.length ? round(found.length / done.length, 2) : null,
    steps: avg(found.map((r) => r.steps)),
    deadEnds: avg(done.map((r) => r.deadEnds)),
    actions: avg(done.map((r) => r.actions)),
    reachedAgents: avg(done.map((r) => r.reached / r.agents)),
    seconds: avg(done.map((r) => r.seconds).filter((x) => x != null)),
    cost: avg(done.map((r) => r.cost)),
  };
}

async function save(b) {
  b.updatedAt = new Date().toISOString();
  for (const phase of ["cold", "learn", "warm"]) b.summary[phase] = summarize(b.runs[phase]);
  const { error } = await db.from("benchmarks").upsert({ id: b.id, doc: b, site: b.site, status: b.status, started_at: b.startedAt, updated_at: b.updatedAt });
  if (error) console.warn("[bench] save:", error.message);
}

const sleep = (ms) => new Promise((r) => setTimeout(r, ms));
async function race(b, phase, goal, useBrain) {
  const ex = await startExploration({ goal, url: b.url, agents: b.agents, useBrain, bench: { id: b.id, phase } });
  const slot = { ...metricsOf(ex), status: "running" };
  b.runs[phase].push(slot);
  b.current = { phase, goal, explorationId: ex.id };
  await save(b);
  for (let i = 0; i < 600; i++) {
    await sleep(2000);
    const now = await getExploration(ex.id);
    if (!now) continue;
    Object.assign(slot, metricsOf(now));
    if (!["running", "judging", "learning"].includes(now.status)) break;
    if (i % 5 === 0) await save(b);
  }
  await flushExploration(ex.id);
  await save(b);
  return slot;
}

export async function runBenchmark({ name, url, train, test, agents, reset = true }) {
  if (running) { const e = new Error(`a benchmark is already running (${running.id})`); e.status = 409; throw e; }
  const site = siteOf(url);
  const b = {
    id: `${site.replace(/[^a-z0-9]+/gi, "-")}-${Date.now().toString(36)}`,
    name: name || `${site} · ${test.length} held-out goals`, site, url,
    agents: Math.max(1, Math.min(Number(agents) || config.exploreAgents, 6)),
    train, test, reset: Boolean(reset),
    status: "running", phase: "cold", current: null,
    runs: { cold: [], learn: [], warm: [] }, summary: {}, notes: { before: 0, afterLearn: 0, afterWarm: 0 },
    startedAt: new Date().toISOString(), finishedAt: null,
  };
  running = b;
  await save(b);
  (async () => {
    try {
      if (b.reset) await resetNotes(site);
      b.notes.before = countFacts(await readNotes(site));
      b.phase = "cold"; await save(b);
      for (const goal of test) await race(b, "cold", goal, false);
      b.phase = "learn"; await save(b);
      for (const goal of train) await race(b, "learn", goal, true);
      b.notes.afterLearn = countFacts(await readNotes(site));
      b.phase = "warm"; await save(b);
      for (const goal of test) await race(b, "warm", goal, true);
      b.notes.afterWarm = countFacts(await readNotes(site));
      b.status = "done";
    } catch (err) {
      console.error("[bench]", err);
      b.status = "failed"; b.error = err.message;
    } finally {
      b.current = null;
      b.finishedAt = new Date().toISOString();
      await save(b);
      running = null;
      console.log(`[bench] ${b.id}: ${b.status} cold ${JSON.stringify(b.summary.cold)} warm ${JSON.stringify(b.summary.warm)}`);
    }
  })();
  return b;
}

export async function getBenchmark(id) {
  const { data, error } = await db.from("benchmarks").select("doc").eq("id", String(id)).limit(1);
  if (error) throw new Error(`supabase: ${error.message}`);
  return data?.[0]?.doc || null;
}

export async function listBenchmarks() {
  const { data, error } = await db.from("benchmarks").select("doc").order("started_at", { ascending: false }).limit(50);
  if (error) throw new Error(`supabase: ${error.message}`);
  return data.map((r) => r.doc);
}
