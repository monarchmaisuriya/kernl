# Live connection status for agents, keys, MCP servers, and plugins

- Date: 2026-10-19 10:50
- Status: decided (B, built)
- Mode: explore options
- Repos: kernl   Folders: `src/harnesses.ts`, `src/controller.ts`, `src/acp/`, `src/mcp/`, `src/providers/`, `src/webview/`
- Question / problem: how can kernl show, accurately and as it changes, whether each agent, API key, MCP server, connector, and plugin can actually be used, using read-only checks only?

## Options: one connection monitor fed by read-only status commands and by what real runs report

- **Bottom line:** recommend option B. One "connection monitor" keeps a status for every connection. It is fed by two sources: the CLIs' own read-only status commands, run with exactly the environment kernl launches the agent with, and the live signals real runs already produce (ACP "authentication required", the adapters' auth status pushes, MCP connect results). A Connections view shows it all. The CLIs report everything kernl needs, but kernl reads only one of them today, once per focus.
- **Where we are:** framing done; one live incident traced; 7 tools and the ACP SDK read (binaries, package source, docs); next is the plan.
- **Need from M:** pick an option (see Recommendation).

### The problem, framed

- **What:** kernl's agent chip said Claude Code "isn't logged in" while a Claude Code session in M's terminal worked. M wants every connection's status to be robust and live.
- **Why:** M needs to trust the status: green must mean "will work", red must say exactly why and how to fix it.
- **Who:** M and anyone using kernl with Claude Code, Codex, OpenCode, or kernl's own provider keys.
- **Whom:** the person choosing an agent, or debugging why a run failed.
- **When:** continuously while the panel is open; immediately when a run hits an auth error.
- **Where:** `src/harnesses.ts` (readiness checks), `src/controller.ts:316-328` (refresh), the panel's agent chip and menu.
- **Which:** each CLI's status commands, ACP auth signals, MCP connects, VS Code SecretStorage events, file watchers.
- **How:** see Options.
- **How much:** a new module plus UI. Blast radius: the readiness flow, the agent chip, and the runner's error path.

### The incident (what kernl got right, and what it couldn't say)

- kernl's check was right. `claude auth status` reported `"loggedIn": false, "authMethod": "none"` [verified: run in a clean environment, exit 1]. A new Claude Code process failed with `Failed to authenticate: OAuth session expired and could not be refreshed` [verified: run, about 05:06Z].
- M's terminal session worked because it held the login in memory. It started at 10:29:58 local time, 15 s after a keychain write [verified: `ps`, and the keychain item's modification time].
- The stored login came from clauth (an account switcher). Its log records `refresh for 'pushowl' failed: HTTP 400 ... refresh token revoked` on 2026-10-13 [verified: `~/.clauth/clauth.log`].
- What kernl couldn't do:
  - say *why* it was logged out ("expired" vs "never logged in");
  - notice the change live;
  - tell a working running session apart from a new one.
- A diagnostic real prompt (`claude -p`) made Claude Code clear the dead tokens and drop the clauth symlink [inferred from timestamps; see the flag in the scratch research]. **So status checks must never run a real prompt.**

### What must be true

| Constraint | Kind | Status |
| --- | --- | --- |
| Checks never write credentials or config, and never make a model call | hard (M) | design rule; enforced by an allowlist of status commands |
| A check runs with the same environment and binary kernl launches the agent with | hard | today `runQuiet` uses the extension host's env, not the launch env [verified: `src/harnesses.ts:52-61`, `src/workspaceRuntime.ts:674`] |
| "Not ready" only when definitely not ready; "can't tell" is shown as unknown | convention | [verified: `src/harnesses.ts:5-9`] |
| No secret values shown or logged | hard | importers already follow it |
| Keychain changes can't be watched by file watchers | fact | Claude Code stores logins in the macOS keychain first, the file only as fallback [verified: claude 2.1.303 binary, `keychain-with-plaintext-fallback`; code.claude.com/docs/en/authentication] |

### What each source reports (read-only)

| Source | Command or signal | What it gives | Cost | Evidence |
| --- | --- | --- | --- | --- |
| Claude Code login | `claude auth status --json` | `loggedIn`, `authMethod` (none, claude.ai, api_key, api_key_helper, oauth_token, third_party), plan; exit 1 when logged out. **Doesn't check expiry** | under 1 s | verified: binary and runs |
| Claude Code expiry | `claude auth status --text` | adds "Login: Expired — log in again" | under 1 s | verified: run |
| Claude Code MCP | `claude mcp list` | per server: Connected, Needs authentication, Failed to connect (+issue), Pending approval, Disabled; always exits 0; **connects to every server** | about 4 s | verified: run (6 servers) |
| Claude Code plugins | `claude plugin list --json` | id, version, enabled, MCP servers | under 1 s | verified: run |
| Codex login | `codex login status` | "Logged in using ChatGPT" / "Not logged in", exit 0/1 | under 1 s | verified: runs |
| Codex MCP | `codex mcp list --json` | config only: enabled, auth_status; no health check | 0.2 s | verified: run |
| OpenCode login | `opencode auth list --format json` | integrations (empty here); providers with config headers don't appear | under 1 s | verified: run; storage is `opencode.db`, not the documented `auth.json` |
| OpenCode MCP | `opencode mcp list` | connected, needs authentication, failed | under 1 s | from the binary; nothing configured here to observe |
| Run signal: auth | ACP error `-32000` "Authentication required" | Claude Code and OpenCode at prompt time, Codex at session open or a mid-turn 401 | free | verified: adapters' source and ACP SDK `jsonrpc.js:1032` |
| Run signal: auth status | `_auth/status_update` ext notification (claude-agent-acp, codex-acp) | kind none, account, api_key, gateway, external; account email and plan | free | verified: `auth-status.js`, codex-acp `39605-39680`; SDK `extNotification` at `acp.d.ts:1400` |
| Run signal: MCP | codex-acp `tool_call` titled `mcp__<server>__startup`, status failed | Codex MCP startup failures | free | verified: codex-acp `33359-33530` |
| Login in a terminal | ACP terminal auth methods (`claude-ai-login`, `console-login`, `opencode-login`) | offered when the client advertises `auth.terminal` | free | verified: claude-agent-acp `1293-1460`; opencode binary |
| kernl provider keys | `GET /models` on the provider | key valid or not, no tokens spent | 1 request | Anthropic, OpenAI, DeepSeek, and Google document a models list; custom OpenAI-compatible servers usually serve `/models` [unverified per server] |
| kernl MCP servers | each server's connect + list tools (already done per agent build) | connected (tools), needs sign-in, failed | per server | verified: `src/mcp/servers.ts` |

