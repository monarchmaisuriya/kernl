# Send options: Send, Queue for later, Send in a forked session

- Date: 2026-10-19 01:00
- Status: done (M: "research and plan and implement ... use your best judgement and finish all")
- Repos: yourstack   Files: `src/ui/protocol.ts`, `src/workspaceRuntime.ts`, `src/controller.ts`, `src/webview/main.ts`, `src/webview/sendMenu.ts` (new), `media/panel.css`, tests, `README.md`
- Subagents: none

## Context and problem

M's screenshot (2026-10-19) shows a send menu with three actions and shortcuts:

| Action | Shortcut |
| --- | --- |
| Send | Enter |
| Queue for later | Cmd+Enter |
| Send in a forked session | Option+Cmd+Enter |

Today the panel can only send when idle; while an agent runs, the Send button is a Stop button and typed messages wait in the box. [verified: `src/webview/main.ts` `submit`; `src/workspaceRuntime.ts:134` ignores sends while running]

## Research (find out)

- **Behavior in the screenshot:** Claude Code's desktop app offers these three actions. Queued messages send in order once the current turn ends.
- **Fork building block:** a fork is a new conversation with this one's history, which YourStack already supports. [verified: `WorkspaceRuntime.fork`, from the fork work]
- **Platform shortcuts:** Cmd on macOS, Ctrl elsewhere (VS Code's convention for the primary modifier).

## Goals / Non-goals

Goals:

- **Send menu:** a chevron next to the send button opens the menu (Send, Queue for later, Send in a forked session), each with its shortcut, Cmd on macOS and Ctrl elsewhere.
- **Shortcuts:**
  - Enter sends; while the agent is running, Enter queues instead (there's nothing else it could do).
  - Cmd/Ctrl+Enter queues.
  - Option/Alt+Cmd/Ctrl+Enter sends in a forked session.
  - Shift+Enter is still a new line.
- **Queue:**
  - Per workspace, kept by the host, so it survives a panel reload. Each item keeps its attachments.
  - When a turn ends normally, the next queued message sends.
  - After Stop or an error, the queue pauses (you didn't want the agent to carry on); a paused item has Send now.
  - Queued messages show above the input with Remove.
- **Send in a forked session:** forks the conversation at its last message, then sends there. The original stays in Conversations.
  - YourStack forks from any message.
  - Claude Code forks its whole session.
  - An agent that can't fork says so, and nothing is sent.
  - With no messages yet, it just sends.

Non-goals:

- Editing queued messages in place (remove and retype).
- Persisting the queue across a window reload.

## Options considered

| | A. Queue in the host runtime (recommended) | B. Queue in the panel |
| --- | --- | --- |
| Survives a panel reload | Yes | No |
| Knows when a turn really ended (done vs stopped vs error) | Yes (runtime sees the finish reason) | Only via messages |
| Completeness | 9/10 | 6/10 |

RECOMMENDATION: A, because the runtime owns runs and their outcome.

## Design

- **Protocol:**
  - `send` gains `mode?: "queue" | "fork"` (absent means send now; while running, a plain send is queued).
  - HostToPanel `queue {workspace, paused, items: {id, text, attachments}[]}`.
  - PanelToHost `unqueue {workspace, id}` and `sendQueued {workspace, id}`.
- **Runtime:**
  - `enqueue()`, `unqueue()`, `sendQueued()`.
  - After `send` finishes with "done", the next item sends; "stopped" or "error" pauses the queue.
  - `sendForked(text, attachments)` forks at the last user message, then sends.
- **Panel:** `sendMenu.ts` builds the chevron and menu with `createElement`; a queued list sits above the input. Keyboard handling lives in the composer.

## Risks and mitigations

| Risk | Likelihood | Impact | Mitigation | How we'd notice |
| --- | --- | --- | --- | --- |
| A queue runs on after the user stopped the agent | Medium | Medium | Pause after Stop or an error; Send now resumes | VS Code check |
| Fork-send on an agent that can't fork loses the message | Low | Medium | It isn't sent; the text stays in the box with a warning | Panel test |

## Acceptance criteria

- **Queue:** given a running agent, when Enter (or Cmd+Enter), then the message is queued and shown, and sends after the turn ends.
- **Stop:** given Stop, then the queue pauses and Send now sends the item.
- **Remove:** given Remove, then the item is gone.
- **Fork-send:** given Option+Cmd+Enter, then a forked conversation gets the message and the original is kept.
- **Menu:** the menu shows the three actions with this platform's shortcuts.

## Parts

- [x] Host: send modes, queue, fork-send.
- [x] Panel: menu, shortcuts, queued list.
- [x] Tests, screenshot, README, package.

## Standardized review

Reviewed with the plan rubric against `src/workspaceRuntime.ts` (send, fork), `src/controller.ts` (send handler), and `src/webview/main.ts` (submit, keydown).

- **Findings, fixed in this file:**
  1. **Must-verify, fixed (failure):** draining the queue after a Stop would surprise the user; it now pauses.
  2. **Note, fixed:** fork-send while the agent runs is refused (forking a run in progress isn't possible); the menu item is disabled while running.
- **Criteria:** all pass.
- **Overall:** 0 blocking, 1 must-verify (fixed), 1 note.

## Changes made

- `src/ui/protocol.ts`:
  - `send` takes `mode` (`now`, `queue`, `fork`);
  - new `unqueue` and `sendQueued` messages;
  - `WorkspaceView` carries `queue` and `queuePaused`, so the queue reaches the panel with the workspace list (also on reload).
- `src/workspaceRuntime.ts`:
  - `submit()` routes the three modes;
  - the queue sends the next message after a run that finished "done";
  - Stop, an error, a new or opened conversation, a harness change, a settings rebuild, or a fork pause it (`holdQueue`);
  - `sendForked()` forks at the last message, then sends.
- `src/controller.ts`: routes the new messages; if a send fails before sending (for example the agent can't fork), the text goes back in the composer with a warning.
- `src/webview/sendMenu.ts` (new): the chevron menu with platform shortcut labels, arrow keys, Escape, click-outside, and `sendModeOf()` for the composer's keys.
- `src/webview/main.ts`, `media/panel.css`, `src/webview/icons.ts`: the send group, the queued list (Remove; Send now once paused), and a clock icon.
- Tests:
  - 3 panel tests (shortcuts, menu, queue list);
  - 2 VS Code checks with the fake agent (queue drains, Stop pauses, Remove, Send now; fork-send);
  - the safety test now covers `sendMenu.ts`.
- Follow-up (M: "finish all"), which replaces the two gaps first shipped:
  - the queue is now saved per workspace in the session store (`queues/<workspace>.json`), comes back paused after a reload, and is cleared by Clear history or Discard;
  - a failed fork-send now returns its attachments too, and mentions already in the text are recognized rather than inserted twice.
- Fixed alongside:
  - the fake test agent's cancel flag now ends only its own turn;
  - the ACP runner waits for the previous session's close before opening the next one: the flaky test failed 36 of 48 runs under load before the fix and 0 of 48 after;
  - Codex now confirms Read-only through its `mode` config option, because codex-acp 2.2.2 never confirms session/set_mode.

## Open questions

None.
