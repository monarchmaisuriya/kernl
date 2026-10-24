# Archive and unarchive conversations

- Date: 2026-10-24 07:00
- Status: done
- Repos: kernl   Files: `src/sessions.ts`, `src/controller.ts`, `src/workspaceRuntime.ts`, `src/ui/conversationRows.ts`, `src/ui/protocol.ts`, `src/webview/conversations.ts`, `src/webview/icons.ts`, `media/panel.css`, `src/dataTransfer.ts`, `test/unit/conversationRows.test.ts`, `test/unit/sessions.test.ts`, `test/unit/webview.test.ts`, `test/unit/dataTransfer.test.ts`, `test/vscode/suite.ts`, `docs/guides/panel.md`, `CHANGELOG.md`
- Subagents: none
- Research: `docs/research/2026-10-24-0640_archive-conversations_research.md` (option A)
- Sign-off: M (2026-10-24): "research, plan, review, fix, implement, commit, merge, build, release - archive/unarchive chats"; then "Approved, build it" with answers: open tab starts a new conversation; opening an archived conversation keeps it archived; `@` leaves archived out.

## Context and problem

The Conversations view lists every conversation a workspace has ever had, newest first. The only way to shorten it is **Delete conversations**, which deletes all of them [verified: `src/controller.ts` `clearHistory`]. There's no per-conversation delete or hide [verified: `grep -rn "sessions.remove" src` finds no caller]. M wants to put finished conversations out of the way without losing them, and bring them back.

## Goals / Non-goals

Goals:
- Archive any of kernl's kept conversations from its row in Conversations.
- Archived conversations show in an "Archived" group at the bottom of the same view, and search finds them there.
- Unarchive puts one back in its place (by last activity).
- Nothing is deleted. Export and Import carry the archived state.

Non-goals:
- Deleting a single conversation (a separate feature).
- Archiving a CLI agent's own sessions that kernl hasn't opened (they belong to the agent).
- A Command Palette command, or Archive all.

## What is true today

```
clock icon ─> controller.showSessions ─> sessions.list(key) ─> conversationRows(kept, agents) ─> panel "conversations"
row click ─> panel { openConversation } ─> controller.openConversation ─> runtime.openSession(record)
```

- A conversation is one JSON file per workspace key. `save()` sets `updatedAt = Date.now()` and writes through a per-file queue [verified: `src/sessions.ts:96-110`, `:143-151`].
- `list()` builds summaries (`id`, `title`, `harness`, `updatedAt`, `messages`, `agentSessionId`) and caches them by file size and modification time [verified: `src/sessions.ts:184-210`].
- Rows: "New conversation", then kernl's conversations (group "Conversations"), then each CLI agent's sessions not opened in kernl. That last group skips sessions a kept conversation continues (`linked`) [verified: `src/ui/conversationRows.ts:37-74`].
- A row is one `<button>`. Search filters by title [verified: `src/webview/conversations.ts:50-75`].
- An open conversation's record lives in its tab's runtime. New chat calls `newThread()`, which saves the old record (without waiting) and starts a new one [verified: `src/workspaceRuntime.ts:626-634`, `:768-781`].
- A tab restored after a reload remembers its conversation id until it's first shown (`tabConversation`) [verified: `src/controller.ts:195`, `:1792-1793`].
- `@` lists kept conversations from every workspace as attachable threads [verified: `src/controller.ts:1418-1430`]. Export copies each record as it is [verified: `src/controller.ts:1222-1225`]. Import validates known fields and passes the rest through [verified: `src/dataTransfer.ts:160-172`].
- Unverified: whether one conversation can be open in two tabs. `openConversation` only refuses the same tab [verified: `src/controller.ts:1166`]. The design handles every tab showing it either way.

## Options considered

From the research file:

| | A: `archivedAt` on the conversation's file | B: a separate archived list per workspace |
| --- | --- | --- |
| How | `SessionRecord.archivedAt?: number`; the summary carries it | `archived/<key>.json` of ids; `list()` joins it |
| Fit | Same as `forkOf` and `agentTitle`; Export and Import carry it | New file; `clear`, Export and Import all need changes |
| Fails when | A tab still holding the record saves over the flag. Designed out below | A stale id after deletion (harmless) |
| Completeness | 9/10 | 7/10 |

RECOMMENDATION: A, because the conversation's own file stays the single source of truth.

## Decision

Option A. The archived state lives on the conversation's record. The rule that keeps it safe: **every holder of the record agrees with the file**.

