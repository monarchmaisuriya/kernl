# Reusing the agents' own setup, and a terminal and browser for every agent

- Date: 2026-10-19 12:00
- Status: presented
- Mode: find out
- Repos: kernl   Folders: `src/agent/`, `src/acp/`, `src/mcp/`, `src/terminal/`, `src/browser/`, `package.json`
- Question / problem: How can kernl reuse the skills, flows, MCP servers, and plugins of Claude Code, Codex, and OpenCode, offer modular customisation settings, and give every agent robust use of VS Code's integrated terminal and browser?

## Research: what each agent loads, what kernl can reuse, and how CLI agents can use kernl's terminal and browser

- **Bottom line:**
  - **The CLI agents load their own setup already.** Under ACP, Claude Code, Codex, and OpenCode each load their own skills, commands, subagents, MCP servers, hooks, and (for Claude Code) workflows. The gap is kernl's own agent: it reuses Claude Code's skills and subagents, but not MCP servers, plugins, commands, CLAUDE.md, or Codex/OpenCode setup.
  - **None of the CLI agents uses a client-provided terminal.** They run commands in their own processes. A command becomes visible in VS Code's terminal only if kernl replaces the agent's shell tool with its own (Claude Code, OpenCode) or mirrors a copy of the output (Codex, Claude Code).
  - **Browser access for CLI agents** means a kernl-hosted MCP server, which all three accept over local HTTP.
  - **Confidence:** high (adapter sources at the pinned versions, vendor docs, kernl's code).
- **Where we are:** feeds the plan. About 40 minutes: two research agents, plus local checks.
- **Need from M:** accept; answer the plan's questions.

### What I found: what each agent loads (under ACP, as kernl runs them)

| Kind | Claude Code (claude-agent-acp 0.93.0) | Codex (codex-acp 2.2.2) | OpenCode | kernl's own agent today |
| --- | --- | --- | --- | --- |
| Skills | Loads `~/.claude/skills`, `.claude/skills`, synced, plugin skills (`settingSources: user, project, local`) [verified: adapter `acp-agent.js:8449`] | Loads `.agents/skills`, `~/.agents/skills` [verified: codex-acp `index.js`] | Loads `.opencode/skills`, also `.claude/skills`, `~/.claude/skills`, `.agents/skills` [primary: opencode.ai/docs/skills] | Claude user + project skills only [verified: `src/agent/skills.ts:24-33`] |
| Commands | Loads `.claude/commands` (now merged into skills); sent to kernl as `available_commands_update` [verified: `acp-agent.js:4354`] | Skills listed as commands | Configured `command`s sent | No |
| Subagents | Loads `.claude/agents`, plugin agents | n/a | `agent` config | Claude `.claude/agents` translated [verified: `src/agent/namedAgents.ts`] |
| MCP servers | Loads `~/.claude.json` (user, local), `.mcp.json` (project), plugin servers; client servers merged on top [verified: docs/en/mcp; `acp-agent.js:8289-8312`] | Loads `~/.codex/config.toml` `[mcp_servers]`; client servers merged unless the name exists [verified: codex-acp `index.js`] | Loads `mcp` config; accepts client servers [verified: opencode `acp/service.ts`] | Only `kernl.mcpServers` with `{command}` or `{url}`; no headers, no OAuth [verified: `src/mcp/servers.ts:5-17`] |
| Plugins | Plugin layout: skills, commands, agents, hooks, `.mcp.json`, workflows [primary: docs/en/plugins-reference]; whether `enabledPlugins` load under the SDK is unverified | Plugins load | JS plugins; under ACP unverified | No |
| "Flows" | Claude Code **workflows**: `.claude/workflows/*.js` and plugin `workflows/`, run as `/<name>` by Claude Code's runtime [primary: code.claude.com/docs/en/workflows] | n/a | n/a | No (needs Claude Code's runtime) |
| Instructions | `CLAUDE.md`, `.claude/rules` | `AGENTS.md` | `AGENTS.md`, falls back to `CLAUDE.md` | `AGENTS.md`, `.kernl/rules`, `~/.kernl/AGENTS.md` [verified: `src/agent/instructions.ts:73-97`] |
| Hooks | Loads settings hooks | Loads | Plugins | No (tied to Claude Code's tool names) |

- **M's own setup** [verified, values not printed]:
  - `~/.claude.json` has 4 MCP servers over HTTP: 3 with OAuth (notion, slack, datadog) and 1 with an `Authorization` header (pushowl-support).
  - Two Claude Code plugins are installed: render, postman.
  - Codex and OpenCode have no MCP servers, skills, or agents configured.
- **kernl's per-session lever on Claude Code:** `_meta.claudeCode.options` accepts `plugins`, `mcpServers`, `disallowedTools`, `settingSources` [verified: `acp-agent.js:8354, 405-422`].

### What I found: terminal and browser for CLI agents

- **kernl offers neither terminal nor files to agents:** it advertises `terminal: false`, `fs: false`, and passes `mcpServers: []` on new, load, and fork [verified: `src/acp/acpRunner.ts:178, 231, 250, 265`].
- **No agent calls `terminal/create` or `fs/*`,** even when offered [verified: grep of claude-agent-acp 0.93.0, codex-acp 2.2.2, OpenCode main]. Zed offers them too, but the agents still run commands in their own processes [primary: zed `crates/agent_servers/src/acp/v1.rs:446-469`].
- **A mirror copy of output:** with `clientCapabilities._meta.terminal_output_delta: true`, Claude Code and Codex stream a copy of their command output and exit code to the client [verified: claude-agent-acp `tool-calls/client-capabilities.js:41-42`, `renderer.js:233-247`; codex-acp `index.js:39775-39814`]. OpenCode doesn't.
- **Turning the agent's own shell off:**
  - Claude Code: `_meta.claudeCode.options.disallowedTools: ["Bash"]` [verified: `acp-agent.js:8354, 8511`].
  - OpenCode: `permission.bash: "deny"`, set through the config kernl already injects [verified: opencode.ai/docs/permissions; `src/acp/agents.ts:62-65`].
  - Codex: no switch found [unverified].
- **MCP transports each agent accepts:**
  - Claude Code: http, sse, stdio.
  - Codex: http only (others throw).
  - OpenCode: http, stdio.

  [verified: `acp-agent.js:1429-1431`; codex-acp `index.js:42462, 35521-35526`; opencode `service.ts:123,245`]
- **Serving MCP from the extension:** the MCP server SDK 2.3.1 is already installed (through `@langchain/mcp-adapters`) and exports `McpServer` and `WebStandardStreamableHTTPServerTransport` [verified: `node_modules/@modelcontextprotocol/server/dist/index.d.mts`]. The MCP spec says an HTTP server must validate `Origin`, should bind to localhost, and should authenticate [primary: modelcontextprotocol.io transports].
- **Robustness gaps in kernl's own tools:**
  - browser calls have no per-call timeout [verified: `src/browser/integratedBrowser.ts:58-71`];
  - nothing notices when the browser connection detaches [verified: grep];
  - command output grows unbounded before the 30,000-character trim [verified: `src/terminal/runner.ts:84`];
  - one shared terminal serves every workspace's agent;
  - no pager variables are set (Zed sets `PAGER=` and `GIT_PAGER=cat`) [primary: zed `terminal.rs:989-993`].

### What this means for our code

- `src/agent/skills.ts`, `namedAgents.ts`, `instructions.ts`, `src/mcp/servers.ts`: importers for each agent's setup, each behind its own setting.
- `src/acp/acpRunner.ts` + `src/acp/agents.ts`: pass kernl's MCP server, set `_meta` for the mirror copy, and turn the agent's shell off where possible.
- New `src/mcp/kernlServer.ts`: kernl's terminal and browser tools over localhost HTTP (token, Origin check).
- `src/terminal/`, `src/browser/`: timeouts, reconnects, output caps, a terminal per workspace.
- `package.json`: setting categories (Sources, Terminal, Browser), and pin `@modelcontextprotocol/server`.

### Confidence and gaps

| Claim | Tag | Source tier | What would raise confidence |
| --- | --- | --- | --- |
| CLI agents load their own setup under ACP | verified (adapters, docs) | primary | — |
| Claude Code loads CLI-installed plugins under the SDK | unverified | — | A live session listing `render:` commands |
| Codex can't turn its shell off | unverified | — | codex `-c` overrides for tools |
| OpenCode v2.0.32 matches main's ACP code | unverified | — | A live run |
| The MCP server SDK's HTTP transport works in the extension host | inferred (exports present) | primary | A spike in the build |

### Security

- **Project files can start programs.** Project-level `.mcp.json` stdio servers, plugin hooks, and `bin/` all launch processes. Importing them into kernl's agent must require a trusted workspace and ask before first use, as kernl does for project skills.
- **A secret was exposed during research.** One research agent's own tool output displayed a plaintext Cloudflare Access client secret from `~/.config/opencode/opencode.jsonc`. It was not repeated in reports or in this file. Importers must never copy, log, or show config values.

### Sources

- Claude Code: https://code.claude.com/docs/en/skills, /mcp, /plugins-reference, /workflows, /sub-agents, /settings
- claude-agent-acp 0.93.0 (local `dist/`), codex-acp 2.2.2 (local `dist/index.js`), OpenCode https://github.com/anomalyco/opencode (`packages/cli/src/acp`)
- Codex: https://learn.chatgpt.com/docs/extend/mcp; OpenCode: https://opencode.ai/docs/config, /mcp-servers, /skills, /permissions
- ACP: https://agentclientprotocol.com/protocol/terminals; `@agentclientprotocol/sdk` 1.9.0 schema
- MCP transports: https://modelcontextprotocol.io/specification/2025-06-18/basic/transports
- Zed: https://github.com/zed-industries/zed (`crates/agent_servers`, `crates/acp_thread`)
- VS Code: contribution points (configuration categories, restricted configurations), shell integration API

## Standardized review

- **Bottom line:** usable. The adapters' behavior is read from the exact versions kernl pins, and M's setup was inspected without printing values.
- **Criteria:** question fit pass; method pass (codebase, local adapter sources, then vendor docs); source quality pass; coverage pass (three agents plus kernl); claim traceability pass; uncertainty pass (gaps table).
- **Findings:**
  1. **Must-verify:** whether Claude Code loads CLI-installed plugins under the SDK; this decides whether kernl must pass them.
  2. **Note:** "flows" is read as Claude Code's workflows; M confirms in the plan.
  3. **Note:** an exposed secret during research (Security).
