// Smoke test for the Crusoe endpoint: lists the models we rely on, then runs one tool call
// with the explorer model, one structured answer with the fast model, and one image read with
// the judge. Run: node scripts/smoke.js
import { readFileSync } from "node:fs";
import { llm, chat, b64Image } from "../lib/llm.js";
import { config } from "../lib/config.js";

const want = [config.model, config.judgeModel, config.fastModel];
const models = await llm().models.list();
const byId = new Map(models.data.map((m) => [m.id, m]));
for (const id of want) {
  const m = byId.get(id);
  console.log(m ? `ok   ${id}  tools=${(m.supported_parameters || []).includes("tools")} response_format=${(m.supported_parameters || []).includes("response_format")} modality=${m.architecture?.modality || "?"}` : `MISSING ${id}`);
}
if (!want.every((id) => byId.has(id))) {
  console.log("\nAvailable:\n" + models.data.map((m) => `  ${m.id}`).join("\n"));
}

const t0 = Date.now();
const tc = await llm().chat.completions.create({
  model: config.model, max_tokens: 500, temperature: 0,
  tools: [{ type: "function", function: { name: "click", description: "Click an element by idx.", parameters: { type: "object", properties: { idx: { type: "integer" }, instruction: { type: "string" } }, required: ["idx", "instruction"], additionalProperties: false } } }],
  messages: [{ role: "system", content: "Use your tools." }, { role: "user", content: 'Elements:\n[0] a "Home"\n[1] a "Pricing"\nGoal: open pricing. Click it.' }],
});
console.log(`tool call (${Date.now() - t0} ms):`, JSON.stringify(tc.choices[0].message.tool_calls?.[0]?.function), "usage", tc.usage);

const j = await chat({ model: config.fastModel, system: "Answer briefly.", content: "Give the capital of France.", schema: { type: "object", properties: { answer: { type: "string" } }, required: ["answer"], additionalProperties: false } });
console.log("json:", j.json(), `$${j.cost.toFixed(5)}`);

const png = readFileSync(new URL("../assets/icons/icon-256.png", import.meta.url)).toString("base64");
const img = await chat({ model: config.judgeModel, maxTokens: 200, content: [b64Image(png, "image/png"), { type: "text", text: "What is in this image? One sentence." }] });
console.log("image:", img.text.slice(0, 200));
