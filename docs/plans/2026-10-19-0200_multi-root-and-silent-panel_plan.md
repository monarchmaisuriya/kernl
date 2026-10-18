# Make YourStack work in multi-root windows, and never fail silently

- Date: 2026-10-19 02:00
- Status: done (M: "FIX THIS, PLAN IT AND REVIEW IT AND IMPLEMENT IT. FINISH IT ALL")
- Repos: yourstack
- Files:
  - Changed: `src/workspaceScope.ts`, `src/controller.ts`, `src/workspaceRuntime.ts`, `src/providerManager.ts`, `src/ui/protocol.ts`, `src/webview/main.ts`, `media/panel.css`, `test/runVscode.ts`, `package.json`, `README.md`, tests
  - New: `test/vscode/multiRootSuite.ts`
- Subagents: none

## Context and problem

M installed the extension in their everyday VS Code window and reports that nothing works:

- Entering a DeepSeek key and pressing Enter does nothing.
- Picking an agent does nothing.
- Claude Code shows "ready"; clicking it offers API key, terminal login, or DeepSeek; terminal login does nothing visible.

## What is true today

- **M's window has three folders.** It is the multi-root workspace `~/Documents/Work.code-workspace`, with folders `../Develop`, `../Debug`, `../Experiment`. [verified: parsed the file; the window title is "Work (Workspace)"]
- **One folder is required.** `currentWorkspaceScope()` refuses any window that doesn't have exactly one folder, with "YourStack supports a single-folder workspace in this version". [verified: `src/workspaceScope.ts:11`]
- **No workspace means silent no-ops.** On that refusal, `loadWorkspaces()` creates no workspace and returns. [verified: `src/controller.ts:171`] From then on every panel action starts with `this.workspace(this.active)`, finds nothing, and returns. [verified: `pickHarness`, the `send` case, `searchFiles`]
- **The reason is never shown.** It only reaches the panel as `status.problem`. The banner is drawn only when a workspace exists and runs YourStack, and the empty state is hidden when there is no workspace (`empty.hidden = !p`). [verified: `src/webview/main.ts:131`, `:157`] M's screenshot shows exactly this: an empty panel, the agent chip reading "Agent", and no workspace or model chip. [verified: screenshot of M's window]
- **Nothing was logged.** M's YourStack output log for this session is empty. A stored key or an agent change always logs "inputs changed". [verified: `output_logging_20261018T195728/1-YourStack.log` is empty]
- **Agent logins can't switch agents.** It manages credentials only: for a ready Claude Code it still offers "Log in in a terminal", which just opens a terminal running `claude`, and nothing switches the agent. [verified: `src/providerManager.ts` `agentLogins`]
- **Our tests never cover this.** Every test opens a single-folder workspace. [verified: `test/runVscode.ts` opens one folder]

```
window with 3 folders -> currentWorkspaceScope(): not ok  <-- fails here
  -> loadWorkspaces() returns, no workspaces
  -> panel: no pane -> empty state hidden, banner hidden   <-- reason never shown
  -> every click: workspace(active) undefined -> return     <-- "nothing happens"
```

## Goals / Non-goals

Goals:

1. **Multi-root works:**
   - Each local folder in the window is a top-level workspace in the footer's workspace chip, labeled with the folder name.
   - The panel opens on the folder of the file being edited (else the first folder).
   - Worktree workspaces belong to their folder's repository.
   - Adding or removing a folder updates the list.
   - A single-folder window is unchanged ("Main").
2. **Never silent:**
   - With no usable folder, the panel shows why, plus an "Open Folder" button.
   - Agent and model actions with no workspace show the same reason instead of returning silently.
3. **Agent logins can switch:**
   - A ready agent's first action is "Use <agent> in this workspace".
   - Its login action says it is already logged in.
   - Storing a key confirms it with a message.
4. **Tests cover a multi-root window:** a second VS Code suite runs on a two-folder `.code-workspace`.

Non-goals:

- One agent working across several folders at once (each folder has its own agent, as worktrees do).
- Remote (non-`file:`) folders: skipped, with a note.

## Options considered

| | A. One workspace per folder (recommended) | B. Ask which folder to use, one at a time | C. Use the first folder only |
| --- | --- | --- | --- |
| How it works | Each folder is a top-level workspace, like worktrees already are | A picker chooses the single active folder | folders[0] becomes Main |
| Fits our code | Reuses runtimes, panes, and the workspace chip | New "current folder" state; switching resets the agent | Trivial |
| When it fails | Many folders make a long chip menu | Two folders can't run at once | Wrong folder for files in Debug or Experiment; surprising |
| Completeness | 9/10 | 7/10 | 4/10 |

RECOMMENDATION: A, because the panel already handles several workspaces with their own agents, and a folder is just another one.

## Design

- **`workspaceScope.ts`:** returns `{ ok, folders: {root, name}[], trusted }` for one or more local folders. With none, or only remote ones, it returns the reason.
- **Controller:**
  - **Ids:** a single folder keeps id `main` and label "Main". In multi-root, each folder is `folder:<name>`, labeled with the folder name (de-duplicated with `#2` if needed).
  - **Folder of a workspace:** `folderOf(id)` gives a worktree's parent folder.
  - **Folder-scoped things follow the active workspace's folder:** `mainRoot()` (the repo for create, merge, and discard), skills, and named agents.
  - **Startup focus:** the folder holding the active editor.
  - **Folder changes:** `onDidChangeWorkspaceFolders` syncs the list.
  - **Empty list:** `postWorkspaces` also sends `problem` when there are no workspaces.
