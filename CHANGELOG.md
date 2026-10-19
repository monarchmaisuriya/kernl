# Changelog

All notable changes to kernl are recorded here. The format follows [Keep a Changelog](https://keepachangelog.com/en/1.1.0/), and versions follow [Semantic Versioning](https://semver.org/spec/v2.0.0.html): before 1.0.0, a breaking change raises the minor version. Add a line under "Unreleased" with every change people will notice; see [releasing](docs/development/releasing.md).

## [Unreleased]

### Added

- kernl's own agent reuses your Claude Code, Codex, and OpenCode setup: skills, Claude Code commands (as skills), subagents, CLAUDE.md and `.claude/rules`, OpenCode instructions, MCP servers, and enabled Claude Code plugins. Switch each kind in Settings > kernl > Sources. Project files load only in trusted workspaces, and a project's MCP server asks once before it first starts.
- **kernl: Show loaded sources** lists what loaded from where, and what didn't and why (OAuth servers, plugin hooks, Claude Code workflows), with names only, never a configured value.
- CLI agents use kernl's terminal, background jobs, and integrated browser through a local MCP server with kernl's approvals. With `kernl.terminal.cliAgents` set to `kernl` (the default), Claude Code's and OpenCode's commands run in the visible kernl terminal; Codex keeps its shell, and its command output shows in a read-only terminal and in the command's row.
- Settings in modules: Sources (one group per agent), MCP, Terminal, and Browser, including `kernl.mcp.toolTimeoutSeconds`, `kernl.terminal.outputLimit`, and `kernl.browser.timeoutSeconds`.
- `kernl.mcpServers` accepts `headers` for remote servers.
- Message actions: Copy, Restore, and Fork under your messages; Copy and Fork under replies.
- Previews in tool rows: thumbnails for images a tool reads or makes, file chips for grouped reads, and site chips for fetched pages and web search hits.
- The panel shows the agent's thinking, live tool calls, its plan, and a context usage ring.
- Permission modes per agent (Ask before edits, Edit automatically, Plan, Auto, Bypass), applied at kernl's gate or on the CLI agent's session and confirmed.
- Multi-root windows: each folder is its own workspace with its own agent.
- Read-only shell lookups (grep, rg, find, ls, cat, head, tail, wc, sed -n) fold into one "Explored" line.
- This changelog, versions, and `npm run release`.

### Changed

- The project is now kernl (it was YourStack): settings and commands are `kernl.*`, folders `~/.kernl` and `.kernl/`.
- Menus open next to the control that opened them, with search for long lists.
- Tool rows read as one plain line; failures read "Failed: ..." in red; a "Working" shimmer shows the elapsed time.
- Each MCP server connects on its own: one that fails or doesn't answer in time is a notice, and the others still load.
- Each folder and worktree gets its own named kernl terminal; agent commands run with no pager.

### Fixed

- Browser actions no longer wait forever on a page that doesn't answer, and the browser reconnects after its tab or connection drops without opening a second tab.
- A command with huge output no longer holds all of it in memory: only the end is kept while it streams.
- Saving a conversation reads it before anything else runs, so New Chat keeps the last state, and previews are saved into their own conversation.
- Writes of one conversation are serialized, so concurrent saves can't leave a half-written file.
- A late update from an agent no longer turns a finished tool row back into a running one.
- Drops on the panel read every format VS Code offers; text files from Finder attach by content; a drop that attaches nothing says why. (Dragging from VS Code's Explorer is broken upstream in VS Code 1.140 and later: use `@` or **Add to kernl chat**.)
- Long attachment names and command titles no longer break the composer or tool row layout.
- Restore points include files inside nested git repositories.

## [0.1.0] - 2026-10-18

### Added

- A VS Code chat panel running its own coding agent (LangChain Deep Agents) with your own model keys: Anthropic, OpenAI, Google, DeepSeek, OpenAI-compatible servers, and custom providers. Keys are kept in VS Code's SecretStorage.
- Claude Code, Codex, and OpenCode in the same panel over the Agent Client Protocol, using your existing logins.
- Every edit, command, browser action, and MCP tool call waits for your approval, with diffs for edits, and approval rules for what may skip a card.
- Commands run in VS Code's integrated terminal; browser tools drive VS Code's integrated browser.
- Workspaces on git worktrees, conversation history, queued messages, checkpoints with restore, and forking.
- `AGENTS.md`, `.kernl/rules`, named agents, and Agent Skills.

[Unreleased]: https://github.com/pushowl/kernl/compare/v0.1.0...HEAD
[0.1.0]: https://github.com/pushowl/kernl/releases/tag/v0.1.0
