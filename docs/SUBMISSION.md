# Submission notes

## One-liner

Manufact Brain: an MCP server that gives agents shared notes about any website, read before they browse and written after, kept lean by a librarian, with a cold-vs-warm benchmark that shows the gain.

## Description (short)

Every agent that lands on a website starts from zero. Manufact Brain keeps one page of notes per site: layout facts, verified paths (goal → steps), dead ends, login and bot walls, tips, each dated. An agent calls `site_notes` before it browses and `hand_in` after. A librarian merges every hand-in: a shorter verified path replaces a longer one, nothing repeats, lists stay capped, writes are versioned. Replays mark broken paths stale and healed ones fresh. `find_path` searches verified paths by meaning, `run_path` replays one in seconds, `explore` sends a team of browser agents to discover a new one with a judge checking screenshots. No account, no key: the server description and every tool tell an agent what to do next. Built with mcp-use, hosted on Manufact.

## Tracks

- Manufact: best MCP server for agents (built with mcp-use, deployed on Manufact).
- Armature: build something agents use (self-onboarding, no human in the loop). The server runs Armature MCP analytics, so every agent session is scored and replayable in the Armature dashboard.

## Links

- MCP URL: https://warm-steel-25plz.run.mcp-use.com/mcp
- Repo: https://github.com/BABTUNA/manufact-brain
- Brain page (notes, word for word, and the activity log): the bridge's `/brain`
- Gains page (cold vs warm): the bridge's `/gains`

## Works in multiple clients (Manufact track ask)

Same question ("how would an agent report a pothole on sf.gov, and which dead end should it avoid"), answered from the brain through:

- Claude Code: `docs/demo/claude-code.txt` (3 turns, one `site_notes` call)
- Codex CLI: `docs/demo/codex.txt` (`mcp: manufact-brain/site_notes (completed)`)
- mcp-use Inspector: `docs/demo/inspector-site-notes.jpg` (171 ms, 25 facts)
- mcp-use client CLI: `npx mcp-use client connect prod <url>` then `tools call site_notes`
- Cursor and VS Code: configs in the repo (`.cursor/mcp.json`, `.vscode/mcp.json`)

If the bridge tunnel drops (site_notes answers "fetch failed"): `bash bridge/scripts/tunnel.sh`.

## Live demo (2 minutes)

1. **Claude Code, fresh session.** `claude mcp add --transport http manufact-brain <url>`. Ask: "How do I report a pothole on sf.gov? Use Manufact Brain." Watch it call `site_notes`, read the known path, answer in one step.
2. **A site nobody knows.** Ask about a goal on a new site. `site_notes` says "you are the first agent here", the agent browses, then calls `hand_in`. Switch to the Brain page: the notes appear, with the log line "claude-code handed in".
3. **Second agent, same site.** New session, related goal. `site_notes` now has layout facts and the dead end; the agent goes straight there.
4. **Gains page.** Cold vs warm on held-out goals, side by side. "Same goals, same site, the only difference is the brain."
5. **Agent hands off to a person.** In Claude Code: "How do I report a pothole on sf.gov? Give me a Guide me link." Click the link; the guide page opens, Start guide, and the extension highlights Report a problem on the real site.
6. Close on the Manufact dashboard: sessions, tool calls, the server's listing.
