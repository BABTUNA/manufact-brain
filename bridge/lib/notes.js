// Pure notes logic for the shared brain: the shape of a site's notes, what an agent reads,
// what a finished agent hands in, and the librarian's merge. No database or model here, so it
// is unit-tested on its own; brain.js adds the storage and the model call.

// Lean by construction: hard caps per list and on the rendered size.
export const CAPS = { layout: 10, paths: 15, deadEnds: 10, walls: 5, tips: 8 };
const MAX_CHARS = 5000;
const LISTS = Object.keys(CAPS);

export const siteOf = (url) => { try { return new URL(url).hostname.replace(/^www\./, ""); } catch { return String(url || "").replace(/^www\./, ""); } };
const norm = (s) => String(s || "").toLowerCase().replace(/[^a-z0-9]+/g, " ").trim();
const now = () => new Date().toISOString();
const day = (iso) => (iso || "").slice(0, 10);

export const emptyNotes = (site) => ({ site, version: 0, layout: [], paths: [], deadEnds: [], walls: [], tips: [], updatedAt: null });
export const countFacts = (n) => (n ? LISTS.reduce((s, k) => s + (n[k]?.length || 0), 0) : 0);

/** What an agent reads before it works: short, dated, and honest about what broke. */
export function renderNotes(n) {
  if (!n || !countFacts(n)) return "";
  const when = (x) => (x.verifiedAt ? ` (verified ${day(x.verifiedAt)})` : "");
  const out = [`What the team already knows about ${n.site} (notes v${n.version}, ${countFacts(n)} facts):`];
  if (n.layout.length) out.push("Layout:", ...n.layout.map((x) => `- ${x.fact}${when(x)}`));
  const live = n.paths.filter((p) => !p.stale), broken = n.paths.filter((p) => p.stale);
  if (live.length) out.push("Known paths, goal: steps.", ...live.map((p) => `- ${p.goal}: ${p.steps.join(" → ")}${when(p)}`));
  if (broken.length) out.push("Paths that broke (the site changed, find a new way):", ...broken.map((p) => `- ${p.goal}: broke at "${p.staleReason || "unknown"}" on ${day(p.staleAt)}`));
  if (n.deadEnds.length) out.push("Dead ends, do not repeat:", ...n.deadEnds.map((x) => `- ${x.tried}${x.why ? ` (${x.why})` : ""}`));
  if (n.walls.length) out.push("Walls:", ...n.walls.map((x) => `- ${x.what}`));
  if (n.tips.length) out.push("Tips:", ...n.tips.map((x) => `- ${x.tip}`));
  return out.join("\n");
}

// ── Hand-ins: what one finished agent can report, without a model ─────────────────────────
export function handInOf(ex, a) {
  const h = { agent: a.i, strategy: a.strategy, outcome: a.outcome, judged: a.judgeSays ?? null, summary: a.summary || "", steps: a.steps || 0, paths: [], deadEnds: [], walls: [], pages: [] };
  if (a.outcome === "reached" && a.judgeSays !== false && a.trail?.length) {
    h.paths.push({ goal: ex.goal, url: ex.url, steps: a.trail.map((s) => s.instruction), length: a.trail.length });
  }
  for (const d of a.deadEndList || []) h.deadEnds.push({ tried: `${d.instruction} (from ${d.from || ex.url})`, why: "led away from the goal" });
  const last = a.frames?.length ? a.frames[a.frames.length - 1].url : ex.url;
  if (a.outcome === "login_required") h.walls.push({ what: `"${ex.goal}" needs a login (hit at ${last})` });
  if (a.outcome === "blocked") h.walls.push({ what: `bot protection at ${last}` });
  const seen = new Map();
  for (const t of a.trace || []) {
    const m = /^URL: (\S+)\nTitle: ([^\n]*)/.exec(t.out || "");
    if (m && !seen.has(m[1])) seen.set(m[1], m[2].slice(0, 80));
  }
  h.pages = [...seen].slice(0, 12).map(([url, title]) => ({ url, title }));
  return h;
}

const dedupe = (list, key) => {
  const seen = new Set();
  return list.filter((x) => { const k = norm(key(x)); if (!k || seen.has(k)) return false; seen.add(k); return true; });
};
const byNewest = (a, b) => String(b.verifiedAt || "").localeCompare(String(a.verifiedAt || ""));

