# CLI agents: Claude Code, Codex, OpenCode

Pick the agent per workspace from the dropdown in the panel (or `kernl.harness` for the main folder).
They run your installed CLIs over the Agent Client Protocol (ACP) and use your existing logins:

| Agent | Launched as | Default mode, Ask before edits (confirmed before any prompt) |
| --- | --- | --- |
| Claude Code | `npx -y @agentclientprotocol/claude-agent-acp@0.93.0` with your `claude` | Manual: every edit and command asks |
| OpenCode | `opencode acp` | `OPENCODE_CONFIG_CONTENT` sets edit, bash, webfetch, external_directory to `ask` |
| Codex (experimental) | `npx -y @agentclientprotocol/codex-acp@2.2.2` | Read-only: edits and network ask; read-only commands run in its sandbox |

The mode chip switches to the agent's other modes (see [Permission modes](permission-modes.md)). If the agent can't confirm the mode you picked, nothing runs. Every permission request becomes an
approval card (with a diff when the agent sends one). Approve picks "allow once"; the agent's "always" option is used only when you click its own button on the card.
CLI agents perform approved actions themselves, and refuse to run in Restricted Mode. Override a
launch with `kernl.agentCommands`; the chosen permission mode still applies. Check on your machine with
`npm run probe:agents` (asks each agent to write a file, rejects it, checks nothing was written).

**API keys for CLI agents (optional).** Without one, each agent uses its own login. **kernl: Set API key**
also lists "CLI agent: Claude Code" (`ANTHROPIC_API_KEY`) and "CLI agent: Codex" (`CODEX_API_KEY`).
**kernl: Use DeepSeek for Claude Code** stores a DeepSeek key and points Claude Code at
`https://api.deepseek.com/anthropic`. The key goes only into that agent's process environment, and
storing or clearing it restarts only workspaces running that agent. OpenCode keeps providers in its own config.

- **Claude Code with a key runs on its own config folder** (`CLAUDE_CONFIG_DIR` in kernl's extension storage).
  A logged-in Claude Code otherwise sends its login credential instead of the key, to whatever endpoint is set.
  In this mode your personal `~/.claude` settings (user MCP servers, hooks, permissions, personal CLAUDE.md) don't load.
  `npm run test:live` checks against a localhost server that only the stored key is sent.
- **Codex keys are unverified:** Codex with its own login was checked against adapter 2.2.2 (Read-only confirmed, a reply received); a stored `CODEX_API_KEY` wasn't tested, and Codex may prefer its own login over it.

Whether each agent is installed and logged in, and its MCP servers and plugins, are listed in [Connections](connections.md), with a Log in button that runs the agent's own login in a terminal.

## Terminal and browser

CLI agents use kernl's own tools through a small MCP server kernl runs on this machine (only on `127.0.0.1`, with a token per workspace; a web page can't reach it). The tools are `run_in_terminal`, the background job tools, and the browser tools. They ask through kernl's approvals like the kernl agent's tools, so your approval rules apply. Settings:

- **`kernl.terminal.cliAgents`**: `kernl` (default) runs the agents' commands in the workspace's visible "kernl" terminal in VS Code; `agent` leaves each agent its own shell.
- **`kernl.browser.cliAgents`**: offer kernl's integrated browser tools to CLI agents (default on).

| Agent | With `kernl.terminal.cliAgents = kernl` |
| --- | --- |
| Claude Code | Its `Bash` tool is off; commands go through `run_in_terminal`. kernl's tools run without Claude Code's own prompt: kernl's card is the one you see. |
| OpenCode | `bash` is set to `deny` in its config; commands go through `run_in_terminal`. |
| Codex | Keeps its own shell (it has no switch to turn it off). Its commands' output streams into a read-only "Codex: <workspace>" terminal and into the command's row. |

- **One card per action.** When an agent asks its own permission for one of kernl's tools, kernl answers it without a card; kernl's tool then asks through kernl's approvals.
- **Bypass permissions** in the agent's mode also skips kernl's cards for its tools (your deny rules still refuse).
- Changing either setting restarts CLI agents at their next message.
