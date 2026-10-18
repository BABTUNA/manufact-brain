// Every model call goes through Crusoe Managed Inference: one OpenAI-compatible endpoint that
// serves open models. The explorers, the judge, the Ask room, the librarian and recording cleanup
// all share this client; which model each one uses is set in config.js.
import OpenAI from "openai";
import { config } from "./config.js";

// Crusoe caps how many requests a project may have in flight (429 "max_requests_limit"), so every
// call goes through one queue: at most `config.concurrency` at a time, and a 429 or 503 waits and
// goes again instead of failing the agent.
let inFlight = 0;
const waiting = [];
const sleep = (ms) => new Promise((r) => setTimeout(r, ms));
async function withSlot(fn) {
  if (inFlight >= config.concurrency) await new Promise((r) => waiting.push(r));
  inFlight++;
  try {
    for (let attempt = 0; ; attempt++) {
      try { return await fn(); }
      catch (err) {
        if (!(err?.status === 429 || err?.status === 503) || attempt >= 8) throw err;
        const wait = Math.round(Math.min(30000, 1500 * 2 ** attempt) * (0.7 + Math.random() * 0.6));
        console.warn(`[llm] ${err.status} (${inFlight} in flight, ${waiting.length} waiting); retry ${attempt + 1} in ${wait} ms`);
        await sleep(wait);
      }
    }
  } finally {
    inFlight--;
    waiting.shift()?.();
  }
}

let client = null;
export function llm() {
  if (!config.crusoeKey) throw new Error("CRUSOE_API_KEY is not set");
  if (!client) {
    const raw = new OpenAI({ apiKey: config.crusoeKey, baseURL: config.crusoeBaseUrl, maxRetries: 0 });
    const create = raw.chat.completions.create.bind(raw.chat.completions);
    raw.chat.completions.create = (...args) => withSlot(() => create(...args));
    client = raw;
  }
  return client;
}
export const llmStats = () => ({ inFlight, waiting: waiting.length, concurrency: config.concurrency });

// USD per million tokens: input, output, cached input (Crusoe serverless pricing).
export const PRICE = {
  "nvidia/NVIDIA-Nemotron-3-Super-120B-A12B": [0.3, 2.4, 0.15],
  "nvidia/NVIDIA-Nemotron-3-Nano-30B-A3B": [0.05, 0.2, 0.03],
  "nvidia/Nemotron-3.5-Lightning-30B-A3B": [0.05, 0.2, 0.03],
  "openai/gpt-oss-120b": [0.05, 0.2, 0.05],
  "google/gemma-4-31b-it": [0.14, 0.4, 0.14],
  "deepseek-ai/Deepseek-V4-Flash": [0.14, 0.28, 0.03],
  "zai-org/GLM-5.3-Flash": [0.15, 0.5, 0.03],
};
export function costOf(model, usage = {}) {
  const [i, o, c] = PRICE[model] || [0.3, 2.4, 0.15];
  const cached = usage.prompt_tokens_details?.cached_tokens || 0;
  const fresh = Math.max(0, (usage.prompt_tokens || 0) - cached);
  return (fresh * i + cached * c + (usage.completion_tokens || 0) * o) / 1e6;
}

// Pull the first JSON object out of a model reply (tolerates code fences and reasoning preambles).
export function extractJson(text) {
  const stripped = String(text).replace(/<think>[\s\S]*?<\/think>/g, "").replace(/```(?:json)?/gi, "").trim();
  const match = stripped.match(/\{[\s\S]*\}/);
  if (!match) throw new Error(`model returned non-JSON: ${stripped.slice(0, 160)}`);
  return JSON.parse(match[0]);
}

const textOf = (res) => {
  const m = res.choices?.[0]?.message || {};
  return (m.content || "").trim() || (m.reasoning_content || m.reasoning || "").trim();
};

/**
 * One chat completion. `content` is a string or OpenAI content parts (text / image_url).
 * With `schema` the model is asked for structured JSON (falls back to free text + extraction
 * when the model rejects response_format). Returns { text, json(), usage, cost, raw }.
 */
export async function chat({ model = config.model, system, content, messages, maxTokens = 1500, schema = null, temperature = 0 }) {
  const msgs = messages || [...(system ? [{ role: "system", content: system }] : []), { role: "user", content }];
  const base = { model, messages: msgs, max_tokens: maxTokens, temperature };
  let res;
  try {
    res = await llm().chat.completions.create(schema
      ? { ...base, response_format: { type: "json_schema", json_schema: { name: "answer", schema, strict: true } } }
      : base);
  } catch (err) {
    if (!schema || !(err.status === 400 || err.status === 403)) throw err;
    res = await llm().chat.completions.create({ ...base, messages: [...msgs, { role: "user", content: `Answer with one JSON object matching this schema and nothing else:\n${JSON.stringify(schema)}` }] });
  }
  const text = textOf(res);
  const usage = res.usage || {};
  return { text, json: () => extractJson(text), usage, cost: costOf(model, usage), raw: res, finish: res.choices?.[0]?.finish_reason };
}

export const askJson = (opts) => chat(opts);

export const imagePart = (url) => ({ type: "image_url", image_url: { url } });
export const b64Image = (b64, mime = "image/jpeg") => imagePart(`data:${mime};base64,${b64}`);

// Fetch an image ourselves and inline it, so the model host never has to reach the URL.
export async function inlineImage(url) {
  const res = await fetch(url);
  if (!res.ok) throw new Error(`image ${res.status}`);
  const mime = res.headers.get("content-type")?.split(";")[0] || "image/jpeg";
  return b64Image(Buffer.from(await res.arrayBuffer()).toString("base64"), mime);
}
