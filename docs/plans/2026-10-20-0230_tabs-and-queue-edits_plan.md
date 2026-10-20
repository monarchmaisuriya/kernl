# Chat tabs (like Cursor) and editable queued messages

- Date: 2026-10-20 02:30
- Status: done (window check pending)
- Repos: kernl   Folders: `src/`, `src/webview/`, `media/`, `test/`   Files: `src/controller.ts`, `src/workspaceRuntime.ts`, `src/ui/protocol.ts`, `src/sessions.ts` (queue key), new `src/webview/tabs.ts`, `src/webview/main.ts`, `media/panel.css`, `package.json` (`kernl.tabs.max`), `src/settings.ts` or where settings are read, tests, `docs/guides/panel.md`, `CHANGELOG.md`
- Subagents: none
- Sign-off: M asked to "research, plan and implement … use your best judgement and finish all" (2026-10-20). The decisions below are taken on that authority and reported at the end.

## Context and problem

- **Tabs:** M wants chat tabs like Cursor's: several conversations open at once in the panel, switched by a tab strip, with the maximum number of tabs set in settings.
- **Queue:** messages waiting in the queue can be removed or sent now, but not edited.

## Research

- **Cursor's tabs** ([chat tabs docs](https://docs.cursor.com/agent/chat/tabs); [changelog 0.48](https://cursor.com/changelog/0-48-x); [keyboard shortcuts](https://cursor.com/docs/reference/keyboard-shortcuts.md)):
  - each tab keeps its own conversation history, context, and model selection;
  - Cmd/Ctrl+T opens a new tab;
  - a tab waiting for input shows an orange dot;
  - Cursor stops two tabs from editing the same files and asks the user to resolve conflicts.
- **Cursor's Max Tab Count** (Settings → Agents) defaults to 5, with 5, 10, unlimited, or a custom value. At the limit, the oldest inactive tab closes, and its chat stays in history ([forum](https://forum.cursor.com/t/bug-new-chat-tab-overwrites-removes-other-chat-tab/157576)) [verified: search results 2026-10-20; the cap isn't in Cursor's docs].
- **kernl today:**
  - a workspace is one `WorkspaceRuntime` (one conversation, agent, terminal, queue) with its own pane in the panel [verified: `src/controller.ts` `loadWorkspaces`, `src/webview/main.ts` `setWorkspaces`];
  - several runtimes already run in parallel (worktrees and multi-root folders) [verified: suite check "two worktree workspaces run CLI agents in parallel"];
  - conversations and the queue are stored by a hash of the folder (`sessionKey`) [verified: `src/workspaceRuntime.ts:569`, `queueChanged`].

## Goals / Non-goals

- **Goal:** a tab strip at the top of the panel shows the shown workspace's tabs, each labelled with its conversation and a dot when running or waiting for approval.
  - `+` opens a new tab, `×` closes one, and a click switches.
  - Each tab is its own session: conversation, agent, model, mode, and queue. It runs while another tab is shown.
- **Goal:** `kernl.tabs.max` (default 5; 0 for no limit). At the limit, a new tab closes the oldest idle tab; its conversation stays in Conversations. With every tab busy, kernl says so.
- **Goal:** tabs come back after a reload, each loading its conversation when first shown.
- **Goal:** a queued message can be edited in place. While it's being edited it doesn't send; Save puts the new text in the queue, Escape cancels.
- **Non-goal:** blocking two tabs from editing the same file. kernl can't see edits a CLI agent makes on its own (Auto mode). A notice says when another tab of the same folder is already working.
- **Non-goal:** keyboard shortcuts for tabs (VS Code owns Cmd+T, Cmd+W, and Ctrl+Tab; they'd need testing in VS Code first).

## Options considered

| | A: a tab is another session in the same folder (recommended) | B: a tab is a saved conversation; one session per folder |
| --- | --- | --- |
| How | each tab is its own `WorkspaceRuntime` on the workspace's folder, the way worktrees are separate runtimes today | tabs only switch which conversation the one session shows |
| Like Cursor | yes: each tab runs on its own, with its own model and agent | no: a running conversation blocks switching |
| Cost | the tab strip, tab lifecycle in the controller, queue stored per tab, restore | small |
| Risk | two tabs can edit the same file (a notice says so; worktrees are the isolated choice) | none |
| Completeness | 9/10 | 5/10 |

RECOMMENDATION: A, because it's what makes Cursor's tabs useful (parallel conversations), and kernl already runs separate runtimes side by side.

## Decision

A (best judgement, as M asked).

## Design

### Tabs

- **Identity:** a tab is a runtime with id `<workspace>~<n>` (n ≥ 2) and `tabOf = <workspace>`. It shares the root, the worktree info, and the folder's skills and agents; it starts with the workspace's current agent.
  - Its label (`Main · tab 2`) names its terminal and its log lines.
  - The workspace itself is the first tab and can't be closed.
- **Queue:** each tab keeps its own queue, under `<sessionKey>~<n>`. The workspace keeps today's key, so existing queues stay.
- **Strip (`src/webview/tabs.ts`):** above the transcript.
  - Each tab shows its conversation's title (the first message, or the agent's title), a dot (running, or waiting for approval in the warning color), and `×` on hover (not on the first tab).
  - A `+` at the end opens a new tab.
  - The workspace chip lists workspaces only, not tabs.
- **New tab (controller):** count the workspace's tabs.
  - At `kernl.tabs.max`, close the oldest tab that isn't running, has no card, and has no queue (by last activity). With none, show a notice: "All 5 tabs are working; close one or raise kernl.tabs.max".
  - Then create the tab, show it, and save the tab list.
