// Loads settings for the bridge. Keys come from the shell or from bridge/.env and never leave
// this process, except the public read key, which is public by design (RLS guards reads).
import { readFileSync, existsSync } from "node:fs";
import { join, dirname } from "node:path";
import { fileURLToPath } from "node:url";

const here = dirname(fileURLToPath(import.meta.url));
export const BRIDGE_DIR = join(here, "..");

function readEnvFile(path) {
  if (!existsSync(path)) return {};
  const out = {};
  for (const line of readFileSync(path, "utf8").split("\n")) {
    const m = line.match(/^\s*([A-Z0-9_]+)\s*=\s*(.*)\s*$/);
    if (m) out[m[1]] = m[2].replace(/^['"]|['"]$/g, "");
  }
  return out;
}

const localEnv = readEnvFile(join(BRIDGE_DIR, ".env"));
const env = (k, d = "") => process.env[k] || localEnv[k] || d;

export const config = {
  port: Number(env("PORT", 8787)),
  publicUrl: env("PUBLIC_URL", "http://localhost:8787"),
  // Set when served under a path prefix, e.g. "/compute/v1/bridge" on the hosted deployment.
  basePath: env("BASE_PATH", "").replace(/\/+$/, ""),
  // Crusoe Managed Inference: one OpenAI-compatible endpoint for every model below.
  crusoeKey: env("CRUSOE_API_KEY"),
  crusoeBaseUrl: env("CRUSOE_BASE_URL", "https://api.inference.crusoecloud.com/v1"),
  // The explorer agents (tool calling) and recording cleanup.
  // Nemotron 3 Super allows one request in flight on the free tier, which serialises a race;
  // Lightning allows several and is built for long agent loops.
  model: env("EXPLORER_MODEL", "nvidia/Nemotron-3.5-Lightning-30B-A3B"),
  // Scores every explorer's run from its screenshots after the race, so it must read images.
  // GLM-5.3-Flash answers in seconds; Gemma 4 rambled to its token cap on some verdicts.
  judgeModel: env("JUDGE_MODEL", "zai-org/GLM-5.3-Flash"),
  // The Ask room, the librarian and the vision fallback: cheap and quick.
  fastModel: env("FAST_MODEL", "nvidia/NVIDIA-Nemotron-3-Nano-30B-A3B"),
  // Requests in flight at once across every model; Crusoe returns 429 above the project's cap.
  concurrency: Math.max(1, Number(env("CRUSOE_CONCURRENCY", 2))),
  exploreAgents: Number(env("EXPLORE_AGENTS", 3)),
  maxActions: Number(env("EXPLORE_MAX_ACTIONS", 25)),
  // Shared secret the brain keeper (an Agent37 agent) sends as x-keeper-token.
  keeperToken: env("KEEPER_TOKEN"),
  supabaseUrl: env("SUPABASE_URL"),
  supabaseAnonKey: env("SUPABASE_ANON_KEY"),
  supabaseServiceKey: env("SUPABASE_SERVICE_ROLE_KEY"),
};

if (!config.supabaseUrl || !config.supabaseServiceKey) {
  console.error("[config] SUPABASE_URL and SUPABASE_SERVICE_ROLE_KEY are required in bridge/.env");
  process.exit(1);
}
