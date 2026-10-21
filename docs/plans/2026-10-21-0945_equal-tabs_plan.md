# Equal tabs: any tab can close, except the last one

- Date: 2026-10-21 09:45
- Status: done (not committed; branch equal-tabs in ../kernl-equal-tabs)
- Repos: kernl   Files: `src/controller.ts`, `src/workspaceRuntime.ts`, `src/webview/tabs.ts`, `src/ui/panelCommands.ts`, `src/ui/protocol.ts` (comment only, if needed), `test/unit/webview.test.ts`, `test/unit/quickAccess.test.ts`, `test/unit/panelCommands.test.ts` (if it covers `/close`), `test/vscode/suite.ts`, `docs/guides/panel.md`, `CHANGELOG.md`
- Subagents: none
- Sign-off: M chose (2026-10-21) "Make all tabs equal" over hiding the first tab, and "Can't close the last one".

## Context and problem

M wants to close any tab. Today only tabs after the first show ×; the first tab ("New chat") can't close, so a workspace always keeps it even when M is done with that conversation.

## Goals / Non-goals

- Goals: every tab closes the same way while the workspace has two or more; the last tab can't close (no ×, ⌘W does nothing, `/close` says so); everything that works per workspace (agent, mode, worktree review/merge/discard, the workspace menu, restore after reload) works whichever tabs are open.
- Non-goals: closing a workspace itself (folders and worktrees stay as today); changing tab ids of existing tabs; the import/export feature (its own session).

## What is true today

- The first tab is the workspace's own runtime (`main`, `folder:<name>`, `wt:<name>`); other tabs are runtimes `<workspace>~<n>` with `tabOf` set [verified: `src/controller.ts:497-505` builds one runtime per folder and worktree; `addTab` at :589-596].
- "No `tabOf`" means "is a workspace" in: startup's shown workspace (:517), `folderIdOf` (:535-538), `tabsOf` (:557-561), `newTab` (:568-575), `closeTab` (:598-615, "never a workspace's first"), `saveTabs`/`restoreTabs` (:618-640, only `n >= 2` saved), the Conversations listing (:1245), the ⌘W context key (:1608), merge and discard (:1697-1722), and the workspace menu (:1794-1800) [verified].
- The runtime names a tab's queue file by `tabOf` (`<sessionKey>~<n>`); the first tab uses `sessionKey` [verified: `src/workspaceRuntime.ts:754-756`]. All tabs of a workspace share `sessionKey` (the folder's conversation store) [verified: :766-768].
- The panel shows × and Delete-to-close only for views with `tabOf`, and numbers a view without `tabOf` as 1 [verified: `src/webview/tabs.ts:58`, `:84`, `:121`]; it groups tabs by `tabOf ?? id` [verified: :83-85, `src/webview/main.ts:374-376`].
- A missing workspace runtime isn't handled anywhere: code that looks up the workspace by its id (`this.workspace(tab.tabOf)`) assumes the first tab exists [verified: :569, :606, :1698, :1711].

## Options considered

| | Hide the first tab | Equal tabs (chosen) |
| --- | --- | --- |
| How | Keep the first tab's runtime but hide it | Separate the workspace (folder or worktree, label, agent) from its tabs; every tab is a runtime with `tabOf` |
| Completeness | 8/10 | 9/10 |
| Risk | Medium | Larger: every "no `tabOf`" check moves to the workspace record |

M chose equal tabs.

## Decision

The controller keeps a record per workspace (id, label, root, worktree info, folder, agent the workspace follows), separate from the tab runtimes. Every runtime has `tabOf` = its workspace id, including tab 1, whose id stays `<workspace>` (no rename: transcripts, saved queues, saved state, and the tests keep working). Workspace-level code reads the record; tab-level code reads runtimes. Closing works on any tab while the workspace has two or more.

## Design

```
before                                   after
workspace runtime "main"  <- the tab 1   workspace record "main" (label, root, info, agent)
  ├─ tab runtime "main~2"                  ├─ tab runtime "main"    (tab 1, closable)   <-- changed
  └─ tab runtime "main~3"                  ├─ tab runtime "main~2"
                                           └─ tab runtime "main~3"
```

