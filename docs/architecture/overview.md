# How it is built

```
panel (webview) -> AgentSession (stream, Stop) -> Deep Agents loop
                                                    |-- CompositeBackend
                                                    |     |-- scratch paths -> memory
                                                    |     `-- GatedBackend: write/edit/delete/uploadFiles/execute -> gate
                                                    `-- custom tools (browser, MCP) via gatedTool() -> gate
gate = src/gate/approvalGate.ts (the one place allow/deny is decided)
```

- `src/backend/` workspace backend, edit application (one function for preview and write), path checks
- `src/terminal/` shell-integration runner, output cleanup
- `src/browser/` integrated browser over CDP (`editor-browser` debug session + js-debug `requestCDPProxy`)
- `src/mcp/` MCP servers, every tool gated
- `src/agent/` agent assembly, streaming session, tracing-off config, the shared `Runner` contract
- `src/acp/` ACP runner for CLI agents, agent catalog (launch + the session settings for each permission mode), permission mapping
- `src/workspaces/` git worktrees: create, list, review, merge, discard
- `src/workspaceRuntime.ts` one runtime per workspace (harness, runner, approvals, terminal)
