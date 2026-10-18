# Why files can't be dragged into kernl's composer

- Date: 2026-10-19 10:00
- Status: presented
- Mode: find out
- Repos: kernl   Folders: `src/webview/`, `src/controller.ts`
- Question / problem: Why does dragging files or folders into the kernl composer do nothing, and what can a webview panel do about it?

## Research: why don't drops reach the composer, and what can a webview do?

- **Bottom line:** VS Code blocks drags into every webview, kernl's panel included, unless the user holds **Shift**. While a drag is in the window, VS Code turns off the panel's pointer events, so kernl never sees it. With Shift, the drag goes through. kernl also gives no hint about Shift, ignores drops from Finder (they carry no file path), and stays silent when a drop can't be used. Confidence: high (read in the installed VS Code 1.142.0 and in VS Code's source; not yet tried by hand).
- **Where we are:** feeds the drag-and-drop plan. About 30 minutes: the installed VS Code, one research agent, kernl's code.
- **Need from M:** accept; try a Shift-drag from the Explorer (see the plan).

### What I found: VS Code

- **A drag in the window blocks webviews unless Shift is held.** The webview's drag monitor listens for `dragstart`, `drag`, and `dragover` on the workbench window: without Shift it calls `windowDidDragStart()`, with Shift `windowDidDragEnd()` [verified: installed VS Code 1.142.0 `out/vs/workbench/workbench.desktop.main.js`, class `pue`; primary: `src/vs/workbench/contrib/webview/browser/webviewWindowDragMonitor.ts:17-57`].
- **Blocking means `pointer-events: none` on the webview's iframe** [verified: same file, `_startBlockingIframeDragEvents`; primary: `webviewElement.ts:587-597, 785-794`, citing Electron bug electron/electron#18226].
- **Webview views get the same monitor** (kernl's panel is one), plus a handler that sends drags over the view's frame to the view pane (for moving views) [verified: installed bundle, the webview view pane's `activate()`, `purpose: "webviewView"`; primary: `webviewViewPane.ts:204`].
- **Drags from Finder** are also handed back to the workbench on `dragenter` unless Shift is held [verified: installed `out/vs/workbench/contrib/webview/browser/pre/index.html:792-832`].
- **Shift was added in VS Code 1.91** (PR #209211, "Pressing Shift re-enables webview during Drag and Drop Events"); there's no setting and no user-facing hint [primary: github.com/microsoft/vscode/pull/209211, issue #182449].
- **What an Explorer drag carries:** `application/vnd.code.uri-list` (every item, folders included), `resourceurls` (files only), `codefiles` (paths), `text/uri-list` (first item only, a Chromium workaround) [primary: `src/vs/workbench/browser/dnd.ts:268-290, 400-410`].
- **A Finder drag carries `File` objects with no path** inside a webview (Electron 32 removed `File.path`; the replacement isn't available in webviews) [primary: electron breaking-changes, "Removed: File.path"; `src/vs/platform/dnd/browser/dnd.ts:575-581`].

### What I found: kernl

- The panel prevents default on `dragover` and reads `application/vnd.code.uri-list`, then `text/uri-list`, on `drop` [verified: `src/webview/main.ts:481-483`, `src/webview/attachments.ts:235-241`].
- With no URI it returns silently: a Finder drop (files, no URI) does nothing, with no message [verified: same lines].
- The host attaches only files inside the active workspace's folder; others get a warning [verified: `src/controller.ts:485-491`]. M's window has several folders, so a file from another folder is refused.
- The only test fakes a `drop` event; a real drag has never been tested [verified: `test/unit/webview.test.ts:380-386`].
- Nothing tells the user to hold Shift [verified: grep of `src/webview`, `docs/guides/panel.md`].

### What I found: other chat extensions

| Extension | Shift hint | Explorer drop | Finder drop |
| --- | --- | --- | --- |
| Claude Code (VS Code) | Docs: "hold Shift while dragging" [primary: code.claude.com/docs/en/vs-code] | Yes | Unknown |
| Cline | Placeholder: "hold shift to drag in files/images" [secondary: `ChatTextArea.tsx:1582`] | `resourceurls`, then `vnd.code.uri-list`; host makes paths relative | Images only (read as data); others refused with a message |
| Continue | Overlay "Hold ⇧ to drop image" [secondary: `DragOverlay.tsx:9-37`] | No | Images only |
| VS Code's built-in chat | Not needed (not a webview) | Yes | Yes (has the path) |

### What this means for our code

- `src/webview/main.ts`, `attachments.ts`: a Shift hint in the composer; a visible drop target while a Shift-drag is over the panel; read every Explorer type; Finder files by content; a message when a drop can't be used.
- `src/controller.ts`: say which folder a refused file belongs to.

### Confidence and gaps

| Claim | Tag | Source tier | What would raise confidence |
| --- | --- | --- | --- |
| Without Shift, nothing reaches the panel | verified (code) | installed VS Code + primary source | M tries a drag without Shift (expected: nothing) |
| With Shift, an Explorer drop reaches kernl's handler and attaches | unverified | — | M tries a Shift-drag from the Explorer today |
| Finder drops have no path | inferred | primary (Electron, VS Code) | Log `dataTransfer.types` on a Shift-drop from Finder |
| Chromium exposes `text/uri-list` for Finder drops into a webview | unverified | — | Same log |

### Sources

- VS Code (installed 1.142.0): `/Applications/Visual Studio Code.app/Contents/Resources/app/out/vs/workbench/workbench.desktop.main.js`, `out/vs/workbench/contrib/webview/browser/pre/index.html`
- VS Code source: https://github.com/microsoft/vscode (`webviewWindowDragMonitor.ts`, `webviewElement.ts`, `webviewViewPane.ts`, `pre/index.html`, `workbench/browser/dnd.ts`, `platform/dnd/browser/dnd.ts`, `chatDragAndDrop.ts`)
- VS Code PR #209211: https://github.com/microsoft/vscode/pull/209211; issue #182449: https://github.com/microsoft/vscode/issues/182449
- Electron breaking changes: https://github.com/electron/electron/blob/main/docs/breaking-changes.md
- Claude Code in VS Code: https://code.claude.com/docs/en/vs-code
- Cline: https://github.com/cline/cline (`webview-ui/src/components/chat/ChatTextArea.tsx`)
- Continue: https://github.com/continuedev/continue (`gui/src/components/mainInput/TipTapEditor/`)

## Standardized review

- **Bottom line:** usable. The blocking mechanism is read in the exact installed VS Code, and agrees with VS Code's source and three other extensions.
- **Criteria:** question fit pass; method pass (installed code first, then source, then other extensions); source quality pass; coverage pass; claim traceability pass; uncertainty pass (gaps table).
- **Findings:**
  1. **Must-verify:** whether a Shift-drag from the Explorer already works today (one try by M settles it).
  2. **Must-verify:** what a Finder drop carries in the panel (a logged drop settles it).