- **Workspace record** (`controller.ts`): `{ id, label, root, info?, folderId, followsHarnessSetting, harness }`, made in `loadWorkspaces`/`addWorktree` alongside the first tab; removed with the worktree on discard.
- **Tabs:** `tabsOf(workspaceId)` = runtimes with `tabOf === workspaceId`, by number (an id without `~` is 1). `addTab(workspace)` takes the record (its root, info, and agent), not the first tab. A closed tab's number isn't reused in the window (today's rule), so a closed tab 1 never comes back as `main` until a reload restores it.
- **Showing a workspace** (workspace menu, startup, a worktree just created, after discard): a new `shownTabOf(workspaceId)` picks the workspace's last shown tab, else its first open tab. Every place that passes a workspace id as the tab to show goes through it.
- **Close:** `closeTab(id)` works on any tab whose workspace has two or more open; it asks first while the agent works (as today), saves the conversation (it stays in Conversations), removes the tab's queue file, and shows the tab to its left (or right, for tab 1).
- **Runtime:** `tabOf` is always set; the queue file name keeps today's names (`sessionKey` for an id without `~`, `<sessionKey>~<n>` otherwise), so saved queues still load.
- **Save and restore:** a new saved shape lists every open tab per workspace, tab 1 included (`kernl.tabs.open`). Restore creates the listed tabs and then closes tab 1 if it isn't listed (never leaving a workspace without a tab). The old shape (`n >= 2` only) still restores, with tab 1 open.
- **⌘W, `/close`, Delete, middle-click, ×:** available when the shown tab's workspace has two or more tabs. The context key `kernl.tabClosable` follows that; `/close` on the last tab says "The last tab can't be closed." The panel shows × on every tab while there are two or more.
- **Agent:** picking an agent on any tab already saves it for the workspace (`kernl.harness` for Main, the remembered choice for a worktree or a multi-root folder) [verified: `setHarness`, `src/controller.ts`]. The record's `harness` follows the same pick, and a new tab takes it, so closing tab 1 doesn't change what new tabs use.
- **`/close` in the panel:** `commandAvailable(command, view, restricted)` decides from `view.tabOf` [verified: `src/ui/panelCommands.ts:19`, `:57`]. It gains the workspace's open-tab count (the panel has it from the views), and `close` is available when it's two or more; the `unavailable` text becomes "The last tab can't be closed."
- **Tab limit:** at `kernl.tabs.max`, the idle tab shown longest ago closes first; today tab 1 is never picked (`t.tabOf &&`) [verified: `src/controller.ts:574`]. With equal tabs any idle tab can be picked, tab 1 included. Its conversation stays in Conversations, as for any tab.

### Refined in the write-scope rescan (2026-10-21, before code)

- `commandAvailable(command, view, restricted, openTabs)`: the open-tab count is an argument (the panel counts its views; the host counts `tabsOf`), not a protocol field.
- `WorkspaceView.tabOf` is always set and `workspaceLabel` is new (the footer's workspace chip read the name from tab 1's view [verified: `src/webview/main.ts:374-375`]); the runtime takes both with defaults (its own id and label: tab 1), so existing constructors stay valid.
- Tab 1 is the tab whose id equals its `tabOf`; its queue file keeps the name `sessionKey` (a rule by id, not by "no `~`", so a folder name with `~` can't confuse it).
- At `kernl.tabs.max` the new tab is added first, then the idle tab shown longest ago closes, so the last-tab rule never blocks it (`tabs.max = 1` replaces the tab).
- `newWorkspace` and `activeFolder()` read the record's root (they looked up tab 1 [verified: `src/controller.ts:645-646`, `:1686-1687`]); the Conversations listing names the workspace from the record.

## Risks and mitigations

| Risk | Likelihood | Impact | Mitigation | How noticed |
| --- | --- | --- | --- | --- |
| A path still looks up the workspace through its tab 1 runtime | Medium | A crash or a no-op after tab 1 closes (merge, discard, menu) | Grep every `tabOf ?? `, `!w.tabOf`, `this.workspace(…tabOf)`; suite checks merge, discard, menu, and new tab with tab 1 closed | Suite checks |
| Restore loses tabs (the 0.10.1 bug class) | Low | Tabs gone after reload | Keep `tabsRestored`; suite check reloads with tab 1 closed | Suite check |
| Old saved tab lists | Low | Tab 1 closed after an upgrade | Read the old key as "tab 1 open" | Unit test |
| The import/export session edits `controller.ts` at the same time | Medium | Overwritten edits in the shared folder | Build these one at a time; that session is still at the plan stage | Before building, `git status` and the other session's state |

## Acceptance criteria

- Given two tabs, when M closes tab 1 (×, ⌘W, `/close`, Delete, middle-click), then tab 1 leaves the strip, its conversation is in Conversations, and tab 2 is shown.
- Given one tab, then it has no ×, ⌘W does nothing, and `/close` says "The last tab can't be closed."
- Given tab 1 closed, when M picks the workspace in the workspace menu, then its open tab is shown; new tabs use the workspace's agent; a worktree still merges and discards.
- Given tab 1 closed, when the window reloads, then tab 1 stays closed and the other tabs come back.
- Given a saved tab list from 0.10.8, when the window loads, then tab 1 and the saved tabs are open.

## Rollout and rollback

Release as 0.11.0 (behavior change). Rollback: revert the commit; a `kernl.tabs.open` list left behind is ignored by the old code (it reads its own key), so downgrading only reopens tab 1.

## Parts

### Part 1: workspace records and equal tabs (host)

- [x] Workspace record; `tabsOf`, `addTab`, `shownTabOf`; every "no `tabOf`" check moved (list above). Done: unit tests and both suites pass with no behavior change yet (tab 1 still not closable).
- [x] Close any tab while two or more are open; context key; `/close` message. Done: suite checks for closing tab 1 and the last tab.
- [x] Save and restore with tab 1 closed; old shape read. Done: suite reload check; unit test for the old shape.

### Part 2: panel, docs, verification

- [x] × on every tab while two or more; numbering from the id; Delete and middle-click on any tab. Done: webview unit tests.
- [x] Guide (`panel.md` tabs bullet), changelog. Done: text matches behavior.
- [x] Real VS Code window: close tab 1, menu, new tab, reload. Done: screenshots and measurements.

## Standardized review

**Bottom line:** plan, approve with notes. It solves M's ask with M's chosen design, every "the first tab is the workspace" site found is listed with evidence, and the three notes below were folded into Design before presenting.

| Criterion | Verdict | Evidence |
| --- | --- | --- |
| Goal fidelity | pass | M's two answers (equal tabs; last can't close) are the goals; non-goals exclude closing workspaces |
| Current-system accuracy | pass | Each site cited with line numbers (controller, runtime, panel, tests) |
| Scope and cohesion | pass | Only tab and workspace plumbing; import/export excluded |
| Architecture and dependency direction | pass | Workspace-level truth moves to one owner (the record); tabs become uniform |
| Sequencing | pass | Part 1 first lands the record with no behavior change, then closing, then restore; Part 2 panel and docs |
| Completeness | pass after notes | Agent choice, `/close` availability contract, and the tab limit were missing; added |
| Failure and recovery | pass | Last tab can't close; restore never leaves a workspace empty; old saved shape read; rollback described |
| Verification | pass | Each task has a done condition; suite checks for close, menu, merge, discard, reload |
| Feasibility | pass | Ids unchanged, queue file names unchanged, so stored data stays valid |
| Decision readiness | pass | M decided both open choices |

Findings (all notes, folded in):
- **Note, completeness:** the agent a new tab uses after tab 1 closes was unstated; `setHarness` already saves the pick workspace-wide, so the record follows it.
- **Note, contract:** `commandAvailable` reads `view.tabOf` for `/close`; it needs the open-tab count, a change to that function's inputs.
- **Note, behavior:** at `kernl.tabs.max`, tab 1 becomes eligible for the automatic close; stated so it isn't a surprise.

## Changes made

- `src/controller.ts`: a `WorkspaceRecord` per folder and worktree (`spaces`) replaces `worktreeFolder`; `addTab(space, n)` makes every tab (tab 1 too); `tabsOf`, `shownTabOf`, `spaceIdOf`; `closeTab` refuses only a workspace's last tab; `newTab` adds before the idle tab gives way; `saveTabs`/`restoreTabs` keep every open tab under `kernl.tabs.open` (still reading and writing `kernl.tabs`); `postWorkspaces` shows a workspace's last shown tab when its tab 1 is closed; the menu, merge, discard, `newWorkspace`, `activeFolder`, the Conversations listing, the agent choice, and ⌘W's context key read the record.
- `src/workspaceRuntime.ts`, `src/ui/protocol.ts`: every tab has `tabOf` and `workspaceLabel`; tab 1's queue file keeps its name.
- `src/ui/panelCommands.ts`: `commandAvailable` takes the open-tab count; "The last tab can't be closed."
- `src/webview/tabs.ts`, `src/webview/main.ts`: × and Delete on any tab while two or more are open; numbering from the id; the footer chip names the workspace from the view.
- Tests: fixtures and first-tab assertions updated; new suite check (tab 1 closes, its conversation stays, the last tab stays, menu, new tab, reload); the worktree check now runs Merge and Discard with the worktree's tab 1 closed; the tab-limit check keeps both tabs busy.
- Deviations: the workspace menu shows a workspace's state across all its tabs (before: tab 1's only), and picking a workspace shows the tab shown last there (before: tab 1).
- Verified: tsc clean; unit 414/414; single-folder 101/101; multi-root 5/7 once and 7/7 on the following runs, with the same two checks failing on unchanged `main` (1 of 6 runs): a pre-existing race, not this change. Real window: upgrade from 0.10.8's saved tabs, close tab 1 with ×, last tab has no ×, reload keeps tab 1 closed, the chip says Main.

## Open questions

- None (M's two choices settle the design).
