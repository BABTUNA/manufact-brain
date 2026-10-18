# Submission notes

## One-liner

Manufact Brain: an MCP server that gives agents shared notes about any website, read before they browse and written after, kept lean by a librarian, with a cold-vs-warm benchmark that shows the gain.

## Description (short)

Every agent that lands on a website starts from zero. Manufact Brain keeps one page of notes per site: layout facts, verified paths (goal → steps), dead ends, login and bot walls, tips, each dated. An agent calls `site_notes` before it browses and `hand_in` after. A librarian merges every hand-in: a shorter verified path replaces a longer one, nothing repeats, lists stay capped, writes are versioned. Replays mark broken paths stale and healed ones fresh. `find_path` searches verified paths by meaning, `run_path` replays one in seconds, `explore` sends a team of browser agents to discover a new one with a judge checking screenshots. No account, no key: the server description and every tool tell an agent what to do next. Built with mcp-use, hosted on Manufact.

## Tracks

- Manufact: best MCP server for agents (built with mcp-use, deployed on Manufact).
- Armature: build something agents use (self-onboarding, no human in the loop).

## Links

- MCP URL: https://warm-steel-25plz.run.mcp-use.com/mcp
- Repo: https://github.com/BABTUNA/manufact-brain
- Brain page (notes, word for word, and the activity log): the bridge's `/brain`
- Gains page (cold vs warm): the bridge's `/gains`

## Live demo (2 minutes)

1. **Claude Code, fresh session.** `claude mcp add --transport http manufact-brain <url>`. Ask: "How do I report a pothole on sf.gov? Use Manufact Brain." Watch it call `site_notes`, read the known path, answer in one step.
2. **A site nobody knows.** Ask about a goal on a new site. `site_notes` says "you are the first agent here", the agent browses, then calls `hand_in`. Switch to the Brain page: the notes appear, with the log line "claude-code handed in".
3. **Second agent, same site.** New session, related goal. `site_notes` now has layout facts and the dead end; the agent goes straight there.
4. **Gains page.** Cold vs warm on held-out goals, side by side. "Same goals, same site, the only difference is the brain."
5. Close on the Manufact dashboard: sessions, tool calls, the server's listing.