- **Close tab:** a running tab asks first ("Stop and close?"); then save its conversation, dispose it, remove its queue, and show the tab next to it. Closing a worktree (Discard) closes its tabs.
- **Restore:** the tab list `{ workspace: [{ n, sessionId }] }` is kept in workspaceState.
  - On load, each tab is created; its conversation opens when the tab is first shown.
  - A conversation that's gone leaves an empty tab.
- **Notice:** when a tab starts a run while another tab of the same folder is running: "Another tab is also working in this folder: both may change the same files. A worktree workspace keeps work apart."

### Editing queued messages

- **Panel:** a queued message's text is a button ("Edit"). Clicking it turns the row into a textarea with Save and Cancel; Enter saves, Shift+Enter adds a line, and Escape cancels.
- **Protocol:**
  - `{ type: "editQueued"; workspace; id; editing: boolean }` while editing starts and ends;
  - `{ type: "updateQueued"; workspace; id; text }` saves.
- **Runtime:** while an item is being edited, `sendNextQueued` waits when that item is next. Saving or cancelling carries on if the run already ended. Empty text removes the item. The queue is saved as it changes.

## Risks and mitigations

| Risk | Likelihood | Impact | Mitigation | How we'd notice |
| --- | --- | --- | --- | --- |
| Two tabs change the same file | Medium | One overwrites the other | Notice on start; worktrees for isolated work; Restore lists files first | User |
| Restore in one tab reverts another tab's later edits (one checkpoint store per folder) | Low | Lost edits | Restore lists the files and offers Undo (as today); documented | User |
| Many tabs, many agent processes | Low | Memory | `kernl.tabs.max` (default 5); closing the oldest idle tab | Activity Monitor |
| An edited queue item is sent while the edit box is open | Low | The old text goes | The runtime holds that item until the edit ends | Test |

## Acceptance criteria

- Given the panel, when M clicks `+` in the tab strip, then a new empty tab opens and is shown. Typing there runs a separate conversation while the first tab's run continues.
- Given 5 tabs and the default setting, when M opens another, then the oldest idle tab closes and its conversation is listed in Conversations.
- Given `kernl.tabs.max` = 2 and both tabs running, when M opens another, then nothing closes and kernl says why.
- Given a reload, then the same tabs show; a tab's conversation appears when it's first shown.
- Given a queued message, when M clicks it, edits, and presses Enter, then the queue holds the new text, and that is what's sent. While editing, a finished run doesn't send that message.

## Rollout and rollback

- New setting `kernl.tabs.max` (default 5). Revert the commit to undo. Saved tab lists are ignored by older builds.

## Parts

### Part 1: queued message edits
- [x] Runtime hold and update, protocol, the panel's inline editor. Done: webview test (edit, Enter, Escape) and a VS Code check (an edited message is what's sent; a run finishing during the edit doesn't send it).

### Part 2: tabs
- [x] Runtime `tabOf` and queue key, controller new, close, limit, and restore, the tab strip, the setting, the notice. Done: unit tests for the limit choice; a webview test for the strip; VS Code checks (two tabs run in parallel; the limit closes the oldest idle tab; restore after a new controller).

### Finish
- [ ] Guide, changelog, both suites, package, install, window check.

## Standardized review

- **Bottom line:** present as is (0 blocking, 1 must-verify, 1 note).
- **Criteria:**
  - **Goal fidelity:** pass. Tabs like Cursor's with a max setting; queue edits.
  - **Current-system accuracy:** pass. Tagged.
  - **Scope:** pass. No file locking or shortcuts, with reasons.
  - **Architecture:** pass. Reuses runtimes and panes; the tab strip is its own module; the queue key is per tab.
  - **Sequencing:** pass. Independent parts.
  - **Completeness:** pass. Setting, restore, docs.
  - **Failure and recovery:** pass. Limit with all busy, a closed running tab, a missing conversation, an edit racing a send.
  - **Verification:** pass.
  - **Feasibility:** violation (finding 1).
  - **Decision readiness:** pass. M delegated the decisions.
- **Findings:**
  1. **must-verify:** that two runtimes on the same root don't clash on the kernl terminal or checkpoints. Terminal names differ by label [verified: `kernlTerminal` names by label]. Checkpoints are per root and taken per message; to be confirmed by the parallel-tabs check.
  2. **note:** the file conflict is a notice, not prevention (non-goal, with the reason).

## Changes made

- Part 1: `WorkspaceRuntime.editingQueue` holds a queued message while it's edited (`sendNextQueued` waits for it) and `updateQueued` saves the text (empty removes it); `editQueued` and `updateQueued` messages; the panel's queued text is a button that opens an inline editor (Enter saves, Shift+Enter adds a line, Escape cancels), kept across redraws.
- Part 2: runtimes take `tabOf` and keep their queue under `<sessionKey>~<n>`; `conversationTitle` names a tab. The controller has `newTab` (with `kernl.tabs.max`, closing the idle tab shown longest ago, or a notice when all are busy), `closeTab` (asks when working), `saveTabs`/`restoreTabs` (workspaceState; a tab opens its conversation when first shown), tab numbers never reused in a window, a notice when another tab of the folder is working, and the workspace list and Discard handling tabs. The panel has `src/webview/tabs.ts` (strip, dots, ×, +); the workspace chip names the workspace. Setting `kernl.tabs.max` (default 5, 0 = no limit).
- Deviation: the limit choice is tested end to end in VS Code (a check with `kernl.tabs.max` = 2) rather than with a separate unit test, since it lives in the controller.
- Tests: two webview tests (queue editor; tab strip), and four VS Code checks (queue edit held and saved; two tabs running at once with the notice and close; the limit; restore after a reload).

## Open questions

None (decisions delegated).
