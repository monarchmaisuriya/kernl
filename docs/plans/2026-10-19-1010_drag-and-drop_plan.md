# Drag and drop into the composer

- Date: 2026-10-19 10:10
- Status: done (Explorer drags blocked upstream in VS Code 1.140+; workaround A shipped)
- Repos: kernl   Folders: `src/webview/`, `src/`, `media/`, `test/`
- Files: `src/webview/main.ts`, `src/webview/attachments.ts`, new `src/webview/dropData.ts`, `src/controller.ts`, `src/attachmentSearch.ts`, `src/ui/protocol.ts`, `media/panel.css`, `test/unit/webview.test.ts`, new `test/unit/dropData.test.ts`, `test/unit/webviewSafety.test.ts`, `docs/guides/panel.md`, `docs/known-issues/README.md`
- Research: `docs/research/2026-10-19-1000_drag-and-drop_research.md`
- Subagents: none

## Context and problem

M drags files or folders into the composer and nothing happens: no chip, no message.

## Diagnosis

```
drag starts in the Explorer
   │
   ▼
VS Code's drag monitor (window dragstart / drag / dragover)
   ├─ Shift not held ──► panel iframe: pointer-events none ──► kernl sees nothing   <-- M's case
   └─ Shift held ──────► panel gets dragenter / dragover / drop
                              │
                              ▼
                kernl onDrop: vnd.code.uri-list, then text/uri-list
                   ├─ URIs ──► host: inside the shown folder? attach : warning
                   └─ none (Finder: files, no path) ──► returns silently            <-- second gap
```

- **Root cause (by design in VS Code):** without Shift, VS Code blocks every drag into a webview, kernl's panel included [verified: installed VS Code 1.142.0 `workbench.desktop.main.js` (window drag monitor, `pointer-events: none`) and `pre/index.html:792-832`; primary: `webviewWindowDragMonitor.ts:17-57`, PR #209211].
- **kernl's gaps on top:**
  - nothing tells you to hold Shift;
  - a Finder drop has no path and is silently ignored;
  - a drop with nothing usable says nothing;
  - a file from another folder of a multi-folder window is refused with a generic warning [verified: `src/webview/attachments.ts:235-241`, `src/controller.ts:485-491`].
- **Owning layer:** the block belongs to VS Code (no setting, no API to lift it [primary: research F16]). kernl owns discoverability, what it reads from a drop, and the feedback.

## Goals / Non-goals

**Goals**

- You can see how to drop: the composer says to hold Shift, and the panel shows a drop target while a Shift-drag is over it.
- A Shift-drop from the Explorer attaches every dropped file and folder.
- A Shift-drop from Finder attaches text files by their content.
- A drop that can't be used says why.

**Non-goals**

- Dropping without Shift: VS Code blocks it; no workaround exists for a webview.
- Images or binary files from Finder (kernl has no image attachments yet).
- Attaching files from another folder of the window (the agent works in one folder); the message says which folder they're in.

## What is true today

- The panel prevents default on `dragover` and reads `application/vnd.code.uri-list`, then `text/uri-list`, on `drop` [verified: `src/webview/main.ts:481-483`, `src/webview/attachments.ts:235-241`].
- The host resolves `file:` URIs inside the active workspace's folder; others get "Only files in this workspace can be attached" [verified: `src/attachmentSearch.ts:24-40`, `src/controller.ts:485-491`].
- Text attachments exist (`{ kind: "text", path: <label>, text }`), up to 20,000 characters [verified: `src/ui/protocol.ts:53-60`].
- The Explorer puts `application/vnd.code.uri-list` (all items, folders included), `resourceurls`, `codefiles`, and `text/uri-list` (first item) on a drag [primary: VS Code `src/vs/workbench/browser/dnd.ts:268-290, 400-410`].

## Options considered

| Aspect | A: Shift hint + better drop handling (recommended) | B: A plus a tree-view drop zone | C: hint only |
| --- | --- | --- | --- |
| How it works | Placeholder says "hold Shift to drop files"; drop target while Shift-dragging; all Explorer types read; Finder text by content; messages | Also a small "Drop files here" tree view in kernl's side bar, which takes drops without Shift (tree views aren't webviews) | Placeholder only |
| Matches | Claude Code, Cline, Continue | Nobody found | — |
| Cost | Panel only, plus host message | A, plus a second view and a drop controller | Smallest |
| When it fails | You still have to hold Shift | A second place to drop, away from the composer | Finder drops still silent |
| Completeness | 8/10 | 9/10 | 4/10 |

RECOMMENDATION: A, because it's what VS Code allows inside a webview and what the other chat extensions do; B adds a second drop place for the no-Shift case only.

## Decision

Option A. The block stays VS Code's; kernl makes the Shift path visible and handles every kind of drop it can read.

## Design

### Part 1: discoverable, complete Explorer drops

- **Placeholder:** "Describe what to build · hold Shift to drop files". The `+` attach menu's tooltip says the same.
- **Drop target:** on `dragenter`/`dragover` that reaches the panel (only with Shift), the composer shows "Drop to attach" (border and label); `dragleave`/`drop` clear it. `preventDefault` on `dragenter` too, so VS Code doesn't take a Finder drag back.
- **Reading a drop** (`dropData.ts`, pure): `application/vnd.code.uri-list` (all items), else `resourceurls` (JSON), else `codefiles` (paths become `file:` URIs), else `text/uri-list`. Lines starting with `#` are skipped.

### Part 2: Finder files by content

