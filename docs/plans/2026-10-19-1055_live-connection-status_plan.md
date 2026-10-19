# Live, accurate connection status for agents, keys, MCP servers, and plugins

- Date: 2026-10-19 10:55
- Status: done (not committed)
- Repos: kernl   Folders: `src/connections/` (new), `src/acp/`, `src/agent/`, `src/mcp/`, `src/providers/`, `src/ui/`, `src/webview/`, `test/`, `docs/`
- Files:
  - **Change:** `src/harnesses.ts` (replaced), `src/controller.ts`, `src/workspaceRuntime.ts`, `src/acp/acpRunner.ts`, `src/agent/session.ts`, `src/mcp/servers.ts`, `src/ui/protocol.ts`, `src/webview/main.ts`, `media/panel.css`, `package.json`, `test/fixtures/fakeAcpAgent.ts`, `docs/guides/*.md`, `CHANGELOG.md`
  - **New:** `src/connections/{types,statusCommands,parsers,monitor,keyCheck}.ts`, `src/webview/connections.ts`, unit and VS Code tests
- Research: [2026-10-19-1050_live-connection-status_research.md](../research/2026-10-19-1050_live-connection-status_research.md)
- Subagents: none

## Context and problem

The agent chip said "Claude Code isn't logged in" while a Claude Code session in M's terminal worked.

kernl was right: every new Claude Code session failed to sign in. M's terminal session only worked because it held the login in memory. But kernl couldn't say *why* ("expired", not "never logged in"), didn't notice the change live, and had nothing to say about anything else that connects:
- MCP servers, including claude.ai connectors;
- plugins;
- whether a stored API key still works.

M wants all of it robust and live. Checks must be read-only: on 2026-10-19, a real test prompt changed M's stored login (see the research).

## Goals / Non-goals

**Goals**
- One status per connection, used everywhere: the agent chip, the agent menu, and a new Connections view. Covers CLI agents (installed, login, its source), kernl provider keys and CLI agent keys stored in kernl, MCP servers per agent (kernl's own, Claude Code's including claude.ai connectors, Codex's, OpenCode's), and Claude Code plugins.
- **Accurate:**
  - checks run with exactly the environment and binary kernl launches the agent with;
  - an expired login reads "Expired", not "not logged in";
  - "can't tell" is shown as unknown and never blocks.
