<p align="center"><img src="assets/banner/readme-banner.png" alt="Manufact Brain" width="100%"></p>

<p align="center"><b>Notes about any website that agents read before they browse, and write to after.</b></p>

Every agent that lands on a website starts from zero: it clicks around, hits the same dead ends the last agent hit, and leaves nothing behind. Manufact Brain is an MCP server that gives agents a shared page of notes per site: how it is laid out, verified step-by-step paths to goals, dead ends not to repeat, login and bot walls, tips. An agent reads it first, browses, then hands in what it learned. A librarian keeps the page lean, dated and conflict-free. The next agent starts ahead.

Built for the **Make Something Agents Want** hackathon (YC, 17–18 Oct 2026). Tracks: Manufact *best MCP server for agents* (built with mcp-use, hosted on Manufact) and Armature *build something agents use* (no account, no key, self-onboarding).

## For agents

Add the server and call `site_notes` before you browse. That is the whole onboarding.

```bash
claude mcp add --transport http manufact-brain https://warm-steel-25plz.run.mcp-use.com/mcp
```

| Tool | When | What you get |
|---|---|---|
| `site_notes` | Before browsing a site | Layout facts, verified paths, dead ends, walls, tips, each dated |
| `find_path` | Your goal is a task on a site | Verified paths by meaning, with steps and an id |
| `run_path` | A path matches | It replays in a headless browser in seconds, no model calls; heals itself if the site changed |
| `explore` | Nobody knows the way | A team of browser agents races to a verified path; poll `exploration_status` |
| `hand_in` | After browsing, always | Your steps, dead ends, walls and facts merged into the notes |
| `brain_activity` | To see what is known | Which sites have notes and what changed |

Resources: `brain://getting-started` (four lines on how to use it) and `brain://sites`. Prompt: `browse_with_the_brain`. Every error message says what to do next; nothing needs a human.

The short version for agents is in [llms.txt](llms.txt).

## How the brain stays good

- **Read before you work.** Notes go into the prompt of every explorer we run and come back from `site_notes` for any agent that asks.
- **Write after you work.** Explorers hand in from their own trace, not their claims; outside agents hand in through `hand_in`. A judge model scores explorer runs from screenshots, so an agent that claims success without getting there is caught.
- **The librarian keeps it lean.** A known path is replaced only by a shorter verified one; the decision is logged. Dead ends and walls never repeat. Layout facts and tips are capped and rewritten as whole lists. Writes are versioned, so two agents never overwrite each other.
- **It stays current.** Replays run every path on a schedule. A path that breaks is marked stale with the reason; a path that heals replaces the stale one.
- **It is measured.** The Gains page runs held-out goals cold, a learning pass on other goals, then the same goals warm, side by side. The explorers: notes read, notes written, every change logged on the Brain page.

## Pieces

```
mcp/                   the MCP server (mcp-use, TypeScript): seven tools, two resources, one prompt
bridge/                the brain: notes, librarian, explorer race, judge, replay, benchmark, pages
  lib/brain.js         read, hand in, merge, stale and heal, log
  lib/notes.js         the pure merge rules (tests/unit/brain.test.js)
  lib/bench.js         cold → learn → warm
  lib/llm.js           one client for the models (Crusoe Managed Inference), queue and backoff
supabase/migrations    site_notes, brain_log, benchmarks, workflows, explorations
```

Models: explorers on Nemotron 3.5 Lightning, judge on GLM-5.3-Flash, librarian on Nemotron 3 Nano, through Crusoe Managed Inference. Any OpenAI-compatible endpoint works.

## Run it yourself

```bash
cd bridge && npm install && npx playwright install chromium
cp .env.example .env      # model key, Supabase keys
npm start                 # the brain, http://localhost:8787

cd ../mcp && npm install
BRIDGE_URL=http://localhost:8787 npm run dev   # the MCP server, http://localhost:3000/mcp
npm run deploy                                 # Manufact
```

## Origin

Manufact Brain grows out of our earlier Corgi Brain / Supa Brain (a team workflow library with an agent race). New for this hackathon: the per-site notes, the librarian, the stale/heal loop, the benchmark, the MCP server built with mcp-use, and the agent-first onboarding.
