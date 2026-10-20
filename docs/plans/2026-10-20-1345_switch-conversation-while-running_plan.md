# Switch conversations while the agent works

- Date: 2026-10-20 13:45
- Status: done (window check pending)
- Repos: kernl   Folders: `src/`, `test/vscode/`   Files: `src/workspaceRuntime.ts`, `src/controller.ts`, `test/vscode/suite.ts`, `docs/guides/panel.md`, `docs/guides/help.md`, `CHANGELOG.md`
- Subagents: none

## Context and problem

In 0.7.1, picking a conversation in the Conversations view while the agent works shows a note: "Stop the agent to open another conversation". Before that, it silently did nothing. M wants the switch itself to work: ask, stop the agent, then open the picked conversation.

The obstacle is timing. Stop asks the agent to end its turn and returns at once; the turn ends a moment later. Opening a conversation is refused while a turn is still in progress. Nothing in kernl today waits for a stopped turn to finish.

## Goals / Non-goals

- **Goal:** picking a conversation (kernl's, or a CLI agent's own session) while the agent works asks "Stop the agent and open this conversation?". Confirming stops the turn, waits until it has ended, and opens the conversation. Declining changes nothing.
- **Goal:** a turn that doesn't end within 15 s after Stop is reported ("The agent didn't stop within 15 s; press Stop, then open the conversation again"), and nothing is opened.
- **Goal:** Stop pressed while kernl is still starting the agent is no longer lost (found while tracing; see "What is true today").
- **Goal:** the three "stop first?" questions (New chat, Close tab, open a conversation) come from one place.
- **Non-goal:** opening a conversation in another tab while this one keeps working (option C below; a separate decision).
- **Non-goal:** changing what Stop does to the agent.

## What is true today

```
Conversations pick (running)
   -> controller.openConversation: "Stop the agent to open another conversation" note   <-- changes
Stop
   -> runtime.stop(): marks a starting send as stopped, or tells the runner to stop
   -> returns at once; the turn ends later, when the runner's send() returns
   -> runtime.send() then saves, holds the queue, refreshes the panel
```

- **What "running" is:** any of a send starting (restore point, tagged threads), a send waiting for its runner to be built, a stored session loading, or the runner's turn [verified: `src/workspaceRuntime.ts:241-244`].
- **Opening refuses while running:** `openSession` and `openAgentSession` return early [verified: `src/workspaceRuntime.ts:752,971`]. 0.7.1's note is in `openConversation` [verified: `src/controller.ts` `openConversation`].
- **Stop returns at once:**
  - the runtime's `stop()` is synchronous [verified: `src/workspaceRuntime.ts:582-585`];
  - a CLI agent's turn ends when the agent answers the cancel; open approvals are answered as cancelled [verified: `src/acp/acpRunner.ts:221-226,628`];
  - kernl's own agent aborts its request [verified: `src/agent/session.ts:214-218`].
- **Stop while the runner is being built is lost:**
  - while a send waits for its runner, there is no runner, so `stop()` stops nothing;
  - `stopBeforeStart` is only set while `starting`, and only checked before the runner is built;
  - so the send goes on to the agent after Stop

  [verified: `src/workspaceRuntime.ts:528-547,582-585`]. The window is short (building a runner reads stored keys) [inferred: `createRunner` runs before any agent process starts].
- **The queue after a stopped turn is paused** (`holdQueue`), so nothing queued sends into the newly opened conversation [verified: `src/workspaceRuntime.ts:550-555`].
- **Questions today:**
  - New chat: "Stop the agent and start a new chat?" / "This conversation stays in Conversations." [verified: `src/controller.ts` `newChat`];
  - Close tab: "Stop the agent and close this tab?" / "Its conversation stays in Conversations." [verified: `src/controller.ts:522`].

## Options considered