**Connectors:** claude.ai connectors reach Claude Code as MCP servers, so `claude mcp list` covers them [verified: notion, slack, and datadog appear there with their status].

### Options

| | A: fix the Claude Code check only | B: connection monitor, status commands plus run signals (recommended) | C: run a real tiny request per agent |
| --- | --- | --- | --- |
| How it works | Add `--text` expiry detection and the launch env to `cliReadiness` | One module keeps every connection's status: read-only status commands (launch env, allowlist, timeouts, one at a time per item) on startup, focus, watched-file change, key change, a 60 s poll while the panel is visible, and on demand; plus ACP auth errors, auth status pushes, MCP results, and key-check results as they happen. A Connections view lists everything, with fix actions | Before marking ready, send each agent a one-word prompt |
| Codebase fit | small edit to `harnesses.ts` | replaces `harnesses.ts` readiness; uses existing watchers, runner events, and `KeyStore` | new spend per check |
| Cost and blast radius | low | medium: new module, runner hooks, a panel view | model calls on every check, on M's accounts |
| When it fails | still no MCP, plugin, or key status; still not live | a CLI changes its status output (parsers are pinned to recorded outputs and tested; an unreadable output shows "unknown", never "not ready") | **writes credentials**: a real prompt refreshes tokens, which is what changed M's login today |
| Evidence | incident above | sources table | incident above |
| Completeness | 4/10 | 9/10 | 5/10 (and violates the read-only rule) |

### Flow of the recommended option

```
 triggers                                   connection monitor
 ─────────                                  ──────────────────
 startup, focus, 60 s poll (panel shown) ─┐
 watched files changed (~/.claude.json,   ├─► status checks ──► allowlisted command
   ~/.codex/auth.json, config files)      │   (one per item       with the agent's launch env,
 SecretStorage changed (kernl keys)       │    at a time)         10 s cap, parsed to a status
 "Check now" in the Connections view    ─┘                              │
                                                                        ▼
 run signals ──────────────────────────────────────────────────►  status per connection
   ACP -32000 auth required        (Claude Code, Codex, OpenCode)  { state, detail, source,
   _auth/status_update             (claude-agent-acp, codex-acp)     checkedAt, fix }
   MCP startup failed / connected  (codex-acp, kernl agent)                 │
   provider 401 / key check                                                 ▼
                                                     agent chip, agent menu, Connections view
```

### Recommendation

RECOMMENDATION: B because it is the only option that is both live and read-only. Run signals catch what status commands miss (an expired login that `--json` still calls logged in), and status commands catch what runs haven't hit yet.

### Sources

- Claude Code 2.1.303 binary; runs of `claude auth status`, `claude mcp list`, `claude plugin list --json`
- https://code.claude.com/docs/en/authentication
- claude-agent-acp 0.93.0 `dist/acp-agent.js`, `dist/auth-status.js`, `dist/mcp-command.js`
- codex-acp 2.2.2 `dist/index.js`; Codex CLI 0.163.0 runs
- OpenCode 2.0.32 binary and runs; https://opencode.ai/docs/cli/
- ACP SDK 1.9.0 `dist/schema/types.gen.d.ts`, `dist/jsonrpc.js`, `dist/acp.d.ts`
- clauth 0.17.0 README, `src/keychain.rs`, `src/runtime.rs`; `~/.clauth/clauth.log`
- Models list endpoints: https://docs.anthropic.com/en/api/models-list, https://platform.openai.com/docs/api-reference/models/list, https://api-docs.deepseek.com/api/list-models, https://ai.google.dev/api/models

## Standardized review

- **Bottom line:** usable for the decision. One must-verify item (OpenCode's MCP status wording) doesn't change the recommendation.
- **Criteria:**
  - **Question fit:** pass. It answers "how to make status accurate and live with read-only checks".
  - **Method:** pass. Binaries, package source, and docs were read, and each status command was run in a clean environment.
  - **Source quality:** pass. Primary sources throughout (binaries, source, official docs).
  - **Coverage:** pass. The status quo (A) and a real-call option (C) are included.
  - **Traceability:** pass. File and line references, and runs.
  - **Uncertainty:** pass. Unverified items are named.
  - **Codebase fit:** pass. The current code paths are cited.
  - **Recommendation proportionality:** pass.
- **Findings:**
  1. **must-verify:** OpenCode's `mcp list` wording was read from its binary, not observed (no servers configured). One configured server would confirm the parser.
  2. **note:** `claude mcp list` connects to every server. It's read-only toward kernl, but the CLI may refresh MCP tokens in its own store while connecting. The plan should make that check user-triggered or view-triggered, not a background poll.
  3. **note:** custom OpenAI-compatible servers may not serve `/models`. The plan must treat a 404 as "can't tell", not "invalid key".
