# Choose a CLI agent's model and thinking before the first message

- Date: 2026-10-19 14:05
- Status: done
- Repos: kernl   Folders: `src/`, `test/`   Files: `src/workspaceRuntime.ts`, `src/acp/acpRunner.ts`, `src/controller.ts`, `test/unit/acpRunner.test.ts`, `test/vscode/suite.ts`, `docs/guides/cli-agents.md`, `CHANGELOG.md`
- Subagents: none

## Context and problem

M picked Claude Code in the Develop workspace and saw no model or thinking chips. The chips appear only after the agent has reported its options, and an agent reports them only when a session starts, which happens on the first message. M wants to choose the model and thinking before sending anything.

## Goals / Non-goals

- **Goal:** when a CLI agent is the shown workspace's agent, its model, thinking, and fast chips appear before the first message (within the agent's start time), and a pick applies to the session the first message uses.
- **Goal:** works in a folder where the agent never ran.
- **Non-goal:** a model list kernl keeps itself (the agents report what each account offers).
- **Non-goal:** changing how choices are remembered (per folder and agent, as built).

## What is true today

- Options arrive only from `session/new`, `session/load`, `session/fork`, set replies, and `config_option_update` [verified: `src/acp/acpRunner.ts` `reportOptions` callers].
- A session starts on the first send (`ensureSession` in `send`) [verified: `src/acp/acpRunner.ts:175-181`].
- Before that, the chips show this folder's remembered `last` options, or nothing [verified: `src/workspaceRuntime.ts` `agentOptions()`; `src/webview/main.ts` hides chips without options].
- ACP has no way to ask for an agent's models without a session [verified: SDK 1.9.0 has no models field or `session/set_model`; research notes `acp-options-sessions.md`].
- Claude's adapter gets its models while creating the session: `session/new` starts a Claude Code query and waits for its initialization result [verified: claude-agent-acp 0.93.0 `acp-agent.js:8636-8649`].
- Whether an unused `session/new` leaves an empty entry in the agent's own session list: [unverified: needs one live `session/new` per agent, then `session/list`].

```
pick agent ──> (nothing) ──> first message ──> session/new ──> options ──> chips
                  ^ chips hidden here (no options yet)              <-- the gap
```

## Options considered

