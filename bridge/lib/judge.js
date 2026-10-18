// After the race, a judge model that can read images judges every finished agent from what it actually
// saw (its last screenshots) and the path it recorded, so an agent that claims success without
// reaching the goal gets caught. Verdicts use the same shape the pages render as chips.
import { chat, inlineImage } from "./llm.js";
import { config } from "./config.js";

const SCHEMA = {
  type: "object",
  properties: {
    reached_goal: { type: "boolean" },
    goal_reasoning: { type: "string" },
    instructions: { type: "integer", description: "1-5: can a person follow each step as written?" },
    instructions_reasoning: { type: "string" },
    directness: { type: "integer", description: "1-5: 5 means no dead ends or wasted steps." },
    directness_reasoning: { type: "string" },
  },
  required: ["reached_goal", "goal_reasoning", "instructions", "instructions_reasoning", "directness", "directness_reasoning"],
  additionalProperties: false,
};

const clamp = (n) => Math.max(1, Math.min(5, Math.round(Number(n) || 1)));

export async function judgeAgent(ex, a) {
  const shots = (a.frames || []).filter((f) => f.cmd !== "back").slice(-2);
  const steps = (a.trail || []).map((s, i) => `${i + 1}. ${s.instruction}`).join("\n") || "(no steps)";
  const content = [
    ...(await Promise.all(shots.map((f) => inlineImage(f.src).catch(() => null)))).filter(Boolean),
    { type: "text", text: `Goal: ${ex.goal}\nStart URL: ${ex.url}\nThe agent says: ${a.outcome}${a.summary ? ` (${a.summary})` : ""}\nDead ends it backed out of: ${a.deadEnds || 0}\n\nRecorded path for a person to follow:\n${steps}\n\nThe images are the agent's last screenshots, final one last. Judge from the screenshots, not from the agent's claim.` },
  ];
  const res = await chat({
    model: config.judgeModel,
    maxTokens: 3000,
    schema: SCHEMA,
    system: "You judge browser agents that try to find a path to a goal on a website. Be strict and brief: one sentence per reasoning field.",
    content,
  });
  if (res.finish === "length") throw new Error("judge ran out of tokens");
  const v = res.json();
  a.cost = Math.round(((a.cost || 0) + res.cost) * 10000) / 10000;
  a.evals = [
    { slug: "reached-goal", passed: Boolean(v.reached_goal), rating: null, reasoning: v.goal_reasoning },
    { slug: "clean-instructions", passed: null, rating: clamp(v.instructions), reasoning: v.instructions_reasoning },
    { slug: "no-wasted-actions", passed: null, rating: clamp(v.directness), reasoning: v.directness_reasoning },
  ];
  a.judgeSays = Boolean(v.reached_goal);
}
