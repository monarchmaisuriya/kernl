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
