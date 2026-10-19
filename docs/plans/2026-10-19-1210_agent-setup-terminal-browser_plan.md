# Reuse the agents' setup, modular settings, and a robust terminal and browser for every agent

- Date: 2026-10-19 12:10
- Status: done
- Repos: kernl   Folders: `src/agent/`, `src/acp/`, `src/mcp/`, `src/terminal/`, `src/browser/`, `src/`, `package.json`, `docs/`, `test/`
- Files: new `src/sources/` (one importer per agent), new `src/mcp/kernlServer.ts`, `src/mcp/servers.ts`, `src/agent/skills.ts`, `src/agent/namedAgents.ts`, `src/agent/instructions.ts`, `src/acp/acpRunner.ts`, `src/acp/agents.ts`, `src/terminal/runner.ts`, `src/browser/integratedBrowser.ts`, `src/workspaceRuntime.ts`, `src/controller.ts`, `package.json`, `docs/guides/customisation.md`, `docs/guides/cli-agents.md`, `docs/known-issues/README.md`, tests
- Research: `docs/research/2026-10-19-1200_agent-setup-terminal-browser_research.md`
- Subagents: none

## Context and problem

M wants three things:

1. More customisation options, organized as modules in settings.
2. kernl able to use the skills, flows, MCP servers, and plugins people already set up for Claude Code, Codex, and OpenCode.
3. Every agent able to use VS Code's integrated terminal and browser, robustly.

Today:

- **The CLI agents already load their own setup** under ACP. kernl's own agent loads only Claude Code's skills and subagents [verified: research].
- **CLI agents run commands invisibly,** in their own processes, and can't use kernl's browser at all.
- **kernl's own terminal and browser have robustness gaps:**
  - no browser timeouts or reconnect;
  - command output grows without a cap while it streams;
  - one shared terminal serves every workspace.

## Goals / Non-goals

**Goals**

- Settings grouped into modules: Sources (one switch per agent and kind), Terminal, Browser, MCP. Each module says what it does and what it reads.
- kernl's own agent reuses, behind those switches:
  - Claude Code's skills (including synced and plugin skills), commands (as skills), subagents, CLAUDE.md and `.claude/rules`, MCP servers (user and project), and enabled plugins (their skills, commands, agents, MCP servers);
  - Codex's and OpenCode's skills and MCP servers.
- A "Sources" view (one command) lists what was loaded, from where, and what was skipped and why.
- CLI agents get kernl's terminal and browser tools through a kernl-hosted MCP server:
  - Claude Code's and OpenCode's commands run visibly in VS Code's terminal, with kernl's approvals;
  - Codex's command output is mirrored there.
- Terminal and browser hold up: timeouts, reconnects, output caps, a terminal per workspace, no pagers blocking a run.

**Non-goals**

- Running Claude Code workflows or hooks in kernl's own agent (they need Claude Code's runtime; Claude Code in kernl runs them already).
- OAuth for MCP servers in kernl's own agent (question 3).
- Changing what the CLI agents load from their own config (they keep doing that).

## What is true today

See the research brief. Key facts:

- **What kernl's agent reuses today:**
  - skills from `~/.claude/skills` and `.claude/skills` (trusted workspaces only) [verified: `src/agent/skills.ts:24-33`];
  - subagents translated from `.claude/agents` [verified: `src/agent/namedAgents.ts`];
  - MCP servers only from `kernl.mcpServers`, as `{command}` or `{url}` [verified: `src/mcp/servers.ts:5-17`].
- **What kernl gives the CLI agents:** `mcpServers: []`, no `_meta`, `terminal: false` [verified: `src/acp/acpRunner.ts:178, 231, 250, 265`].
- **What the agents accept:**
  - Claude Code takes `_meta.claudeCode.options.disallowedTools` [verified: adapter `acp-agent.js:8354`];
  - OpenCode takes `permission.bash` through kernl's injected config [verified: `src/acp/agents.ts:62-65`];
  - all three take an http MCP server [verified: research].
- **What's installed:** the MCP server SDK 2.3.1, with `McpServer` and the web-standard HTTP transport [verified: `node_modules/@modelcontextprotocol/server/dist/index.d.mts`].

```
today:  CLI agent ──own shell (invisible)──► commands        kernl agent ──► kernl terminal + browser
after:  CLI agent ──MCP http (localhost, token)──► kernl tools ──► kernl terminal + browser (approvals)   <-- new
        kernl agent ──► kernl tools + imported skills, agents, rules, MCP servers, plugins              <-- new
```