- **Live:** status changes within seconds of a login, a key change, a config change, or a run hitting an auth error, with no reload.
- **Read-only:** checks never write credentials or config and never make a model call. A fixed allowlist of status commands enforces this.
- A fix action on every problem: Log in (opens a terminal running the CLI's own login), Set key, Check now, Open settings.

**Non-goals**
- kernl signing in to anything itself (OAuth flows, keychain writes). The CLIs do their own logins in a terminal.
- Fixing third-party tools' credential setups (for example clauth). kernl reports what the CLI reports.
- Codex and OpenCode plugin listing (not verified; out of scope).
- Changing what the agents can do.

## What is true today

```
 startup / window focus / key or settings change
          │
          ▼
 controller.refreshReadiness()  ── one agent at a time, 10 s cap each      [src/controller.ts:316-328]
          │
          ├─ kernl: settingsProblem(provider, key present?)                 [src/controller.ts:906-911]
          └─ CLI:  cliReadiness(id)  ── binary found? npx? stored key?      [src/harnesses.ts:28-50]
                     ├─ claude auth status   (JSON loggedIn only; no expiry)  <-- misses "expired"
                     ├─ codex login status   ("not logged in")
                     └─ OpenCode: always ready
          │
          ▼
 readiness map → agent chip / menu: ready or { problem }                    [src/controller.ts:305-311]

 not covered: MCP servers of CLI agents, plugins, key validity, auth errors during a run,
 changes while the window stays focused
```

- Status commands run with the extension host's environment, not the agent's launch environment [verified: `runQuiet` in `src/harnesses.ts:52-61`; launch env from `resolveLaunch` in `src/workspaceRuntime.ts:674`].
- An auth error during a run becomes only the run's red error text. Readiness doesn't change [verified: `src/acp/acpRunner.ts:172`, `src/agent/session.ts:189`].
- kernl's own MCP failures are a notice per build; servers that need a sign-in are logged and listed in the Sources view [verified: `src/workspaceRuntime.ts` `loadMcp`].
- Keys live in VS Code SecretStorage through `KeyStore` and `AgentCredentials` [verified: `src/providers/keys.ts:14`, `src/acp/credentials.ts`].
- The ACP SDK passes agent ext notifications (`_auth/status_update`) to `Client.extNotification` [verified: `@agentclientprotocol/sdk` `acp.d.ts:1400`]; kernl doesn't handle them [verified: no match in `src/acp/`].

## Options considered

From the research brief:

| | A: fix the Claude Code check only | B: connection monitor (recommended) | C: real tiny request per agent |
| --- | --- | --- | --- |
| How | expiry from `--text`, launch env | status commands plus run signals feed one status per connection; Connections view | send a one-word prompt before "ready" |
| Live | no | yes | partly |
| Read-only | yes | yes (allowlist) | **no**: refreshes and writes tokens |
| Covers MCP, plugins, keys | no | yes | no |
| Completeness | 4/10 | 9/10 | 5/10 |

RECOMMENDATION: B because it is the only option that is both live and read-only.

## Decision

Option B. A `ConnectionMonitor` owns every connection's status: the single source of truth that the chip, the menu, and the Connections view read. Inputs come from two places:
1. allowlisted, read-only status commands, run with the agent's launch environment;
2. signals real runs already produce.

`cliReadiness` and the controller's readiness map are removed.

Rejected: A (doesn't cover MCP, keys, or plugins, and isn't live); C (writes credentials, the exact failure seen today).

## Design

### Status model (`src/connections/types.ts`)

```ts
type ConnectionKind = "agent" | "providerKey" | "agentKey" | "mcp" | "plugin";
type ConnectionState = "ready" | "needsAction" | "failed" | "checking" | "unknown" | "off";
interface ConnectionStatus {
  id: string;            // "agent:claude-code", "mcp:claude-code:notion", "key:anthropic", "plugin:claude-code:render"
  kind: ConnectionKind;
  owner: string;         // "Claude Code", "kernl", "Codex", "OpenCode"
  label: string;         // "Claude Code", "notion", "Anthropic key"
  state: ConnectionState;
  detail: string;        // what the source said, in words: "Login expired (claude.ai, Max)", "Needs authentication"
  source: string;        // "claude auth status", "last run", "key check (GET /models)", "claude mcp list"
  checkedAt: number;
  fix?: { label: string; action: "login" | "setKey" | "check" | "openSettings" | "showSources"; target: string };
}
```

### Read-only checks (`statusCommands.ts`, `parsers.ts`)

- **Allowlist.** A fixed table is the only place commands come from:

  | Agent | Commands |
  | --- | --- |
  | Claude Code | `claude auth status --json`, `claude auth status --text`, `claude mcp list`, `claude plugin list --json` |
  | Codex | `codex login status`, `codex mcp list --json` |
  | OpenCode | `opencode auth list --format json`, `opencode mcp list` |

  The runner refuses anything else (a unit test proves it), runs without a shell, caps each at 10 s, and never throws.
- **Same environment as the launch.** The environment and binary come from `resolveLaunch` for that agent, including a stored kernl key and `kernl.agentCommands`. With a launch override, the check runs the override's own binary when it's one of the three CLIs; otherwise the agent's state is "unknown (your launch command)".
- **Parsers.** Each command has a parser, tested against outputs recorded from the installed versions (Claude Code 2.1.303, Codex 0.163.0, OpenCode 2.0.32). Output it can't read means `unknown`, never `needsAction`.
- **Claude Code login:** `--json` gives the method and plan. `--text` shows "Expired — log in again", which `--json` reports as logged in.
- **kernl provider keys** (`keyCheck.ts`): `GET <base>/models` with the key. 200 means ready; 401 or 403 means needsAction ("the provider rejected the key"); anything else (404, network) means unknown. No tokens are spent. The same check covers Claude Code's stored Anthropic or DeepSeek key.

### The monitor (`monitor.ts`)

- **One check at a time per connection.** A check already running is joined, not repeated. Results carry `checkedAt` and `source`, and an event fires on every change.
- **Triggers:**

  | Trigger | What it rechecks |
  | --- | --- |
  | Startup; window focus (if the last check is older than 30 s) | logins |
  | Every 60 s while the panel is visible | logins only: the keychain can't be watched |
  | A watched file changes | the owning agent: `~/.claude.json`, `~/.claude/.credentials.json`, `~/.claude/settings.json`, `~/.claude/plugins/installed_plugins.json`, `~/.codex/auth.json`, `~/.codex/config.toml`, OpenCode's config folder |
  | SecretStorage `onDidChange` | keys |
  | Settings change (`kernl.*`) | what that setting affects |
  | "Check now" in the Connections view | the chosen item |

- **MCP health checks connect to servers** (`claude mcp list` takes about 4 s and may refresh MCP tokens in the CLI's own store). So they run when the Connections view opens and on "Check now", never on a background timer (decision D1).
- **Run signals override older results:**

  | Signal | Effect |
  | --- | --- |
  | ACP error `-32000` "Authentication required" (Claude Code and OpenCode at prompt time, Codex at session open or a mid-turn 401) | `agent:<id>` becomes needsAction, source "last run", with the fix Log in; the run's error text says the same |
  | `_auth/status_update` from claude-agent-acp or codex-acp | updates the agent's detail (method, account, plan), then the monitor rechecks with `--text` to catch "expired" |
  | codex-acp `tool_call` `mcp__<server>__startup` failed | `mcp:codex:<server>` failed with the error |
  | kernl agent's MCP load results (connected, needs sign-in, failed) | `mcp:kernl:<server>` |
  | A provider 401 or 403 in a kernl run | `key:<provider>` needsAction |

### Fix actions

- **Log in** opens a VS Code terminal named "kernl: log in to <agent>", running that agent's own login command with the launch environment: `claude auth login`, `codex login`, or `opencode auth login`. When the terminal closes, or a watched credential file changes, the agent is rechecked. kernl never sees or stores the login.
- **Set key** opens the existing key flow. **Check now** reruns that item. **Open settings** and **Show loaded sources** reuse existing commands.

### Connections view (`src/webview/connections.ts`)

- Opened from the panel's `...` menu, from the agent chip when it shows a warning (scrolled to that agent), and from a new command "kernl: Show connections".
- **Groups:** Agents, Keys, MCP servers (by agent), Plugins.
- **Each row:** a state dot, the label, the detail, the source with "checked 12 s ago", and the fix button. A "checking" row shimmers like a running tool row. Updates arrive as `connections` messages with the full list (a few dozen rows, so no diffing).
- The agent chip and menu read the same statuses. `HarnessView.ready` and `problem` are derived from `agent:<id>`: not ready only when needsAction or failed.

### Contracts touched

- **Panel protocol:**
  - new host-to-panel `{ type: "connections"; items: ConnectionStatus[] }`;
  - new panel-to-host `{ type: "connectionAction"; id; action }` and `{ type: "showConnections"; focus? }`;
  - `HarnessView` unchanged in shape.
- **New command** `kernl.showConnections`.
- **New settings:**
  - `kernl.connections.pollSeconds`: login recheck interval while the panel is visible; default 60; 0 turns it off.
  - `kernl.connections.checkKeys`: run the key check; default on.
- **`AcpRunnerOptions`:** gains `connection?: (signal) => void`, and the client gains `extNotification`.

## Risks and mitigations

| Risk | Likelihood | Impact | Mitigation | How we'd notice |
| --- | --- | --- | --- | --- |
| A CLI changes its status output | medium | status shows unknown | parsers pinned to recorded outputs; unknown never blocks; the parser tests record the versions | "unknown" rows, and the parser tests on upgrade (`docs/development/upgrading.md`) |
| A status command writes (refreshes a token) | low (`auth status`, `login status`, `auth list` read only) | changes the user's credentials | allowlist; MCP health checks are user- or view-triggered only; research flagged `claude mcp list` | research; code review |
| Polling costs CPU or battery | low | small | 60 s, only while the panel is visible; one check at a time; setting to turn it off | Activity Monitor |
| A run error is misread as an auth error | low | wrong status | only ACP code -32000 or HTTP 401/403 count | unit tests with each adapter's real error shape |
| Key check endpoint absent on a custom server | medium | can't tell | 404 or other means unknown, not invalid | "unknown" with source "key check" |
| The login terminal runs an unexpected binary | low | wrong CLI | the binary comes from the same resolution as the launch, shown in the terminal name | terminal title |

## Acceptance criteria

- Given Claude Code's stored login has expired, when the panel opens, then the agent chip warns and the Connections view says "Login expired", with source "claude auth status" and a Log in button, while a working terminal session elsewhere doesn't change that.
- Given the user logs in from the Log in terminal, when the terminal closes or the credentials change, then within 5 s the row turns ready without a reload.
- Given a run gets ACP error -32000, when it ends, then the agent's row is needsAction from "last run" and the chip warns, before any status command runs.
- Given an agent's status output can't be read, then its row is "unknown" and the agent stays selectable.
- Given any status check, then only an allowlisted command runs, with the agent's launch environment (a unit test asserts both).
- Given a stored provider key that the provider rejects (401), when keys are checked, then the key row says the provider rejected it, and no model call was made.
- Given the Connections view opens, then Claude Code's MCP servers show Connected, Needs authentication, or Failed as `claude mcp list` reports, and claude.ai connectors appear among them.
- Given codex-acp reports `mcp__<server>__startup` failed, then that server's row is failed with the error.
- Given nothing changes, then no check runs while the panel is hidden, and MCP health checks never run on a timer.

## Rollout and rollback

- Ships in the next minor release (0.3.0) with a changelog entry.
- The old readiness code is removed in the same change, so there's one source of truth.
- **Abort** if the VS Code suite shows the chip or menu disagreeing with the Connections view.
- **Rollback:** revert the change; nothing persistent is stored (statuses are in memory, settings are new and optional).

## Parts

### Part 1: status core
- [x] `types.ts`, `statusCommands.ts` (allowlist, launch env, 10 s cap, no shell), `parsers.ts` with recorded outputs for each command. Done: parser and allowlist unit tests pass; an unknown output parses to unknown.
- [x] `monitor.ts`: one check at a time per item, change events, triggers (startup, focus, poll while visible, watchers, SecretStorage, settings). Done: unit tests for join, timeout, and ordering.
- [x] Replace `cliReadiness` and the readiness map; the chip and menu read the monitor. Done: the existing agent-logins and chip VS Code checks pass unchanged.

### Part 2: live run signals
- [x] AcpRunner: `-32000` to `connection` signal; `extNotification` for `_auth/status_update`; codex `mcp__<server>__startup` failures. Done: fake agent scenarios `auth-required`, `auth-status`, `mcp-startup-failed` drive the right rows.
- [x] kernl agent: provider 401 or 403 and MCP load results to the monitor. Done: unit tests.

### Part 3: keys, MCP servers, plugins
- [x] `keyCheck.ts` (`GET /models`; 401/403 needsAction, else unknown). Done: tests against a local server for 200, 401, 404, and timeout.
- [x] Claude Code `mcp list` and `plugin list --json`, Codex `mcp list --json`, OpenCode `mcp list`; kernl MCP check now. Done: parser tests on recorded outputs; the view lists M's real servers with their states (live check).

### Part 4: Connections view and fix actions
- [x] View, `kernl.showConnections`, chip warning opens it, `...` menu entry; Log in terminal with recheck on close; Set key, Check now, Open settings, Show sources. Done: webview unit tests; VS Code checks (log in with a fake CLI updates the row live).
- [x] Settings `kernl.connections.pollSeconds` and `checkKeys`; docs (new `guides/connections.md`, CLI agents, providers), changelog. Done: docs read correctly; suites pass; installed and checked in M's window.

## Standardized review

- **Bottom line:** executable once M answers four decisions. No blocking findings.
- **Criteria:**
  - **Goal fidelity:** pass. Covers every kind M named (agents, CLIs, keys, MCP, connectors, plugins) and the read-only rule.
  - **Current-system accuracy:** pass. Every "today" claim is tagged with file and line.
  - **Scope:** pass. Non-goals exclude logins inside kernl and third-party credential tools.
  - **Architecture:** pass. One owner of status (the monitor); the chip, menu, and view only read it.
  - **Sequencing:** pass. The core comes before the signals that feed it, and the view comes last.
  - **Completeness:** pass. Settings, docs, changelog, and tests are included.
  - **Failure and recovery:** pass. Unknown never blocks; timeouts; rollback.
  - **Verification:** pass. Every task has a test or live check.
  - **Feasibility:** pass. All signals are verified in installed versions.
  - **Decision readiness:** four decisions for M, below.
- **Findings:**
  1. **must-verify:** OpenCode's `mcp list` output wasn't observed (no servers configured). One configured server confirms the parser in Part 3; until then OpenCode MCP rows may show unknown.
  2. **note:** Claude Code's login check runs `claude` twice per check (`--json` and `--text`), each under 1 s. Acceptable at a 60 s cadence.
  3. **note:** the 05:13Z change to M's keychain item is unexplained (research flag). The plan's allowlist excludes every command that could cause it, but its cause stays open.

## Changes made

- Decisions (M, 2026-10-19): A for D1 to D4.
- Part 1: `src/connections/` (types, allowlisted read-only status commands, parsers tested on recorded outputs, the monitor, agent checks with the launch binary and environment); `cliReadiness` and the readiness map removed. During a check a row keeps its last state (flag `checking`): a first version replaced the state with "checking", which let a message reach a logged-out agent (found by the VS Code suite).
- Part 2: ACP "authentication required", `_auth/status_update`, codex `mcp__<server>__startup` failures, a provider's 401/403, and kernl's MCP connects update the monitor at once; a run's failure holds until a forced check, a focus return, or a working run.
- Part 3: key check (`GET /models`, key in a header), Claude Code `mcp list` and `plugin list --json`, Codex `mcp list --json`, OpenCode `mcp list`, kernl MCP Check now (never prompts).
- Monitor rules found by the VS Code suites: (1) when an agent's inputs change (its launch command, key, login files, a finished login), its row reads "unknown" until the recheck answers, since the old state no longer describes it; a routine recheck keeps the last state. (2) A forced or changed request during a running check gets a fresh check after it, and a changed one drops the running check's answer (it was computed on the old inputs).
- Part 4: Connections view, `kernl.showConnections`, the warning button beside the agent chip, Log in terminals (shared with Agent logins, recheck every 5 s while open), settings `kernl.connections.pollSeconds` and `checkKeys`, docs (`guides/connections.md`), changelog.

## Open questions

1. **D1: MCP health checks** (they connect to servers; the CLI may refresh MCP tokens while doing it). A (recommended): when the Connections view opens, and on Check now. B: also every 5 minutes while the panel is visible. RECOMMENDATION: A because it keeps background activity read-only by construction. Completeness: A 8/10, B 9/10.
2. **D2: Login recheck while the panel is visible.** A (recommended): every 60 s, setting to change or turn off. B: only on focus and file changes. RECOMMENDATION: A because keychain logins can't be watched, so polling is the only way to catch them live. Completeness: A 9/10, B 6/10.
3. **D3: Checking stored keys** with `GET /models` (no tokens spent). A (recommended): automatically when a key changes and when the view opens. B: only on Check now. RECOMMENDATION: A because a bad key should show before the first run fails. Completeness: A 9/10, B 6/10.
4. **D4: Log in.** A (recommended): a VS Code terminal running the CLI's own login command (`claude auth login`, `codex login`, `opencode auth login`). B: the same through ACP's terminal-auth methods (needs a live agent session first). RECOMMENDATION: A because it works without starting an agent, and the ACP methods run the same commands. Completeness: A 9/10, B 7/10.
