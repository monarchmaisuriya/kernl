# Destructive actions in settings, menus next to their button, plain-language tool rows

- Date: 2026-10-19 05:00
- Status: done (M: "plan it and implement it"; mid-turn: "improve the tool calling descriptions like this, improve the UI/UX greatly")
- Repos: kernl
- Files:
  - New: `src/ui/panelPrompts.ts`, `src/webview/menu.ts`, `src/webview/toolRow.ts`
  - Changed: `package.json`, `src/controller.ts`, `src/ui/protocol.ts`, `src/ui/panel.ts`, `src/agent/session.ts`, `src/acp/acpRunner.ts`, `src/workspaceRuntime.ts`, `src/webview/main.ts`, `media/panel.css`, tests, `README.md`
- Subagents: none

## Context and problem

From M's screenshots (2026-10-19 21:30):

1. **Destructive actions sit next to everyday ones.** The title bar's "..." menu lists "Clear stored keys" and "Delete conversations and checkpoints" right beside "Choose agent". M wants them moved into settings.
2. **Menus open far from their button.** Every menu (agent, model, workspace, attach, history, and the setup flows) opens as VS Code's command-palette list at the top center of the window. M wants each to open next to the button that opened it, like Claude Code's attach list does.
3. **Tool rows show raw names.** Today a tool row reads "read_file" or "read", with the raw JSON underneath. M wants Claude Code's style: one plain line ("Reading src/server.ts") with a live status, the elapsed time, and a chevron to expand. Plus a broader UI/UX polish.

## What is true today

- **Every list choice goes through one call:** `Prompts.pick` (16 call sites: controller, provider manager, key commands, workspace commands) [verified: grep]. Its default implementation is `vscode.window.showQuickPick` [verified: `src/workspaces/commands.ts:16`].
- **Two menus already open next to their button:** the send and mode menus are in-panel popovers [verified: `src/webview/sendMenu.ts`, `src/webview/modeMenu.ts`].
- **Where the two destructive commands live:** they're in `view/title` groups `2_keys@1` and `2_keys@2` [verified: `package.json`]. Both are also palette commands. Delete already asks for confirmation; Clear keys doesn't [verified: `src/controller.ts:387`, `:728`].
- **How tool rows are built:** `<details class="tool">`, with an icon, the raw name, and a `<pre>` of the JSON arguments; the result is another `<pre>` [verified: `src/webview/main.ts:419-447`]. No status and no timing. Failures aren't marked.
  - CLI agents send a human title ("Read hello.txt").
  - YourStack's own agent sends the tool's name (`read_file`).
- **Failure is known at the source:** ACP marks a failed tool with `status: "failed"`, and LangChain's ToolMessage carries `status: "error"`. Neither reaches the panel today [verified: `acpRunner.ts` tool_call_update, `session.ts:118`].

## Goals

1. **Settings:**
   - Remove both items from the "..." menu.
   - Add them to kernl's settings page as action links (VS Code settings render `command:` links in `markdownDescription`) on the first kernl setting, under "Stored data".
   - Clear stored keys asks for confirmation first, as Delete already does.
2. **Menus next to their button:**
   - A host-side `PanelPrompts` shows every pick as an in-panel menu anchored to the control that started it: agent chip, model chip, workspace chip, attach button, jobs chip, a message's Restore button, or the panel's top right for title-bar and "..." commands.
   - It has a search box when the list is long, plus arrow keys, Enter, and Escape. A click outside cancels.
   - When the panel isn't visible (a command from the palette), it falls back to VS Code's list.
   - Text inputs (keys, names) and confirmations stay VS Code's own: those are input boxes, not option lists.
3. **Tool rows:**
   - One line per call: a status mark (pulsing while running, a check when done, a cross when failed), a plain-language description, a live elapsed time, and a chevron.
   - Expanding shows the arguments as readable `key: value` lines and the output in a scrollable block.
   - Descriptions cover YourStack's tools (files, search, commands, jobs, browser, todos, MCP `server.tool`), CLI agents' titles, and subagents.
   - Thought rows get the same compact style.
   - `toolResult` carries `failed` from the source.

Non-goals: moving input boxes into the panel; grouping several tool calls into one row.

## Options considered (menus)

| | A. Host routes `Prompts.pick` into an in-panel menu (recommended) | B. Rewrite each flow as panel-native UI | C. Keep VS Code's QuickPick |
| --- | --- | --- | --- |
| How | One `Prompts` implementation; every existing flow is unchanged | Each menu is rebuilt in the webview | No change |
| Fits our code | `Prompts` is already the seam (16 calls, scripted in tests) | Large rewrite, duplicated logic | — |
| When it fails | Panel hidden: falls back to QuickPick | Many places to break | M's complaint stays |
| Completeness | 9/10 | 7/10 | 2/10 |

RECOMMENDATION: A, because every list already passes through `Prompts.pick`, so one owner changes and every flow benefits.