- **Agent choice:**
  - A single folder still saves it in the `yourstack.harness` setting.
  - In multi-root, each folder remembers its own choice in VS Code workspace state, keyed by folder path. `yourstack.harness` is the default.
  - Runtimes in multi-root don't follow later changes to that setting (`followsHarnessSetting = false`).
- **Worktrees:** ids are `wt:<name>` for a single folder and `wt:<folder>/<name>` in multi-root. Each folder's worktrees are listed from that folder's repo.
- **Panel:**
  - The `workspaces` message gains `problem?`.
  - With no workspaces, the empty state shows the problem and an Open Folder button (PanelToHost `openFolder`, which runs `vscode.openFolder`).
- **Agent logins:**
  - Takes a `use(id)` callback; for a ready agent the first action is "Use <agent> in this workspace".
  - "Log in in a terminal" says "already logged in" when ready.
  - Key-storing actions show "Key stored for ...".
- **Tests:**
  - `runVscode.ts` builds a two-folder `.code-workspace` (two git repos) when `YOURSTACK_WORKSPACE=multi`.
  - `multiRootSuite.ts` checks: both folders appear; Send works in the second folder through the fake agent; each folder keeps its agent choice; a worktree's id and repo belong to its folder.
  - `npm run test:vscode` runs both suites.
  - New panel tests cover the empty state with a problem, and agent logins.

## Risks and mitigations

| Risk | Likelihood | Impact | Mitigation | How we'd notice |
| --- | --- | --- | --- | --- |
| Something still assumes `main` exists | Medium | High | Every `MAIN` use is listed in the review and replaced with "the active folder" | The multi-root suite fails |
| Two folders with the same name | Low | Low | De-duplicate ids with `#2` | Unit check of the id helper |
| Per-folder agent choice surprises single-folder users | Low | Low | Single-folder behavior is unchanged | The existing suite passes |

## Acceptance criteria

- **Multi-root opens:** given a window with two folders, when the panel opens, then the workspace chip lists both, and the panel shows the folder of the active file.
- **Send works per folder:** given that, when a message is sent in the second folder, then the agent runs with that folder as its working directory.
- **Agent per folder:** given an agent picked in folder 1, then folder 2 keeps its own, and a reload keeps both.
- **Never silent:** given a window with no folder, then the panel shows "Open a folder to use YourStack." with an Open Folder button.
- **Logins can switch:** given a ready Claude Code in Agent logins, when "Use Claude Code in this workspace" is chosen, then the workspace's agent is Claude Code.

## Rollout and rollback

Local VSIX, version unchanged. Rollback: reinstall the previous VSIX from git history.

## Parts

- [x] Scope and controller: folders as workspaces, folder-aware worktrees, skills, and agents; folder sync.
- [x] Panel: problem state with Open Folder; agent logins with Use; key confirmations.
- [x] Tests: multi-root suite, panel tests; README; package; check in M's real window.

## Standardized review

Reviewed with the plan rubric against `src/workspaceScope.ts`, `src/controller.ts` (every use of `MAIN` and `currentWorkspaceScope`), `src/workspaceRuntime.ts` (`isMain`, rebuild policy), `src/workspaces/commands.ts` (`mainRoot`), `src/providerManager.ts`, `src/webview/main.ts`, and `test/runVscode.ts`.

- **Findings, fixed in this file:**
  1. **Blocking, fixed (current-system accuracy):** the plan first assumed `pickHarness` showed its menu in M's window. It returns before the menu when there is no workspace. M's agent-menu report comes from Agent logins, so Agent logins gets the "Use" action (goal 3).
  2. **Must-verify, fixed (failure):** in multi-root, a change to `yourstack.harness` would have reset every folder's own choice through the rebuild policy (`isMain`). Fixed by `followsHarnessSetting = false` for multi-root folders.
  3. **Must-verify, fixed (completeness):** every `MAIN` use is now listed: `mainRoot`, `postSkills`, `refreshNamedAgents`, discard's focus, and the initial `active`.
  4. **Note:** worktree ids gain the folder name only in multi-root, so single-folder worktrees keep their ids and stored harness.
- **Criteria:** all pass after fixes.
- **Overall:** 1 blocking (fixed), 2 must-verify (fixed), 1 note.

## Changes made

- `src/workspaceScope.ts`: returns every local folder; refuses only a window with no folder, or only remote ones.
- `src/controller.ts`:
  - one top-level workspace per folder (`folder:<name>` in multi-root, `main` for a single folder);
  - the folder holding the active editor is shown first;
  - per-folder agent choice in workspace state;
  - worktrees belong to their folder (`wt:<folder>/<name>`);
  - `mainRoot`, skills, and named agents follow the shown folder;
  - the panel gets a `problem` when there is no workspace;
  - the agent picker and agent changes warn instead of returning silently.
- `src/workspaceRuntime.ts`: `followsHarnessSetting`, so multi-root folders and worktrees keep their own agent.
- `src/keyCommands.ts`, `src/providerManager.ts`:
  - stored keys are confirmed ("Key stored for ...");
  - a provider key YourStack doesn't use yet offers "Use <provider> for YourStack";
  - Agent logins offers "Use <agent> in this workspace" for a ready agent, and its login action says when the agent is already logged in.
- `src/ui/protocol.ts`, `src/webview/main.ts`, `media/panel.css`: the `workspaces.problem` message, the `openFolder` action, and an empty state with the reason and an Open Folder button.
- Tests:
  - `test/vscode/multiRootSuite.ts`, 5 checks on a real two-repo `.code-workspace`;
  - a panel test for the empty state;
  - `npm run test:vscode` runs both suites.

## Open questions

None.
