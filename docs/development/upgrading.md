# Upgrading Deep Agents, LangChain, or VS Code

Versions are pinned. Before changing any of them:

```bash
npm run check:upgrade && npm run test:vscode
```

`check:upgrade` runs the backend contract tests and fails if `FilesystemBackend` gains a method that
`GatedBackend` does not classify, so a new write path cannot skip the gate. `test:vscode` guards the
undocumented `requestCDPProxy` browser mechanism and shell integration.

## Claude Code, Codex, or OpenCode

kernl reads each CLI's status output (login, MCP servers, plugins) to fill [Connections](../guides/connections.md). The parsers are tested against outputs recorded from Claude Code 2.1.303, Codex 0.163.0, and OpenCode 2.0.32 (`test/unit/connectionParsers.test.ts`). After a CLI upgrade, run its status commands (`claude auth status --json` and `--text`, `claude mcp list`, `claude plugin list --json`, `codex login status`, `codex mcp list --json`, `opencode auth list --format json`, `opencode mcp list`) and compare with the recordings. Output a parser can't read shows as "Can't tell", never as "Needs you".