## Options considered

| Aspect | A: importers + kernl MCP server (recommended) | B: importers only | C: kernl tools only |
| --- | --- | --- | --- |
| Reuse of the agents' setup by kernl's agent | Yes | Yes | No |
| CLI agents in VS Code's terminal and browser | Yes (Claude Code, OpenCode run there; Codex mirrored) | No | Yes |
| Cost | Largest: importers, an MCP server, settings | Medium | Medium |
| When it fails | An agent ignores the MCP tools: its own shell still works (Codex) | Same complaint about the terminal | Same complaint about reuse |
| Completeness | 9/10 | 5/10 | 5/10 |

RECOMMENDATION: A, because it's the only option that covers both halves of the request.

## Decision

Option A, built as independent modules:

- **Sources:** one importer per agent, each kind behind its own setting.
- **kernl MCP server:** terminal and browser tools for CLI agents.
- **Robustness:** fixes in kernl's own terminal and browser.

Everything a project file can launch (project MCP servers, plugin servers) needs a trusted workspace and your OK the first time.

## Design

### Part 1: modular settings

New categories in `contributes.configuration`, each a module:

- **Sources: Claude Code.** `kernl.sources.claudeCode.skills`, `.commands`, `.agents`, `.instructions` (CLAUDE.md, `.claude/rules`), `.mcpServers`, `.plugins`.
- **Sources: Codex.** `kernl.sources.codex.skills`, `.mcpServers`.
- **Sources: OpenCode.** `kernl.sources.opencode.skills`, `.mcpServers`, `.instructions`.
- **MCP.** `kernl.mcpServers` gains `{ "url", "headers" }` and an explicit `type`, plus `kernl.mcp.toolTimeoutSeconds`.
- **Terminal.**
  - `kernl.terminal.cliAgents`: `kernl` (run in VS Code's terminal with kernl's approvals) or `agent` (the agent's own shell, output mirrored when it can be).
  - `kernl.terminal.outputLimit` (characters kept).
  - `kernl.terminal.perWorkspace`.
- **Browser.**
  - `kernl.browser.cliAgents`: give CLI agents kernl's browser tools.
  - `kernl.browser.timeoutSeconds`.

Every Sources, MCP, and agent-tools setting is user-only (`restrictedConfigurations`), so a repository can't turn on its own imports.

### Part 2: Sources (kernl's own agent)

- **Importer interface:** `src/sources/claudeCode.ts`, `codex.ts`, `opencode.ts`, each returning `{ skills, agents, instructions, mcpServers, skipped }`. A small `src/sources/index.ts` merges them in a fixed order: kernl, then Claude Code, Codex, OpenCode. On the same name, the earlier source wins.
- **Claude Code:**
  - skills from user, project (trusted), `synced/`, and enabled plugins;
  - `.claude/commands/*.md` as skills;
  - agents from `.claude/agents` and plugins;
  - CLAUDE.md and `.claude/rules`;
  - MCP servers from `~/.claude.json` (user and this project's local scope), `.mcp.json` (trusted only), and plugins (`${CLAUDE_PLUGIN_ROOT}` expanded);
  - enabled plugins from `installed_plugins.json` + `enabledPlugins`.
- **Codex:** skills from `~/.agents/skills` and `.agents/skills`; MCP from `~/.codex/config.toml` (stdio, url + headers, bearer env var).
- **OpenCode:** skills from `~/.config/opencode/skills` and `.opencode/skills`; MCP from `opencode.json(c)` (local and remote; headers).
- **Not imported:**
  - OAuth servers (question 3);
  - servers whose `headersHelper` runs a program;
  - hooks and workflows.

  Each shows in "skipped" with the reason.
- **Trust:** project-level sources only in trusted workspaces. A project MCP server or plugin server asks once before it first starts, and the answer is remembered per workspace.
- **Secrets:** values are passed to the server process or request, never logged, shown, or stored by kernl. Names only appear in the Sources view.
- **Sources view:** the command `kernl: Show loaded sources` opens a read-only report. It lists each source, what came from it, and what was skipped and why.

### Part 3: kernl's tools for CLI agents

- **The server:** `src/mcp/kernlServer.ts`, one per window. `McpServer` over the web-standard HTTP transport on `127.0.0.1`, random port, a random bearer token checked on every request, `Origin` rejected unless absent or `vscode-webview`/local.
- **Tools:**
  - `run_in_terminal` (command, cwd inside the workspace, timeout);
  - `start_background_job`, `job_output`, `stop_background_job`;
  - `browser_navigate`, `browser_click`, `browser_type`, `browser_read_page`, `browser_screenshot`.

  These are the tools kernl's own agent has, through the same gate and approval rules.
- **Passing it:** in `mcpServers` on new, load, and fork, `{ type: "http", name: "kernl", url, headers: [Authorization] }`, scoped to the workspace that started the session (the token maps to the workspace).
- **Claude Code** with `kernl.terminal.cliAgents = kernl`: `_meta.claudeCode.options.disallowedTools: ["Bash"]`, so its commands go through `run_in_terminal`.
- **OpenCode:** `permission.bash: "deny"` in the injected config.
- **Codex:** keeps its shell. `_meta.terminal_output_delta: true` mirrors its command output into the workspace's kernl terminal (read-only) and its tool row.
- **One approval, not two:** when an agent asks permission for one of kernl's own MCP tools, kernl answers allow-once without a card. kernl's tool then asks through its own gate (rules, card, diff), so you see exactly one card.

### Part 4: robustness

- **Browser:** a per-call timeout (`kernl.browser.timeoutSeconds`, default 30 s). A closed or detached debug session resets the connection, and the next call reconnects.
- **Terminal:**
  - output capped while streaming (keeps the head and tail);
  - one terminal per workspace ("kernl: <workspace>");
  - `PAGER=cat`, `GIT_PAGER=cat` for agent commands;
  - when shell integration isn't available, a clear error saying how to enable it, instead of a hang.
- **MCP:** a tool-call timeout (`kernl.mcp.toolTimeoutSeconds`). A server that fails to start is reported by name and skipped, not fatal for the run.

## Risks and mitigations

| Risk | Likelihood | Impact | Mitigation | How we'd notice |
| --- | --- | --- | --- | --- |
| Another local process calls kernl's MCP server | Low | High | Localhost only, random port, bearer token, Origin check, tools still gated | Unit test: no token, wrong Origin refused |
| A project file launches a program through an import | Medium | High | Trusted workspaces only; first-use OK per server; user-only settings | Test: untrusted workspace imports nothing project-level |
| Two approval cards for one command | Medium | Medium | Agents' requests for kernl's own tools are answered without a card | End-to-end check with the fake agent |
| Claude Code needs Bash for something else | Low | Medium | `kernl.terminal.cliAgents = agent` turns it back; documented | Live check |
| An imported MCP server is slow or broken | Medium | Low | Per-server timeout, skipped with a reason | Sources view |
| A secret leaks into logs or the panel | Low | High | Values never logged; redactor covers headers; tests assert no value in output | Unit test |

## Acceptance criteria

- **Settings:** in VS Code's settings, kernl shows Sources (per agent), MCP, Terminal, and Browser modules.
- **Imports into kernl's agent:**
  - with Claude Code skills, commands, agents, rules, MCP servers, and plugins in the user's setup, kernl's agent lists and uses them;
  - the Sources view names each one and its origin;
  - turning one switch off removes only that kind.
- **Trust and OAuth:**
  - in an untrusted workspace, nothing project-level is imported;
  - an OAuth MCP server is listed as skipped, with the reason.
- **Terminal for CLI agents:**
  - Claude Code and OpenCode run their commands in VS Code's terminal, with one approval card per command;
  - Codex's command output appears in the workspace's terminal.
- **Browser for CLI agents:** any CLI agent can open and read a page in VS Code's browser, through kernl's tools.
- **Robustness:**
  - a browser call that hangs fails after the timeout;
  - the next call reconnects;
  - a run's output is capped while streaming.

## Rollout and rollback

Each module is behind its settings; defaults per question 4. Rollback: revert and reinstall; turning a module's switch off disables it without a release.

## Parts

### Part 1: settings modules
- [x] Categories and settings, restricted where they import or launch. Done: settings UI shows the modules; unit test reads the defaults.

### Part 2: Sources
- [x] Importers (Claude Code, Codex, OpenCode), merge, trust, first-use OK, Sources view. Done: unit tests per importer on fixture folders (including M's shapes, without values); VS Code check of the view.

### Part 3: kernl's tools for CLI agents
- [x] MCP server, wiring into new/load/fork, Claude Code and OpenCode shell off, Codex mirror, one approval. Done: unit tests (token, Origin, tools gated); fake agent end to end; live check with Claude Code.

### Part 4: robustness
- [x] Browser timeouts and reconnect, terminal caps, terminal per workspace, pager variables, MCP timeouts. Done: unit tests; VS Code checks.

### Finish
- [x] Docs (customisation, CLI agents, known issues), changelog entries, suites, package, install, live check in M's window.

## Standardized review

- **Bottom line:** usable once M answers four questions; the largest risks (local server, project launches) have mitigations and tests.
- **Criteria:**
  - goal fidelity pass (each part of the request maps to a part);
  - current-system accuracy pass (tagged against code and adapter sources);
  - scope pass (workflows and hooks run only in Claude Code, said plainly);
  - architecture pass (importers own reading, the gate owns approval, the server only exposes tools);
  - sequencing pass (settings, then Sources and tools, which are independent, then robustness);
  - completeness pass;
  - failure and recovery pass;
  - verification pass;
  - decision readiness: four questions.
- **Findings:**
  1. **Must-verify:** whether Claude Code loads CLI-installed plugins by itself under ACP (it decides whether kernl passes them via `_meta`); checked live in Part 3.
  2. **Must-verify:** Codex has no switch to turn its shell off; its commands stay in its own process, mirrored.
  3. **Note:** this is large; each part ships and is checked on its own.

## Changes made

- Part 1: settings in categories Sources (one per agent), MCP, Terminal, Browser; the import and launch switches are restricted in untrusted workspaces.
- Part 2: `src/sources/` importers for Claude Code (skills, commands, agents, CLAUDE.md and rules, MCP, enabled plugins), Codex (skills, MCP), and OpenCode (skills, MCP, instructions); commands become skills in kernl's storage; each MCP server loads on its own with a timeout, and a project server asks once; "kernl: Show loaded sources".
- Part 3: `src/mcp/kernlServer.ts` (one local MCP server per window, a token per workspace, Origin and Host checked) with run_in_terminal, the job tools, and the browser tools through each workspace's gate; sessions get it on new, load, and fork; Claude Code's Bash and OpenCode's bash are off with kernl's terminal; Codex's own commands stream into a read-only mirror terminal and their rows; an agent's permission request for kernl's own tool gets no second card; a CLI agent in Bypass gets no card from kernl's tools (deny rules still apply).
- Part 4: browser calls time out (`kernl.browser.timeoutSeconds`) and a dropped connection reopens once (no second tab); terminal output is capped while it streams (`kernl.terminal.outputLimit`), commands run with `PAGER=cat` and `GIT_PAGER=cat`, each folder and worktree gets its own named terminal, and the shell integration warning opens its setting. Docs: customisation, CLI agents, approvals, known issues, panel.
- Live check on M's setup (before release): hidden `.bucket-*` synced-skill folders were skipped, and servers Claude Code signs in to by itself (Notion, Slack, Datadog) are recognized by their "sign in first" answer, logged once, and listed in the Sources view. Released in 0.2.0.

## Open questions

All four were decided by M on 2026-10-19: option A for each (below), and the release as 0.2.0.

1. **What "flows" means.** A (recommended): Claude Code's workflows (`.claude/workflows/*.js`, plugin `workflows/`). Claude Code in kernl already runs them as `/name`, and kernl's own agent can't (they need Claude Code's runtime), so kernl lists them in the Sources view as "runs in Claude Code". B: something else you have in mind.
2. **Where CLI agents' commands run.** A (recommended): in VS Code's terminal through kernl's tool, with kernl's approvals. That covers Claude Code and OpenCode; Codex's output is mirrored there. B: the agents keep their own shells; kernl only mirrors output (Claude Code and Codex). Completeness: A 9/10, B 6/10.
3. **MCP servers that sign in with OAuth** (your notion, slack, datadog) in kernl's own agent. A (recommended): skipped and listed with the reason; they keep working in Claude Code. B: build OAuth sign-in in kernl (a large piece of its own). Completeness: A 7/10, B 9/10.
4. **Defaults.** A (recommended): user-level sources on; project-level sources on only in trusted workspaces, each project MCP or plugin server asking once. B: everything off until you turn it on. Completeness: A 9/10, B 7/10.