| | A: start the session when the workspace shows the agent | B: remember options per agent, across folders | C: B, and A only when B has nothing |
| --- | --- | --- | --- |
| How | When the panel shows a workspace whose agent is a CLI agent and no session is open, kernl opens one in the background (`session/new`, mode confirmed). Chips fill from it; a pick sets it live; the first message uses this session. | Each agent's last reported options are kept in global state and shown in any folder; picks are remembered and applied at `session/new` (as now). | Show B's options at once; when an agent has never reported any on this machine, start its session early as in A. |
| Fits our code | `ensureSession` already does it; it only runs earlier. Remembered choices already apply after `session/new`. | `RememberedOptions.last` moves from per folder to per agent. | Both changes. |
| Cost | The agent starts when shown (it starts on the first message today anyway); an unused session is closed on New chat, agent change, or window close. | None at runtime. | A's cost, only the first time. |
| When it fails | The agent can't start (not logged in): the chip area stays empty and Connections says why, as the first message would. An unused session may appear empty in the agent's own list [unverified]. | First use of an agent on this machine shows nothing; a stale list until the next session (an account's models changed). | Same as A for the first use. |
| Completeness | 9/10 | 6/10 | 8/10 |

RECOMMENDATION: A because it shows exactly what the agent offers now, in every folder, with the session the first message needs anyway; B and C show a remembered list that can be stale.

## Decision

Option A, signed off by M ("Approved: build option A ... with tests"), with the key check fix.

## Design (option A)

```
panel shows workspace (agent = CLI, trusted, no session) ──> runner.prepare()   <-- new
   ──> connect + ensureSession (session/new, remembered choices, mode)          (as today)
   ──> options ──> chips                                                         (as today)
first message ──> send() ──> ensureSession returns the open session              (as today)
```

- **`AcpRunner.prepare()`** (new): connects and runs `ensureSession` without a prompt; returns the failure, if any. Runs at most once at a time; `send` waits for it.
- **When:** the controller calls `ws.prepareAgent()` when the panel becomes visible with that workspace shown, when the shown workspace changes, after an agent change, and after New chat. Never for hidden workspaces, in Restricted Mode, or while a run is active.
- **Failure:** logged; no panel notice (the first message reports it as today, and Connections shows the login).
- **Stop and dispose** close the session as today.

## Risks and mitigations

| Risk | Likelihood | Impact | Mitigation | How we'd notice |
| --- | --- | --- | --- | --- |
| Empty sessions in the agent's own list | Medium [unverified] | Clutter in `claude --resume` and kernl's Conversations | Close unused sessions (`session/close`); check one live run per agent | The live check lists sessions after prepare-then-New-chat |
| An agent starts when only browsing workspaces | Medium | CPU and memory | Only the shown workspace, only when the panel is visible | Process list in the live check |
| A not-logged-in agent fails in the background | High for such agents | None visible | Logged only; Connections already shows it | Log line |
| `send` racing `prepare` | Low | Two sessions | `send` awaits the running prepare | Unit test |

## Acceptance criteria

- Given a folder where Claude Code never ran, when M picks Claude Code, then the model and thinking chips appear without sending a message.
- Given the chips shown, when M picks a model and sends, then the first message runs on that model (one `session/new`, no second session).
- Given a prepared session, when M clicks New chat, then that session is closed and a new one is prepared.
- Given a hidden panel or a workspace that isn't shown, then no agent starts.
- Given Restricted Mode, then no agent starts.

## Rollout and rollback

- No setting; rollback is reverting the change (chips then appear after the first message again).

## Parts

### Part 1: prepare the session early
- [x] `AcpRunner.prepare()`; `send` awaits a running prepare. Done: unit test with the fake agent (prepare reports options, the first send uses the same session, one `newSession` in the log).
- [x] `WorkspaceRuntime.prepareAgent()` and the controller triggers (panel visible, shown workspace, agent change, New chat). Done: VS Code check (chips before the first message; New chat closes and prepares again; hidden workspace starts nothing).
- [ ] Docs and changelog. Done: cli-agents guide updated.
- [ ] Live check with Claude Code (M's OK: it starts a session): chips before the first message; `session/list` after prepare-then-New-chat shows whether an empty session is listed.

## Standardized review

- **Bottom line:** executable after one decision; no blocking findings.
- **Criteria:** goal fidelity pass (the confirmed ask: chips before the first message); current-system accuracy pass (tagged above); scope pass; architecture pass (the runner owns sessions, the controller owns when the panel shows a workspace); sequencing pass (one part); completeness pass (docs, tests); failure handling pass (background failures logged, Connections shows logins); verification pass (unit, VS Code, live); feasibility pass; decision readiness: option A, B, or C.
- **Findings:**
  1. **must-verify:** whether an unused `session/new` leaves an empty session in each agent's list (one live run per agent, with M's OK).
  2. **note:** an agent that's slow to start (Claude: a few seconds) shows the chips after that delay; the folder's remembered chips show meanwhile.

## Changes made

- Built: `AcpRunner.prepare()` (shared while running; a session opened for a conversation that changed meanwhile is closed); `WorkspaceRuntime.prepareAgent()`; controller triggers (panel ready, shown workspace, New chat, agent change, rebuild).
- Fixed while testing: the workspace counted building a runner as running, so a message sent during the early start was queued and never sent; `running` now means a send (its restore point, its wait for the runner, or the reply) or a stored session loading, and each of those drains the queue when it ends.
- Test guard: the VS Code suites point every agent they don't fake at a missing command (`test/support/noRealAgents.ts`), after a cascade let the test window run a real OpenCode prompt.
- Key check: skips a custom provider whose secret header has no stored value yet (`missingSecretHeader`).
- Verified: unit 347 passed; single-folder suite 69/69; multi-root 6/6.

## Open questions

- Option A, B, or C (above).