- A drop with `File`s and no URIs: each file up to 20,000 characters that reads as text (not binary: no NUL bytes in its first 8 KB) becomes a text attachment named after the file.
- Others (images, binary, too large, folders) are listed in one message: "Couldn't attach logo.png (not text), big.log (over 20,000 characters). Drag workspace files from the Explorer instead."

### Part 3: feedback

- A drop with nothing usable: "Nothing to attach from that drop."
- A file from another folder of the window: "a.ts is in the Experiment folder: switch to it with the workspace chip to attach it." (The host checks every local folder.)
- kernl's log records the drop's data types when nothing was attached, for the next diagnosis.

## Risks and mitigations

| Risk | Likelihood | Impact | Mitigation | How we'd notice |
| --- | --- | --- | --- | --- |
| A Shift-drop from the Explorer doesn't reach the panel in practice | Low | High | M tries it before Part 1 is built (Need from M) | M's try |
| A Finder file's content goes to the model unasked | Low | Medium | Only on an explicit drop; shown as a chip you can remove before sending | Panel test |
| A binary file is attached as garbage | Low | Low | NUL-byte check; size cap | Unit test |
| The drop target flickers between child elements | Medium | Low | Count enter/leave; clear on drop and on window leave | Panel test |

## Acceptance criteria

- Given the composer, then its placeholder says to hold Shift to drop files.
- Given a Shift-drag over the panel, then the composer shows "Drop to attach"; leaving clears it.
- Given a drop with `vnd.code.uri-list` of a file and a folder, then both are attached.
- Given a drop with only `resourceurls` or `codefiles`, then its files are attached.
- Given a Finder drop of a small text file, then it's attached by content; of an image, then a message names it.
- Given a drop with nothing usable, then a message says so.
- Given a file from another folder, then the message names that folder.

## Rollout and rollback

Panel and one host message; no stored data. Rollback: revert and reinstall.

## Parts

### Part 1: discoverable, complete Explorer drops

- [x] Placeholder and `+` hint; drop target; `dropData.ts` reading every type. Done: unit tests for each type; panel test for the target.

### Part 2: Finder files by content

- [x] Text files by content; others listed. Done: panel tests with fake `File`s (text, binary, large, image).

### Part 3: feedback

- [x] Nothing-usable message; other-folder message; log of drop types. Done: panel and host tests.

### Finish

- [x] `docs/guides/panel.md`, `docs/known-issues/README.md`; suites (61 pass); package; install. M's Explorer Shift-drag found the upstream regression; a Finder drag wasn't tried live.

## Standardized review

- **Bottom line:** usable; the root cause is verified in the installed VS Code, and the plan works within it.
- **Criteria:** goal fidelity pass (M's report maps to the diagnosis and each gap to a part); current-system accuracy pass (tagged); scope pass (no-Shift drops and images excluded, with reasons); architecture pass (pure drop reader in the panel, folder check in the host); sequencing pass; completeness pass (hint, reading, Finder, feedback, docs); failure and recovery pass; verification pass (tests per criterion; live drag by M since I can't drag in M's window); decision readiness: one question.
- **Findings:**
  1. **Must-verify:** a Shift-drag from the Explorer today, before building (one try).
  2. **Note:** I can't perform a drag in M's window (VS Code is click-only for me); the final drag check needs M.

## Changes made

- **Part 1:** placeholder "Describe what to build · hold Shift to drop files"; the `+` tooltip says the same (its label stays short for screen readers); "Drop to attach" and a dashed outline while a drag is over the panel (enter/leave counted); `dragenter` taken; `dropData.ts` reads `vnd.code.uri-list`, `resourceurls`, `codefiles`, `text/uri-list`.
- **Part 2:** Finder files become text attachments (up to 20,000 characters; NUL bytes or an image type mean "not text"; unreadable means a folder); the rest are named with the reason.
- **Part 3:** "Nothing to attach from that drop."; the host logs what such a drop carried; a file from another folder names it ("a.ts is in Experiment: switch to it with the workspace chip").
- **Docs:** panel guide; known issues (Shift required; Finder files have no path).

### Live check and upstream regression (M's window, VS Code 1.142.0)

- **Found:** Shift-drags of an Explorer file and folder never reached the panel (no drop target, empty kernl log). Cause: VS Code 1.140.0's Electron upgrade (43.6.0 → 43.7.3) broke Shift-drag from the Explorer into every webview, on macOS and Windows, docked or as a tab [primary: microsoft/vscode#339036 (open, `regression`, "On Deck"); anthropics/claude-code#100023 (bisected to 1.140.0; Finder still works)].
- **Decided (M, option A):** the composer and docs point to the ways that work: `@`, the Explorer's **Add to kernl chat**, Shift-drag from Finder. Placeholder "Describe what to build · @ to add files"; the `+` tooltip names the Explorer's right-click; known issues links #339036.
- **Not built:** a keyboard shortcut for Add to kernl chat from the Explorer. VS Code runs a shortcut's command with no arguments (only the shortcut's own), so an extension can't see the Explorer selection [verified: installed `workbench.desktop.main.js`, keybinding dispatch `executeCommand(commandId)`]. M decided to leave it out.
- **Fixed while building:** a command run with no files no longer logs as an empty drop (the log is written where a drop reports it).

## Open questions

1. **Files dropped from Finder.** A (recommended): text files are attached by their content (up to 20,000 characters); others are named in a message. B: Finder drops are refused with a message pointing to the Explorer. RECOMMENDATION: A because dropping a file from anywhere is what people expect, and text is what agents can use. Completeness: A 8/10, B 6/10.
