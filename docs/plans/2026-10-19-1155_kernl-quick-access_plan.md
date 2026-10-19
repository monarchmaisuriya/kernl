# Replace VS Code's chat button with kernl's

- Date: 2026-10-19 11:55
- Status: done (2026-10-19; not committed)
- Repos: kernl   Folders: `src/`, `media/`, `test/`, `docs/`
- Files:
  - **Change:** `package.json` (commands, submenu, editor/title, keybindings, chatParticipants), `src/extension.ts`, `src/controller.ts`, `docs/guides/panel.md`, `CHANGELOG.md`
  - **New:** `src/quickAccess.ts`, `src/chatParticipant.ts`, `media/mark-light.png`, unit and VS Code tests
- Research: [2026-10-19-1150_kernl-in-the-title-bar_research.md](../research/2026-10-19-1150_kernl-in-the-title-bar_research.md)
- Subagents: none

## Context and problem

The chat button in the Command Center opens a menu: Open Chat, Inline Chat, Quick Chat, New Chat, Open in Agents, and settings. M wants an option that replaces it with a kernl button offering similar actions.

- **Hiding VS Code's button is possible.** It's VS Code's "agents control" in the Command Center, shown unless `chat.agentsControl.enabled` is `"hidden"` (values `hidden`, `badge`, `compact`; default `compact`; marked experimental) [verified: VS Code 1.142.0 `appendMenuItem(O.CommandCenter,{submenu:O.AgentsTitleBarControlMenu,…,when:…notEquals("config.chat.agentsControl.enabled","hidden")…})` and the setting's schema].
- **Putting kernl's button in that same spot isn't.** The Command Center and title bar menus aren't open to extensions [verified: research]. So kernl's button goes in the nearest surfaces VS Code does open: the editor title toolbar directly below, and the status bar.

## Goals / Non-goals

**Goals**
- **The replace option:** `kernl.replaceChatButton` (off by default). Turning it on hides VS Code's chat button (sets `chat.agentsControl.enabled` to `"hidden"` in your user settings, remembering what it was). Turning it off puts back exactly what was there.
- A kernl button in the editor title toolbar (the row under the title bar) opening a menu with kernl's version of the chat button's actions.
- The same menu from a "kernl" status bar item, which also warns when a connection needs you.
- Shortcuts: Open kernl, and Ask kernl….
- `@kernl` in VS Code's own chat (the chat the title bar button opens), which sends the request to kernl's panel.

