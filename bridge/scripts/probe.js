// Reproduces an explorer's first model call on a real page, across models, and prints what
// the endpoint answers. Usage: node scripts/probe.js https://www.sf.gov/ [model ...]
import { getBrowser, elements, TOOLS, SYSTEM } from "../lib/explorer.js";
import { llm } from "../lib/llm.js";
import { config } from "../lib/config.js";

const url = process.argv[2] || "https://www.sf.gov/";
const models = process.argv.slice(3).length ? process.argv.slice(3) : [config.model, "openai/gpt-oss-120b", "zai-org/GLM-5.3-Flash", "nvidia/NVIDIA-Nemotron-3-Nano-30B-A3B"];
const context = await (await getBrowser()).newContext({ viewport: { width: 1280, height: 900 } });
const page = await context.newPage();
await page.goto(url, { waitUntil: "domcontentloaded", timeout: 25000 });
await page.waitForTimeout(800);
const els = await elements(page);
const lines = els.map((e) => `[${e.idx}] ${e.tag}${e.field ? ` field="${e.field}"` : ""} "${e.text}"${e.href ? ` -> ${e.href.slice(0, 80)}` : ""}`);
const view = `URL: ${page.url()}\nTitle: ${await page.title()}\nElements:\n${lines.join("\n")}`;
console.log(`${els.length} elements, ${view.length} chars of view`);
const messages = [
  { role: "system", content: SYSTEM },
  { role: "user", content: `Goal: find how to report a pothole\nStart URL: ${url}\nStrategy for this attempt: Prefer the site's primary navigation and menus.\n\nThe browser is open on the start URL.\n\n${view}` },
];
for (const model of models) {
  for (const variant of [{ tools: TOOLS, temperature: 0, max_tokens: 4000 }, { tools: TOOLS, max_tokens: 4000 }]) {
    const t0 = Date.now();
    try {
      const res = await llm().chat.completions.create({ model, messages, ...variant });
      const m = res.choices[0].message;
      console.log(`${model} ${JSON.stringify({ strict: variant.tools[0].function.strict, temperature: variant.temperature, max_tokens: variant.max_tokens })}: OK ${Date.now() - t0} ms, finish=${res.choices[0].finish_reason}, tool=${m.tool_calls?.[0]?.function?.name} ${m.tool_calls?.[0]?.function?.arguments?.slice(0, 80) || ""}${!m.tool_calls ? ` text=${(m.content || "").slice(0, 80)}` : ""}`);
      break;
    } catch (err) {
      console.log(`${model} ${JSON.stringify({ strict: variant.tools[0].function.strict, temperature: variant.temperature, max_tokens: variant.max_tokens })}: ${err.status} ${String(err.message).slice(0, 200)}`);
    }
  }
}
await context.close();
process.exit(0);
