# kernl in the title bar's chat button

- Date: 2026-10-19 11:50
- Status: presented
- Mode: explore options
- Repos: kernl   Folders: `package.json` (contributes), `src/extension.ts`, `src/controller.ts`
- Question / problem: M wants the title bar's chat button (Open Chat, Inline Chat, Quick Chat, New Chat, New Chat Editor, New Chat Window, Open in Agents, settings) to also offer kernl, with similar actions.

## Options: put kernl's actions one click away from the top of the window, using the surfaces VS Code opens to extensions

- **Bottom line:** recommend B. VS Code doesn't let an extension add to that button's menu, the Command Center, or the title bar (verified in the installed 1.142.0). The nearest surfaces open to extensions are:
  - the **editor title toolbar**: the row just under the title bar, with the run and split buttons;
  - the **status bar**;
  - **shortcuts**;
  - a **`@kernl` participant** in VS Code's own chat, the chat that button opens.

  B uses the first three for a kernl menu with the same actions, plus `@kernl` so the button's chat can hand work to kernl.
- **Where we are:** framing done; VS Code 1.142.0's menu registry and the stable API typings read; next is the plan.
- **Need from M:** pick an option (and the two decisions in the plan).

### The problem, framed

- **What:** a kernl entry next to, or inside, the title bar's chat button, offering actions like that button's.
- **Why:** reach kernl from the top of the window as fast as VS Code's own chat.
- **Who:** M, working in an editor with the kernl panel docked on the right.
- **When:** all the time, as with Open Chat.
- **Where:** the title bar's chat button (`ChatTitleBarMenu`) and its row.
- **Which:** VS Code's extension menus, the status bar, keybindings, and the chat participant API.
- **How much:** small for the menus, medium for `@kernl`.

### What must be true

| Constraint | Kind | Status |
| --- | --- | --- |
| Only stable API (kernl ships as a VSIX; proposed API needs a VS Code flag per user) | hard | verified: proposed menus are marked `proposed:` in VS Code's registry |
| The chat button's menu is `ChatTitleBarMenu`, filled by VS Code itself | fact | verified: `ChatTitleBarMenu` holds "New Chat" etc. in `workbench.desktop.main.js` |
| `ChatTitleBarMenu`, `CommandCenter`, `TitleBar`, `TitleBarAdjacentCenter` aren't in the extension menu list | fact | verified: 0 matches for `key:"…",id:O.<menu>` for each in 1.142.0 |
| `editor/title` is open to extensions, with submenus | fact | verified: `key:"editor/title",id:O.EditorTitle` in the registry; submenus are a stable contribution |
| Status bar items and chat participants are stable API | fact | verified: `createStatusBarItem` and `chat.createChatParticipant` in `@types/vscode` 1.140 |
| The chat-session menus (New Chat types, Agents window) need proposed API `chatSessionsProvider` | fact | verified: `chat/newSession`, `chatSessions/*` are `proposed:"chatSessionsProvider"` |

### The button's actions, and kernl's equivalents

| Chat button | kernl equivalent | Exists today |
| --- | --- | --- |
| Open Chat | Open kernl (focus the panel) | yes (view) |
| Open Inline Chat | Ask kernl about the selection (adds the file or selection to the composer and focuses it) | partly (`kernl.attachToChat`, Explorer only) |
| Open Quick Chat | Ask kernl… (a one-line box that sends to the shown workspace) | no |
| New Chat | New chat | yes (`kernl.newChat`) |
| New Chat Editor / Window | (none: the panel is a view) | no; out of scope |
| Open in Agents | New workspace (git worktree) | yes (`kernl.newWorkspace`) |
| Configure / Manage settings | Settings, Connections, Agent logins, Choose agent | yes |

### Options

| | A: status bar only | B: editor title button, status bar, shortcuts, and `@kernl` (recommended) | C: proposed API (chat sessions) |
| --- | --- | --- | --- |
| How it works | A "kernl" status bar item opens a menu with the actions above | A kernl button in the editor title toolbar (a submenu with the actions); the same menu from a status bar item that also shows connection trouble; shortcuts for Open kernl and Ask kernl; `@kernl` in VS Code's chat sends the request to kernl's panel | Register kernl as a chat session type so it appears in the button's New Chat and Agents menus |
| Near the button | no (bottom bar) | yes (the row under it) | inside it |
| Ships in a VSIX | yes | yes | no: every user must start VS Code with `--enable-proposed-api` |
| Cost | small | small to medium | large, and breaks when the proposal changes |
| Completeness | 5/10 | 8/10 | 9/10 if it were shippable |

### Recommendation

RECOMMENDATION: B because it puts the same actions one click from the top of the window with stable API only, and `@kernl` is the one stable way to reach kernl from the chat the button opens.

### Sources

- VS Code 1.142.0 `out/vs/workbench/workbench.desktop.main.js`: the extension menu registry (`key:…,id:O.…,proposed:…`) and `MenuId.ChatTitleBarMenu`
- `@types/vscode` 1.140.0: `window.createStatusBarItem`, `chat.createChatParticipant`
- https://code.visualstudio.com/api/references/contribution-points#contributes.menus (editor/title, submenus)
- https://code.visualstudio.com/api/extension-guides/chat (chat participants)

## Standardized review

- **Bottom line:** usable for the decision; no blocking findings.
- **Criteria:**
  - **Question fit:** pass.
  - **Method:** pass. The menu registry was read directly from the installed VS Code.
  - **Sources:** pass. Primary throughout.
  - **Coverage:** pass. The impossible option (C) is shown with the reason.
  - **Traceability:** pass.
  - **Uncertainty:** pass.
  - **Recommendation proportionality:** pass.
- **Findings:**
  1. **must-verify:** whether the proposed shortcuts are free in VS Code's defaults. Defaults are stored as key codes, so a text search can't settle it; check in Keyboard Shortcuts during the build.
  2. **note:** `@kernl` only works where VS Code's chat is available (Copilot Chat enabled). Without it, the other surfaces still work.
