# Connections

**kernl: Show connections** (also in the panel's `...` menu, and the warning button beside the agent chip) lists everything kernl depends on, with its state, what its source said, when it was last checked, and a fix:

| Group | What | Checked with |
| --- | --- | --- |
| Agents | kernl's own agent (provider and model), Claude Code, Codex, OpenCode | kernl's settings; `claude auth status --json` and `--text`, `codex login status`, `opencode auth list` |
| Keys | keys stored in kernl: each provider's, and Claude Code's or Codex's | the provider's model list (`GET /models`): no tokens spent |
| MCP servers | kernl's own, and each agent's (claude.ai connectors appear under Claude Code) | kernl's connect; `claude mcp list`, `codex mcp list --json`, `opencode mcp list` |
| Plugins | Claude Code's installed plugins | `claude plugin list --json` |

## States

- **Ready:** works as far as kernl can tell.
- **Needs you:** won't work until you act (log in, set a key, sign in to a server). The agent chip shows a warning button, and a message to that agent stops with the fix.
- **Failed:** tried and broke (a server that won't connect).
- **Can't tell:** a status kernl couldn't read. It never blocks.
- **Off:** turned off, or a project MCP server you haven't allowed yet.

A row being checked shows "Checking…" and keeps its last known state meanwhile.

## Read-only checks

kernl only runs the status commands above, each with the same binary and environment it launches the agent with (including a key stored in kernl, or your `kernl.agentCommands`). They never log in or out, change config, or send a prompt. A real prompt would make a CLI refresh and rewrite its stored login.

## When statuses update

- **Logins:**
  - at startup, and when you come back to VS Code;
  - when a login or config file changes (`~/.claude.json`, `~/.claude/.credentials.json`, `~/.codex/auth.json`, OpenCode's config);
  - when a key in kernl changes;
  - every `kernl.connections.pollSeconds` (60 by default) while the panel is visible. Claude Code keeps its login in the macOS keychain, which no file watcher sees.
- **Keys:** when one changes, and when the view opens (`kernl.connections.checkKeys` turns this off).
- **MCP servers and plugins:** when the view opens, and on **Check now**. `claude mcp list` connects to every server, so it never runs on a timer.
- **Runs report too, at once:**
  - an agent answering "authentication required";
  - Claude Code's and Codex's login status pushes;
  - a Codex MCP server that didn't start;
  - a provider refusing kernl's key;
  - kernl's own MCP connects.

  A failure a run reported holds until something that could fix it happens: a changed login file or key, coming back to VS Code, Check now, Log in, or a run that works.

## Fixes

- **Log in** opens a terminal running the agent's own login (`claude auth login`, `codex login`, `opencode auth login`) with the binary and folder kernl launches. kernl never sees the login. While the terminal is open, kernl checks the login every 5 s.
- **How to sign in** (a Claude Code MCP server or connector that needs authentication) opens Claude Code. Type `/mcp`, choose the server, then Authenticate.
- **Set key**, **Check now**: as named.

If Claude Code says "Login expired" while a session in your terminal still works, that session started before the login expired and keeps it in memory. New sessions, kernl's included, can't sign in until you log in again.
