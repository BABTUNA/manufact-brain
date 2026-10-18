// The librarian's merge is pure: hand-ins land as dated facts, shorter paths win, dead ends
// never repeat, caps keep the notes lean, and the rendered text is what agents read.
import { describe, it, expect } from "vitest";
import { mergeNotes, renderNotes, handInOf, emptyNotes, countFacts, CAPS } from "../../bridge/lib/notes.js";

const ex = { id: "ex1", goal: "find the pricing page", url: "https://example.com", agents: [] };
const agent = (over = {}) => ({ i: 0, strategy: "menus", status: "done", outcome: "reached", judgeSays: true, summary: "on pricing",
  trail: [{ instruction: "Click Pricing" }], deadEndList: [{ instruction: "Click Blog", from: "/" }], trace: [{ out: "URL: https://example.com/\nTitle: Example\nElements:" }], frames: [], ...over });

describe("hand-ins", () => {
  it("reports the path, dead ends and pages an agent saw", () => {
    const h = handInOf(ex, agent());
    expect(h.paths[0].steps).toEqual(["Click Pricing"]);
    expect(h.deadEnds[0].tried).toContain("Click Blog");
    expect(h.pages).toEqual([{ url: "https://example.com/", title: "Example" }]);
  });
  it("keeps no path when the judge disagreed", () => {
    expect(handInOf(ex, agent({ judgeSays: false })).paths).toEqual([]);
  });
  it("turns login and bot walls into wall facts", () => {
    expect(handInOf(ex, agent({ outcome: "login_required", trail: [] })).walls[0].what).toMatch(/needs a login/);
  });
});

describe("merge", () => {
  it("adds a path, a dead end and layout facts from the librarian", () => {
    const { notes, changes } = mergeNotes(emptyNotes("example.com"), [handInOf(ex, agent())], { source: "ex1", librarian: { layout: ["Top menu has Pricing"], tips: [], removed: [] }, workflowId: "wf1" });
    expect(changes.pathsAdded).toBe(1);
    expect(notes.paths[0].workflowId).toBe("wf1");
    expect(notes.deadEnds).toHaveLength(1);
    expect(notes.layout[0].fact).toBe("Top menu has Pricing");
    expect(renderNotes(notes)).toContain("Known paths");
  });
  it("replaces a path only with a shorter one and records the conflict", () => {
    const first = mergeNotes(emptyNotes("example.com"), [handInOf(ex, agent({ trail: [{ instruction: "Click Menu" }, { instruction: "Click Pricing" }] }))], { source: "a" }).notes;
    const longer = mergeNotes(first, [handInOf(ex, agent({ trail: [{ instruction: "A" }, { instruction: "B" }, { instruction: "C" }] }))], { source: "b" });
    expect(longer.notes.paths[0].steps).toEqual(["Click Menu", "Click Pricing"]);
    expect(longer.changes.conflicts[0].kept).toBe("existing");
    const shorter = mergeNotes(first, [handInOf(ex, agent())], { source: "c" });
    expect(shorter.notes.paths[0].steps).toEqual(["Click Pricing"]);
    expect(shorter.changes.pathsReplaced).toBe(1);
  });
  it("never repeats a dead end and keeps facts the librarian forgot to list", () => {
    const base = mergeNotes(emptyNotes("example.com"), [handInOf(ex, agent())], { source: "a", librarian: { layout: ["Fact one", "Fact two"], tips: ["Tip"], removed: [] } }).notes;
    const again = mergeNotes(base, [handInOf(ex, agent())], { source: "b", librarian: { layout: ["Fact one"], tips: [], removed: ["Fact two"] } });
    expect(again.notes.deadEnds).toHaveLength(1);
    expect(again.notes.layout.map((x) => x.fact)).toEqual(["Fact one"]);
    expect(again.changes.layoutRemoved).toEqual(["Fact two"]);
    expect(again.notes.tips.map((x) => x.tip)).toEqual(["Tip"]);
  });
  it("stays lean under the caps", () => {
    const many = Array.from({ length: 30 }, (_, i) => handInOf({ ...ex, goal: `goal ${i}` }, agent({ i, deadEndList: [{ instruction: `Click ${i}`, from: "/" }] })));
    const { notes } = mergeNotes(emptyNotes("example.com"), many, { source: "x", librarian: { layout: Array.from({ length: 30 }, (_, i) => `fact ${i}`), tips: [], removed: [] } });
    expect(notes.paths.length).toBeLessThanOrEqual(CAPS.paths);
    expect(notes.deadEnds.length).toBeLessThanOrEqual(CAPS.deadEnds);
    expect(notes.layout.length).toBeLessThanOrEqual(CAPS.layout);
    expect(countFacts(notes)).toBeLessThanOrEqual(Object.values(CAPS).reduce((a, b) => a + b));
    expect(renderNotes(notes).length).toBeLessThan(5200);
  });
  it("renders stale paths as broken so agents look for a new way", () => {
    const n = { ...emptyNotes("example.com"), version: 3, paths: [{ goal: "find pricing", steps: ["Click Pricing"], stale: true, staleAt: "2026-10-17T00:00:00Z", staleReason: "Pricing link gone" }] };
    expect(renderNotes(n)).toMatch(/broke at "Pricing link gone"/);
  });
});