| | A: keep the note (today) | B: ask, stop, wait, open (recommended) | C: open it in a new tab, keep this one working |
| --- | --- | --- | --- |
| How | the pick is refused with a note | the runtime gets a "stop and wait until the turn has ended" step; the controller asks, then uses it, then opens | the pick opens in a new tab of the same workspace |
| Matches decisions so far | n/a | yes: New chat and Close tab already ask, then stop | no question needed, but a tab appears that you didn't ask for |
| Cost | none | small: one runtime method, one helper, the Stop fix | medium: tab limit, which tab to show, which agent |
| When it fails | always needs two steps | an agent that never answers the cancel: reported after 15 s | `kernl.tabs.max` reached with every tab busy |
| Completeness | 4/10 | 9/10 | 7/10 |

RECOMMENDATION: B, because it does what you asked with the same question New chat and Close tab already use, and the wait is owned by the runtime, which is the only layer that knows when a turn has ended.

## Decisions for M

- **D1, behavior:** B (above).
- **D2, the wait limit:** 15 s, fixed. A CLI agent ends a cancelled turn as soon as it answers the cancel, and kernl's agent aborts its request; 15 s leaves room for a slow agent. A setting isn't worth it until someone hits the limit.

## Design

### Runtime (`src/workspaceRuntime.ts`)

- **Track every run:** a private set of in-flight runs:
  - `send()` (its whole body, from starting to saving);
  - `openAgentSession()`;
  - `addTurnsFromAgent()`.

  Each adds its promise when it starts and removes it when it settles. This is the one place that knows when "running" can turn false.
- **`stopAndWait(ms = 15_000)`:** if not running, returns. Otherwise:
  - calls `stop()`;
  - waits for the in-flight runs to settle;
  - checks `running` again, and loops while a new run started meanwhile, within the same deadline.

  When the deadline passes, it throws `Error("The agent didn't stop within 15 s; press Stop, then try again.")`.
- **Stop while the runner is built:**
  - `stop()` sets `stopBeforeStart` while `starting` or `awaitingRunner`;
  - after the runner is built, `send()` checks `stopBeforeStart` and ends the turn as "stopped", as it already does after the restore point;
  - one shared private method `endBeforeAgent()` holds the existing "finished stopped, hold queue, save" steps, so both checks use it.

### Controller (`src/controller.ts`)

- **One question helper:** `private async confirmStop(ws, question, button): Promise<boolean>`. It returns true when the workspace isn't running; otherwise it asks with the detail "This conversation stays in Conversations.".
  - `newChat` uses it with "Stop the agent and start a new chat?";
  - `closeTab` uses it with "Stop the agent and close this tab?";
  - `openConversation` uses it with "Stop the agent and open this conversation?".
- **`openConversation`:**
  - after it knows what to open (the agent's session exists; a kept conversation loads and isn't the current one), it calls `confirmStop`, then `await ws.stopAndWait()`;
  - if that throws, it shows the message as a warning and opens nothing;
  - the 0.7.1 note goes.

### Changed flow

```
Conversations pick (running)
   -> confirmStop: "Stop the agent and open this conversation?"     <-- new
        no  -> nothing changes
        yes -> ws.stopAndWait()                                      <-- new
                 stop(); wait for in-flight runs (max 15 s)
                 ended    -> open the conversation (as when idle)
                 timeout  -> warning, nothing opened                 <-- new
```

## Risks and mitigations

| Risk | Likelihood | Impact | Mitigation | How we'd notice |
| --- | --- | --- | --- | --- |
| An agent never answers the cancel | Low | The switch fails | 15 s limit, then a warning; Stop still works | User sees the warning |
| A run starts between the wait and the open (a queued message) | Low | The open is refused | The queue is paused after a stopped turn; `stopAndWait` loops while running | VS Code check |
| A send skips the tracking | Low | `stopAndWait` returns while still running | Every run goes through the tracked methods (send, both session loads); the open's own check still refuses | VS Code check |
| The new Stop check changes a working path | Low | A send that should run is stopped | Only set by Stop, and cleared at each send's start, as today | Suites |