- Every tab holding the conversation sets or clears `archivedAt` on its in-memory record, so its later saves keep the state.
- The store then does a read, change and write inside its per-file write queue, so no other save can come between the read and the write.
- Archiving (M's answer 1): a tab showing it then starts a new conversation.

## Design

### Archive

```
row: Archive ─> panel { archiveConversation, workspace, id }  <-- new message
controller.setArchived(workspace, id, archived):
  tabs in this workspace key holding id ─> runtime.markArchived(archivedAt | undefined)   <-- new; changes its in-memory record
  restored tabs remembering id (tabConversation) ─> untouched: they open the file, which has the state
  sessions.setArchived(key, id, archivedAt | undefined)   <-- new; read, change, write in the file's queue; updatedAt kept
  archiving: each tab showing it ─> (working? "Stop the agent and archive?") ─> starts a new conversation
  re-send the rows (the view stays open)
```

### Unarchive and opening an archived conversation

- **Unarchive** (on an archived row): `sessions.setArchived(key, id, undefined)`. The row returns to "Conversations" by `updatedAt`.
- **Opening** an archived row opens it and it stays archived (M's answer 2): the tab's record keeps `archivedAt`, so its saves keep it archived. Unarchive while it's open clears the tab's copy too.

### Rows and panel

- `SessionSummary.archivedAt` and `KeptConversation.archivedAt`.
- `conversationRows`:
  - unarchived rows stay in "Conversations";
  - archived ones go to a group "Archived" after the CLI agents' groups, newest archived first;
  - each kernl row gets `archived: boolean`;
  - `linked` still counts archived conversations, so their agent sessions don't reappear.
- The panel row becomes a container, because a button can't hold a button:
  - the open button (as today);
  - an icon button at the row's end, shown on hover and keyboard focus: Archive (`archive` icon), or Unarchive (`unarchive` icon) on archived rows;
  - `aria-label` "Archive <title>" or "Unarchive <title>".
- The "Archived" group starts collapsed as "Archived (N)", which a click expands. While the search box has text, matching archived rows show expanded.
- The current conversation's row can be archived too (M's answer 1). An open archived conversation shows under Archived with its current mark.

### `@` mentions and other readers

- The `@` list leaves archived conversations out (M's answer 3). A thread tagged before archiving still reads, since it's read by id.
- Export: unchanged; records carry `archivedAt`.
- Import: `archivedAt` must be a finite number when present.

### Contracts touched

- Protocol, new panel messages `archiveConversation` and `unarchiveConversation` (`{ workspace, id }`), added to `PANEL_MESSAGE_TYPES`.
- `ConversationRow` gains `archived`.
- Stored files gain an optional `archivedAt`. Older versions ignore it: they show archived conversations as ordinary ones, which loses nothing.

## Risks and mitigations

| Risk | Likelihood | Impact | Mitigation | How noticed |
| --- | --- | --- | --- | --- |
| A tab's save overwrites the flag | Medium without the design | Archive silently undone | Every holder's copy changes with the file; the store's change runs inside its write queue | Suite: archive the open conversation, send in the new one, reopen the list |
| An archived conversation's CLI session reappears under "not opened in kernl" | Medium | Duplicate row | `linked` includes archived | Unit test on `conversationRows` |
| Archive feels like loss (the Cursor complaint) | Low | Confusion | The group is in the same view with a count, and search finds archived rows | Webview test |
| A restored tab reopens an archived conversation | Medium | None: it opens archived (answer 2) and reads the state from the file | Suite check |
| Another VS Code window has it open | Low | That window's next save drops the flag | Same as any cross-window save today; noted in the docs | Not covered by tests |

## Acceptance criteria

- Given a conversation in Conversations, when I click Archive, then it moves to "Archived (N)" and its file still has every event.
- Given an archived conversation, when I click Unarchive, then it's back in "Conversations" at its old position.
- Given the conversation open in this tab, when I archive it, then the tab shows a new conversation and the archived one stays archived after the tab's next save.
- Given archived conversations, when I search, then matching archived rows show under "Archived".
- Given an archived conversation that continues a Claude Code session, then that session isn't listed as "not opened in kernl".
- Given `@`, then archived conversations aren't offered.
- Given an archived conversation opened in a tab, when a message is sent there, then it stays archived; when I click Unarchive, then it stays unarchived after the tab's next save.
- Given Export then Import, then archived conversations come back archived.

## Rollout and rollback

Branch `archive-conversations`, PR, merge, then release 0.14.0 (a new feature: minor) and install. Rollback: revert the merge. Files with `archivedAt` are read fine by the older version.

## Parts

### Part 1: store and rows

- [x] `archivedAt` on the record and summary. `SessionStore.setArchived` does a read, change and write in the file's queue and keeps `updatedAt`. Done: unit tests (keeps events and `updatedAt`; a save queued at the same time doesn't lose it).
- [x] `conversationRows`: the "Archived" group, `archived` on rows, `linked` including archived. Done: unit tests.
- [x] Import validation of `archivedAt`. Done: unit test.

### Part 2: host and runtime

- [x] Protocol messages. `controller.archiveConversation` and `unarchiveConversation`. `runtime.markArchived`. An open archived conversation stays archived through its saves. Archived conversations are left out of `@`. Done: suite checks for archiving the open conversation (the tab moves on; the flag survives its save), unarchiving an open archived one (survives a send), and `@`.

### Part 3: panel, docs, verification

- [x] Row container, Archive and Unarchive buttons, the collapsible "Archived (N)" group, search. Done: webview unit tests; seen in a real test window.
- [x] `panel.md` (Conversations), changelog. Then tsc, unit, both suites, and a real window. Done: all pass.

## Standardized review

**Bottom line:** plan, approve with notes. It solves the confirmed problem (hide, keep, bring back) at the owning layers: the store for the flag, the runtime for an open record, and the rows builder for grouping. The one real hazard, a tab's save overwriting the flag, is designed out rather than patched. Three behavior choices are left to M.

| Criterion | Verdict | Evidence |
| --- | --- | --- |
| Goal fidelity | pass | Archive, unarchive and keep, in the view M uses |
| Current-system accuracy | pass | Each claim cited; the two-tabs question marked unverified |
| Scope and cohesion | pass | Delete and agent-session hiding are non-goals |
| Architecture and dependency direction | pass | The holder of the record writes it; rows stay a pure function |
| Sequencing | pass | Store and rows, then host, then panel |
| Completeness | pass | Export, Import, `@`, restored tabs, CLI dedupe, older versions |
| Failure and recovery | pass | The save race, a working tab (asks), other windows (noted), rollback |
| Verification | pass | Unit tests per piece; suite checks for the race and restored tabs; real window |
| Feasibility and precision | pass | Named files exist [verified: `test/unit/conversationRows.test.ts`, `test/unit/sessions.test.ts`]; new messages and icons are marked new |
| Decision readiness | pass | Questions 1 to 3 below |

Findings:
- **Note, Chesterton's fence:** the row is a single `<button>` for keyboard and click handling. The container must keep Enter and click opening it, and Tab reaching the Archive button.

## Changes made

- Part 1: `SessionRecord.archivedAt` and the summary field; `SessionStore.setArchived` runs its read, change and write in the file's queue (`inTurn`) and keeps `updatedAt`; `conversationRows` puts archived conversations last under "Archived" (newest archived first) with `archived` on each kernl row, still counting them as linked; Import checks `archivedAt` is a number. Test finding (M approved the correction): my first store test saved a copy the tab hadn't marked, which the design rules out; the tests now mark the copy first, in both orders.
- Part 2: panel messages `archiveConversation` and `unarchiveConversation`; `controller.setArchived` acts only on an id the workspace keeps (the id names a file), marks every holding tab (`WorkspaceRuntime.markArchived`), asks before archiving where an agent works, moves those tabs to a new conversation, and draws the view again. The view's drawings now read the list each time (an agent answering after an archive no longer brings the old list back), and a drawing that read before a newer one is dropped. `@` leaves archived conversations out.
- Part 3: each kernl row is a list item with its open button and an Archive or Unarchive button (shown on hover or focus); "Archived (N)" folds the group (folded each time the view opens; a search shows matches); new `archive` and `unarchive` icons; panel guide and changelog.
- Verified: tsc clean; unit 426/426; single-folder 104/104; multi-root 7/7. Real window: archive moves a row to Archived and keeps every event; no "Looking for" row left; the hover covers the row and its Archive button.
- Verification findings: (1) my suite check never answered the fake agent's write approval, so the run hung; it now rejects the card. (2) My bad-id assertion counted an agent-list redraw as an effect; it now checks that no tab moves on and the rows are unchanged. (3) Real window: the redraw after an archive left "Looking for … sessions" rows that never resolved, because it rebuilt agent state without asking the agents. M approved the fix: `drawConversations` draws and asks every pending agent, for opening and for the redraw alike; the suite check now waits for a redraw with no pending row. The row's hover background moved to the row container, so it covers the Archive button.

## Open questions

- None (M answered all three).