/** Pure merge of hand-ins into notes. Returns { notes, changes }. The librarian output is optional. */
export function mergeNotes(current, handIns, { source, librarian = null, workflowId = null } = {}) {
  const at = now();
  const n = JSON.parse(JSON.stringify(current || emptyNotes("")));
  const ch = { pathsAdded: 0, pathsReplaced: 0, pathsConfirmed: 0, deadEndsAdded: 0, wallsAdded: 0, layoutRemoved: [], conflicts: [] };

  for (const h of handIns) {
    const src = `${source}#agent-${h.agent + 1}`;
    for (const p of h.paths) {
      const i = n.paths.findIndex((x) => norm(x.goal) === norm(p.goal));
      const incoming = { goal: p.goal, url: p.url, steps: p.steps.map((s) => String(s).slice(0, 160)), verifiedAt: at, source: src, ...(workflowId ? { workflowId } : {}) };
      if (i < 0) { n.paths.push(incoming); ch.pathsAdded++; continue; }
      const old = n.paths[i];
      if (old.stale || p.steps.length < old.steps.length) {
        ch.conflicts.push({ what: "path", goal: p.goal, kept: "incoming", why: old.stale ? "the saved path had broken" : `shorter (${p.steps.length} vs ${old.steps.length} steps)` });
        n.paths[i] = { ...incoming, workflowId: workflowId || old.workflowId };
        ch.pathsReplaced++;
      } else if (p.steps.length === old.steps.length && norm(p.steps.join(" ")) === norm(old.steps.join(" "))) {
        n.paths[i] = { ...old, verifiedAt: at, ...(workflowId ? { workflowId } : {}) };
        ch.pathsConfirmed++;
      } else {
        ch.conflicts.push({ what: "path", goal: p.goal, kept: "existing", why: `existing path is shorter or equal (${old.steps.length} vs ${p.steps.length} steps)` });
        n.paths[i] = { ...old, verifiedAt: at, ...(workflowId ? { workflowId } : {}) };
      }
    }
    for (const d of h.deadEnds) {
      if (n.deadEnds.some((x) => norm(x.tried) === norm(d.tried))) continue;
      n.deadEnds.push({ tried: String(d.tried).slice(0, 160), why: String(d.why || "").slice(0, 120), verifiedAt: at, source: src });
      ch.deadEndsAdded++;
    }
    for (const w of h.walls) {
      if (n.walls.some((x) => norm(x.what) === norm(w.what))) continue;
      n.walls.push({ what: String(w.what).slice(0, 160), verifiedAt: at, source: src });
      ch.wallsAdded++;
    }
  }

  if (librarian) {
    const removed = new Set((librarian.removed || []).map(norm));
    const keepOld = (list, key) => list.filter((x) => !removed.has(norm(key(x))));
    const mk = (texts, key, old, keyOld) => {
      const prior = new Map(old.map((x) => [norm(keyOld(x)), x]));
      return texts.filter((t) => typeof t === "string" && t.trim()).map((raw) => {
        // Models sometimes wrap a fact in brackets or quotes; the notes keep plain sentences.
        const t = raw.trim().replace(/^[("'\s]+|[)"'\s]+$/g, "").slice(0, 160);
        const p = prior.get(norm(t));
        return p ? { ...p, verifiedAt: at } : { [key]: t, verifiedAt: at, source };
      });
    };
    const oldLayout = keepOld(n.layout, (x) => x.fact), oldTips = keepOld(n.tips, (x) => x.tip);
    ch.layoutRemoved = n.layout.filter((x) => removed.has(norm(x.fact))).map((x) => x.fact);
    ch.tipsRemoved = n.tips.filter((x) => removed.has(norm(x.tip))).map((x) => x.tip);
    n.layout = mk(librarian.layout || [], "fact", oldLayout, (x) => x.fact);
    n.tips = mk(librarian.tips || [], "tip", oldTips, (x) => x.tip);
    // Never let the librarian silently drop facts it did not list as removed.
    for (const x of oldLayout) if (!n.layout.some((y) => norm(y.fact) === norm(x.fact))) n.layout.push(x);
    for (const x of oldTips) if (!n.tips.some((y) => norm(y.tip) === norm(x.tip))) n.tips.push(x);
  }

  // Lean: dedupe, newest first, hard caps, then a size cap on what agents will read.
  n.layout = dedupe(n.layout, (x) => x.fact).sort(byNewest).slice(0, CAPS.layout);
  n.tips = dedupe(n.tips, (x) => x.tip).sort(byNewest).slice(0, CAPS.tips);
  n.deadEnds = dedupe(n.deadEnds, (x) => x.tried).sort(byNewest).slice(0, CAPS.deadEnds);
  n.walls = dedupe(n.walls, (x) => x.what).sort(byNewest).slice(0, CAPS.walls);
  n.paths = dedupe(n.paths, (x) => x.goal).sort((a, b) => (a.stale === b.stale ? byNewest(a, b) : a.stale ? 1 : -1)).slice(0, CAPS.paths);
  for (const k of ["tips", "deadEnds", "layout"]) while (renderNotes(n).length > MAX_CHARS && n[k].length > 2) n[k].pop();
  n.updatedAt = at;
  return { notes: n, changes: ch };
}