## Design

- **Protocol:**
  - HostToPanel `menu {id, title, anchor, items: MenuItemView[], search}`, where `MenuItemView = {label, description?, detail?, icon?, checked?, separator?}` with codicon prefixes (`$(check)`, `$(add)`, ...) parsed into `checked` and `icon`.
  - HostToPanel `menuClosed {id}`, sent when the host abandons a menu.
  - PanelToHost `menuPick {id, index?}`; no index means cancelled.
  - `toolResult` gains `failed?`.
- **`PanelPrompts`:** `pick()` posts a menu when the panel is visible, else falls back. `anchor` is set by the controller for the flow it is handling (`withAnchor`). A new menu cancels an open one, and the panel going away cancels it too.
- **Panel `menu.ts`:**
  - One popover, positioned from the anchor's rectangle: above the control in the lower half of the panel, below it in the upper half, clamped to the panel's width.
  - Search filters by label, description, and detail.
- **Panel `toolRow.ts`:**
  - `describeTool(name, args)` turns a name into a plain sentence.
  - The row has a status mark, a timer (updated each second while any tool runs), and details.

## Acceptance criteria

- **"..." menu:** given the "..." menu, then it has no Clear or Delete. Given kernl's settings, then both links show; Clear asks first.
- **Anchored menus:** given the panel is shown, when the agent chip is clicked, then its menu opens next to the chip in the panel. Picking an item does what the QuickPick did. Escape or a click outside cancels.
- **Fallback:** given the panel is hidden, when Choose agent runs from the palette, then VS Code's list opens.
- **Tool rows:** given `read_file {file_path: "/src/a.ts"}`, then the row reads "Reading src/a.ts" with a running mark and timer. On its result it shows a check and the final time; on a failure, a cross.

## Parts

- [x] Settings: menu items out, links in, confirm Clear.
- [x] Anchored in-panel menus (host `PanelPrompts` + panel `menu.ts`).
- [x] Tool rows (`describeTool`, status, timer, details, `failed`).
- [x] Tests, README, package, reinstall (the check in M's window waits for M's reload).

## Standardized review

- **Findings, fixed in this file:**
  1. **Must-verify, fixed (failure):** a menu left open when the panel hides would block the flow forever. Hiding cancels it (resolves as cancelled).
  2. **Must-verify, fixed (current-system accuracy):** Clear keys had no confirmation; it now gets one, since its menu entry is gone.
  3. **Note:** input boxes stay VS Code's (key entry is secret and native). Stated as a non-goal.
- **Overall:** 0 blocking, 2 must-verify (fixed), 1 note.

## Changes made

- `package.json`: Clear stored keys and Delete conversations are out of the "..." menu; both are links on `kernl.provider`'s description. `src/controller.ts`: Clear asks first.
- `src/ui/panelPrompts.ts` (new): every pick opens in the panel at the controller's anchor (VS Code's list when the panel is hidden); one menu at a time; hiding the panel cancels. `src/ui/panel.ts`: `visible`, `onDidHide`. `src/controller.ts`: `anchored()` per control (agent, model, workspace, attach, jobs, restore:<message>); `menuPick`.
- `src/webview/menu.ts` (new): the popover, placed beside its control (above it in the lower half, below it in the upper half), with headings, checks, icons, details, a search box for long lists, arrow keys, Enter, Escape, and click-outside dismissal.
- `src/webview/toolRow.ts` (new): `describeTool` (plain sentences for every built-in, job, browser, MCP, CLI, and subagent tool), status mark, live timer, readable arguments, and scrollable output; thought rows are compact, one line each.
- `toolResult.failed` comes from LangChain's `status: "error"` and ACP's `failed`.
- Tests: `toolRow.test.ts`, `panelPrompts.test.ts`, panel tests for menus and tool rows, and a VS Code check that a real control's menu opens in the panel. The panel test harness now closes its windows (a running row's timer kept the test process alive).

## Re-test in M's window (after the reload, 21:49)

| Check | Result |
| --- | --- |
| Workspace chip menu opens in the panel right above the chip; Develop checked | Pass |
| Agent chip menu opens above the chip, with "kernl" and "Agents" groups, the check, and the setup note | Pass |
| Attach (+) menu opens above the button with icons; a click outside closes it | Pass |
| History (title bar) menu opens at the panel's top right, current conversation checked | Pass |
| Tool rows | Not shown live: the test run (OpenCode, the file attached) answered without calling a tool. Verified by panel tests and a browser preview of the real build |
| Settings links | Not clicked: opening Settings from the menu bar needs a higher access level than I have. Text checked in `package.json`; M to click once |
| **Found:** after Send, nothing showed for about 10 s while the restore point was taken | Fixed: the message and Working show at once, Restore is added when the snapshot is ready, and Stop during the snapshot ends the run before the agent starts (new panel test and VS Code check) |

## Open questions

None.