**Non-goals**
- kernl's button in the Command Center itself (not possible for extensions).
- Hiding VS Code's chat button when the Command Center is turned off. VS Code then shows a different chat button, which only its "hide AI features" switch removes, and that turns off all of VS Code's AI. kernl won't do that.
- Proposed API (chat sessions in the button's New Chat and Agents menus).
- kernl in an editor tab or its own window (New Chat Editor / Window).

## What is true today

- kernl opens from its activity bar view; the view's title has New chat, New workspace, and Conversations [verified: `package.json` `menus.view/title`].
- There are no shortcuts, no status bar item, no editor title button, and no chat participant [verified: `package.json` has no `keybindings` or `chatParticipants`; no `createStatusBarItem` in `src/`].
- "Add to kernl chat" exists for Explorer items only [verified: `menus.explorer/context`].
- Connection status is in the monitor [verified: `src/connections/monitor.ts`].

## Options considered

From the research: A (status bar only, 5/10), B (editor title button, status bar, shortcuts, `@kernl`, 8/10), C (proposed chat-session API, not shippable).

RECOMMENDATION: B because it's the nearest stable reach to the button, and `@kernl` is the only stable way in from the button's chat.

## Decision

Option B.

## Design

### The replace option (`src/quickAccess.ts`)

- **`kernl.replaceChatButton` turned on:**
  - kernl saves the current user value of `chat.agentsControl.enabled` (possibly unset) in its global state, sets it to `"hidden"` in user settings, and shows its own button;
  - a notice says what changed and that turning the option off restores it.
- **Turned off:** kernl restores the saved value (or removes the setting if it was unset), only if it's still `"hidden"`. If you've since changed it yourself, kernl leaves your choice.
- **Restricted Mode:** `kernl.replaceChatButton` is a user-only setting, so a repository can't turn it on.
- **Where kernl's button goes:** the editor title toolbar is always shown (Part 1); the option also makes sure the status bar item is on.

### The kernl menu (`src/quickAccess.ts`)

One list, shown as an editor title submenu and as a quick pick from the status bar:

| Item | Like the chat button's | Does |
| --- | --- | --- |
| Open kernl | Open Chat | Focuses the kernl panel (`kernl.open`) |
| Ask kernl… | Open Quick Chat | A one-line box; Enter sends it to the shown workspace and opens the panel (`kernl.ask`) |
| Ask kernl about this file / selection | Open Inline Chat | Adds the active file, or the selected lines as an attachment, to the composer and focuses it (`kernl.askAboutSelection`) |
| New chat | New Chat | `kernl.newChat` |
| New workspace (git worktree) | Open in Agents | `kernl.newWorkspace` |
| Conversations | (history) | `kernl.sessions` |
| Choose agent, Agent logins | | existing |
| Show connections (with "2 need you" when any do) | | `kernl.showConnections` |
| kernl settings | Manage Settings | `kernl.openSettings` |

- **Editor title:** a kernl icon (the logo's mark: `media/mark.png` on dark themes, a new dark `media/mark-light.png` on light) that opens the submenu, in the `navigation` group so it sits with the run and split buttons.
- **Status bar:** the item reads `kernl` and opens the menu. When a connection needs you it shows a warning and "kernl: 1 needs you", from the monitor's statuses.
- **Shortcuts:** Open kernl: Ctrl+Alt+K (Ctrl+Option+K on Mac). Ask kernl…: Ctrl+Alt+Shift+K. Decision D2; checked free during the build.

### `@kernl` in VS Code's chat (`src/chatParticipant.ts`)

- A chat participant `kernl.kernl`, named `kernl`.
- `@kernl <request>` sends the request (and the chat's file references, as attachments) to the shown kernl workspace, the same as Send in the panel. It opens the panel, and answers in VS Code's chat: "Sent to kernl (Claude Code, Develop)", with an "Open kernl" button.
- The work, approvals, and reply happen in kernl's panel, where the approvals and checkpoints already are (decision D1).

### Contracts touched

- **New commands:** `kernl.open`, `kernl.ask`, `kernl.askAboutSelection`, `kernl.quickMenu`.
- **New contributions:** one submenu (`kernl.menu`), `editor/title` entries, `keybindings`, and `chatParticipants`.
- **New settings:** `kernl.replaceChatButton` (default false, user only), `kernl.statusBar.show` (default true).
- **Writes one VS Code user setting** (`chat.agentsControl.enabled`), only while the option is on; restores it when turned off.
- **Controller:** `sendFromOutside(text, attachments)`: the same path as the panel's Send, including the send guard and the queue.

## Risks and mitigations

| Risk | Likelihood | Impact | Mitigation | How we'd notice |
| --- | --- | --- | --- | --- |
| Shortcuts collide with VS Code or another extension | medium | the shortcut does something else | check in Keyboard Shortcuts during the build; they're rebindable | Keyboard Shortcuts shows a conflict |
| VS Code's chat isn't enabled (no Copilot) | medium | `@kernl` isn't available | the other surfaces don't depend on it | `@kernl` missing in chat |
| The editor title toolbar is crowded | low | the button hides under `...` | one button with a submenu, not many | screenshot |
| A message sent from outside while the agent runs | medium | lost or interrupting | goes through the panel's send path: queued while running | VS Code check |
| VS Code renames or removes the experimental `chat.agentsControl.enabled` | medium | the option stops hiding the button | kernl checks the setting exists before writing and says so if it doesn't | notice when turning the option on |
| The user changed the setting while the option was on | low | restoring would undo their choice | restore only if the value is still `"hidden"` | unit test |

## Acceptance criteria

- Given `kernl.replaceChatButton` turned on, then VS Code's chat button disappears from the Command Center, kernl's button is in the editor title toolbar and status bar, and `chat.agentsControl.enabled` is `"hidden"`. Turned off, then the setting is back to what it was (or unset) and VS Code's button returns.

- Given an editor is open, when M clicks the kernl button in the editor title toolbar, then a menu shows the actions above, and each one does what the table says.
- Given the status bar, then "kernl" is there; when a connection needs M it shows a warning and the count, and clicking opens the same menu.
- Given Ask kernl…, when M types a request and presses Enter, then it appears in the shown workspace's panel as sent (or queued if the agent is running), and the panel opens.
- Given selected lines, when M picks Ask kernl about this selection, then the composer has them attached and has focus.
- Given VS Code's chat, when M types `@kernl fix the failing test`, then kernl's panel receives "fix the failing test" and the chat says where it went, with Open kernl.

## Rollout and rollback

- Ships in the next minor release with a changelog entry.
- Each surface can be removed on its own: the editor title entry and the status bar via settings (`kernl.statusBar.show`), shortcuts via Keyboard Shortcuts.
- **Rollback:** revert the change; nothing is stored.

## Parts

### Part 1: replace option, kernl menu, editor title button, status bar, shortcuts
- [x] `kernl.replaceChatButton`: save, hide, restore `chat.agentsControl.enabled`. Done: unit tests (saved value restored; unset stays unset; a value the user changed meanwhile is left alone); live check that VS Code's button disappears and returns.
- [x] `quickAccess.ts`, the commands, the submenu with icons, `editor/title`, the status bar item with connection warnings, and keybindings. Done: unit test of the menu's items; VS Code check that every command runs; status bar reflects a "needs you" status.

### Part 2: Ask kernl and Ask about selection
- [x] `kernl.ask` input, `kernl.askAboutSelection` (a file, or selected lines as an attachment), and the controller's `sendFromOutside` through the panel's send path. Done: VS Code checks: an asked message reaches the shown workspace (queued while running); a selection lands as an attachment.

### Part 3: `@kernl` chat participant
- [x] Participant, forwarding the request and its file references, with a reply and Open kernl. Done: unit test of the handler with a fake request and stream; live check in M's window if VS Code's chat is enabled.

### Finish
- [x] Docs (panel guide), changelog; suites, package, install, check in M's window. Done: unit 315/315; multi-root suite 6/6; single-folder suite 61/62 (the one failure is the Codex flake under What is left); installed copy matches the build; in M's window the status bar shows "kernl: 1 needs you" and opens the kernl menu.

## Standardized review

- **Bottom line:** executable after two decisions. No blocking findings.
- **Criteria:**
  - **Goal fidelity:** pass. The literal ask is impossible (verified), and the plan gives the nearest equivalent and says so.
  - **Current-system accuracy:** pass.
  - **Scope:** pass. Editor-tab and window chat are excluded.
  - **Architecture:** pass. One menu definition feeds every surface; outside messages go through the panel's existing send path, not a second one.
  - **Sequencing:** pass.
  - **Completeness:** pass.
  - **Failure handling:** pass.
  - **Verification:** pass.
  - **Feasibility:** pass. All APIs are stable.
  - **Decision readiness:** two decisions below.
- **Findings:**
  1. **must-verify:** shortcut conflicts can only be checked in VS Code (Part 1).
  2. **note:** `@kernl` depends on VS Code's chat being enabled on the machine.
  3. **must-verify:** `chat.agentsControl.enabled` is marked experimental in VS Code 1.142.0. The option checks it exists before writing; a live check confirms the button hides and returns.
  4. **note:** the option writes one VS Code user setting. That's the only way to hide the button; it's reversible and only happens when you turn the option on.

## Changes made

- Decisions (M, 2026-10-19): the replace option as planned; A for D1 (forward to the panel) and D2 (Ctrl+Alt+K, Ctrl+Alt+Shift+K).
- `src/quickAccess.ts` (menu actions, status bar text, save/hide/restore of `chat.agentsControl.enabled`), `src/chatRequest.ts` and `src/chatParticipant.ts` (@kernl), controller: status bar item, `kernl.open`, `kernl.ask`, `kernl.askAboutSelection`, `kernl.quickMenu`, `sendFromOutside` through the panel's Send; `media/mark-light.png` from `scripts/logo-mark.swift … dark`; package.json contributions; docs and changelog.
- The status bar counts only what the agents in use need (their login and key), so an unused agent or an OAuth MCP server kernl can't sign in to doesn't keep it yellow.
- At startup the replace option is applied only when the saved state disagrees with the option; a button shown again by hand isn't hidden again behind the user's back.
- `sendFromOutside` hands the message to the panel's Send without waiting for the run, like the panel's own Send. Awaiting it held Ask kernl's box and an `@kernl` reply open until the run ended (forever behind an approval card), and deadlocked the Ask check in the VS Code suite.
- The Ask check ends with New chat, so later checks that read the conversation history see the same history as before it was added.

## What is left

- **Not checked in M's window:** the editor toolbar button (M's `workbench.editor.editorActionsLocation` is `"hidden"`, so VS Code shows no editor toolbar there); the replace option (it writes M's user settings; checked only in the test VS Code); `@kernl` in VS Code's chat; the two shortcuts.
- **Fixed after this plan: the flaky check "a CLI agent that definitely can't start stops the message with the fix".** Cause, confirmed by reproduction: after a login, key, or setting change, kernl rechecks every agent and marks it "unknown, checking" until the check answers; a send in that window passed the pre-check and Codex failed by itself. With Codex's check slowed to 2 s, the check failed every run; with the fix, it passes and a send mid-check gets kernl's own "Codex isn't logged in". Fix: the connection monitor records which agents have no answer that holds (never checked, or checking again after a change), and `whenAnswered` (`src/connections/monitor.ts`) waits only for those; the `send` case in `src/controller.ts` waits on it for CLI agents (at most 10 s, `STATUS_TIMEOUT_MS`). A routine recheck keeps the last answer, even "unknown", and isn't waited for. The VS Code check "a message sent while the agent's login is checked again after a change…" holds Codex's check open to prove it.

## Open questions

None. Answered by M on 2026-10-19 (see Changes made). The original questions follow for the record.

0. **Intent.** You asked for an option to replace VS Code's chat button with kernl's. kernl can hide VS Code's button, but not stand in that exact spot, so kernl's button goes in the editor toolbar directly below it (and the status bar). Is that what you want?

1. **D1: what `@kernl` in VS Code's chat does.** A (recommended): sends the request to kernl's panel and says so, with Open kernl; the work and approvals stay in the panel. B: kernl's reply also streams back into VS Code's chat (approvals still in the panel). RECOMMENDATION: A because approvals, diffs, and checkpoints live in the panel, and B splits one conversation across two places. Completeness: A 8/10, B 9/10.
2. **D2: shortcuts.** A (recommended): Ctrl+Alt+K opens kernl; Ctrl+Alt+Shift+K opens Ask kernl…. B: no shortcuts (assign your own in Keyboard Shortcuts). RECOMMENDATION: A because the chat button's actions all have shortcuts. Completeness: A 8/10, B 6/10.