## Acceptance criteria

- Given the agent is working, when M picks another kept conversation and confirms, then the turn ends as stopped and the picked conversation shows. Nothing queued is sent.
- Given the same, when M declines, then the run continues and the conversation shown doesn't change.
- Given the agent is working, when M picks one of the CLI agent's own sessions and confirms, then that session opens.
- Given an agent that never ends its turn after Stop, when M confirms, then after 15 s a warning says it didn't stop, and nothing opens.
- Given New chat, Close tab, and open a conversation while working, then all three ask with the same detail line.

## Rollout and rollback

- No settings or stored data. Revert the commit to undo.

## Parts

### Part 1: runtime
- [x] Run tracking, `stopAndWait`, Stop while the runner is built. Done: VS Code check (below) and both suites green.

### Part 2: controller
- [x] `confirmStop` used by New chat, Close tab, and `openConversation`; the 0.7.1 note removed. Done: a VS Code check. Its flow: start a run, pick a kept conversation, decline (still running, same conversation), confirm (stopped, that conversation's message shows, run promise settles).
- [x] The timeout path. Done: a VS Code check with a fake-agent switch that ignores cancel (new `FAKE_IGNORE_CANCEL`) and a short limit passed in by the test, showing the warning and no open.

### Finish
- [x] Guide lines (panel, help), changelog, unit tests, both suites, package, install.

## Standardized review

- **Bottom line:** present as is (0 blocking, 1 must-verify, 1 note).
- **Criteria:**
  - **Goal fidelity:** pass. Switching works with the same question as New chat.
  - **Current-system accuracy:** pass. Tagged with lines.
  - **Scope:** pass. Opening in a new tab is excluded, with a reason.
  - **Architecture:** pass.
    - The runtime owns "when has the turn ended".
    - The controller owns the question.
    - The three questions share one helper.
  - **Sequencing:** pass. Controller depends on the runtime method.
  - **Completeness:** pass. Docs, changelog, the found Stop bug.
  - **Failure and recovery:** pass. Timeout, decline, a run starting meanwhile.
  - **Verification:** violation (finding 2).
  - **Feasibility:** violation (finding 1).
  - **Decision readiness:** pass. D1 and D2.
- **Findings:**
  1. **must-verify:** that the fake agent can be told to ignore a cancel without changing other checks. It needs a new switch in `test/fixtures/fakeAcpAgent.ts` [unverified: read its cancel handler while building].
  2. **note:** the lost-Stop window (Stop while the runner is being built) is milliseconds long, so no check reproduces it reliably. The fix is covered by reading and by the suites staying green, not by a dedicated test.

## Changes made

- Sign-off: M approved D1 B and D2 15 s (2026-10-20).
- Part 1:
  - `WorkspaceRuntime` tracks sends and session loads (`track`; `send` wraps `sendNow`; `openAgentSession` and `addTurnsFromAgent` are tracked);
  - `stopAndWait(ms = STOP_WAIT_MS)` stops, waits for them, loops while running, and throws on the deadline, or when something runs that isn't tracked;
  - `stop()` also covers the runner being built, and `send` checks it after the runner is built (`endBeforeAgent`).
- Part 2:
  - `confirmStop` is used by New chat, Close tab, and opening a conversation (Close tab's detail is now "This conversation stays in Conversations.");
  - `stopToOpen` asks, waits, and shows a warning on timeout;
  - the 0.7.1 note is removed.
- Tests:
  - fake agent `FAKE_IGNORE_CANCEL`;
  - VS Code checks: stopAndWait (resolves once ended; rejects after 0.5 s for an agent that ignores Stop), and opening a conversation while working (decline keeps the run; confirm stops, waits, and opens).
- Deviation: the timeout check builds its own runtime (the suite's pattern for agent-specific behavior) instead of going through the panel, so the stuck agent is disposed without affecting later checks.

## Open questions

- D1 and D2 above.
