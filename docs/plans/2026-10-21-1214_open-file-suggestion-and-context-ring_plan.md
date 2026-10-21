# Suggest any open file; the context ring at the composer's top right

- Date: 2026-10-21 12:14
- Status: done (not committed)
- Repos: kernl   Files: `src/controller.ts`, `src/ui/protocol.ts`, `src/webview/attachments.ts`, `src/webview/main.ts`, `media/panel.css`, `test/unit/webview.test.ts`, `test/vscode/suite.ts`, `docs/guides/panel.md`, `CHANGELOG.md`
- Subagents: none
- Sign-off: M (2026-10-21): "show a suggestion to add current open file as context as it happens in vs code chat and move the context icon to top right of composer so above the send button"; then "it suggests only if file is in workspace, i want any file"; chose "Suggest always" (keep the + chip) over auto-including the file. M's shown workspace "Develop" is one folder of a multi-folder window.

## Context and problem

- The composer offers the file open in the editor as a "+ file" chip, but only when that file is inside the shown workspace's folder. M's open file was elsewhere (another folder of the window), so nothing showed.
- The context ring (how full the agent's context is, "7%") sits at the footer's right end; M wants it at the composer's top right, above Send.

## What is true today

- The host sends the open file only when `activeTextEditor` is a `file:` document inside the shown workspace's root (`toAttachment`); otherwise `path` is undefined [verified: `src/controller.ts` `postActiveFile`].
- The panel shows the chip when it has a path that isn't already in the message; a click adds it as a path attachment [verified: `src/webview/attachments.ts:123-131`, `:298`]. Checked in a test window: with `README.md` open, "+ MD README.md" shows above the message.
- Path attachments are only for files inside the workspace (the agent reads them there); dropped or picked files outside it are refused with a warning [verified: `src/attachmentSearch.ts` `resolveUris`; `src/controller.ts:1491-1493`].
- Attaching by content exists: Ask kernl about a selection posts `{ kind: "text", path: "<name>:<lines>", text }` from the editor [verified: `src/controller.ts:389-402`]; attached text is cut at 20,000 characters when sent, with a note [verified: `src/ui/protocol.ts:94`, `:114`].
- The ring is created by `createContextRing()` and appended to the footer after the chips, hidden until the agent reports usage [verified: `src/webview/main.ts` footer, `src/webview/contextRing.ts:20-23`]. The composer's `context-row` (suggestion, chips) is above the message and hides when empty [verified: `media/panel.css:279-280`].

## Options considered

| | A: suggest any file, attach by content when outside (chosen by M) | B: auto-include as "Current file" (VS Code style) |
| --- | --- | --- |
| How | The + chip shows for any open file; inside the workspace it attaches by path (as today), outside by its text | The open file is attached to every message unless turned off |
| Fits our code | Reuses the selection path (`kind: "text"`) and the 20,000-character cut | New default-on state per message |
| Risk | Text of an outside file reaches the agent only on a click | Every message carries a file the user may not mean to send |
| Completeness | 9/10 | 8/10 |

RECOMMENDATION: A, which M chose.

## Design

```
editor: any file (file: or untitled:) ──> host postActiveFile
                                             │ inside the shown workspace? ──yes──> { path }              (as today)
                                             └──no──> { path: "<folder>/<name>" label, outside: true }     <-- new
panel chip "+ name" ──click──> inside: path attachment (as today)
                              outside: { type: "attachActiveFile" } ──> host reads the editor's text   <-- new
                                       ──> addAttachments [{ kind: "text", path: label, text }]
```

- **Which files:** the active text editor's document when it's a `file:` document anywhere on disk, or an `untitled:` one (a new, unsaved file). Not offered: non-text editors (image, preview, settings), whose `activeTextEditor` is undefined.
- **Inside the shown workspace:** unchanged (path attachment; the agent reads the file).
- **Outside:** the chip shows the same "+ badge name", with a tooltip "Add <full path> (outside this workspace: attached as its text)". The click asks the host, which reads the document's current text at that moment (unsaved edits included) and adds `{ kind: "text", path: <short label>, text }`. The label is VS Code's own `asRelativePath(uri, true)`: `<folder>/<path>` for a file in a window folder, the full path otherwise (`Untitled-1` for a new file). Text over 20,000 characters is cut when sent, as for every text attachment.
- **Protocol:** `activeFile` gains `outside?: boolean`; a new panel message `attachActiveFile` (validated like every panel message). The host never takes a path from the panel for this: it reads its own active editor, so a panel message can't name an arbitrary file.
- **Already added:** the chip hides when that file is already in the message (by path inside, by its label outside).
- **Context ring:** moves from the footer into the composer's `context-row`, pushed to the right (`margin-left: auto`), so it sits at the composer's top right, its right edge on Send's. The row shows when the ring alone is visible. The token count (`usage`) stays in the footer.

## Risks and mitigations

| Risk | Likelihood | Impact | Mitigation | How noticed |
| --- | --- | --- | --- | --- |
| A file with secrets outside the workspace (`~/.ssh/config`, `.env`) is sent to the agent | Low (needs a click) | High | Only on a click; the tooltip says it's attached as text. The redactor scrubs stored keys from what kernl shows and logs, not from what you send the agent, so the click is the safeguard | Tooltip text; webview test |
| The editor changes between the chip showing and the click | Low | Low | The host reads its current active editor at the click; if it's a different file, it attaches that one, which the chip just showed (the chip follows the editor) | Suite check |
| A huge file | Low | Low | The 20,000-character cut with a note (existing) | Unit test |
| The ring row adds height when only the ring shows | Medium | Low | Measured in a real window; the row is the same 1-line height as the suggestion chip | Screenshot |

## Acceptance criteria

- Given a file open from another folder of the window (or anywhere on disk), then the composer offers "+ name"; clicking it adds a text attachment with that file's current text.
- Given a file inside the shown workspace, then the chip adds a path attachment, as today.
- Given an image or a Markdown preview active, then no chip shows.
- Given the agent reported context usage, then the ring shows at the composer's top right, its right edge aligned with Send's (within 1 px), and the footer has no ring.

## Rollout and rollback

Release as a patch (0.12.1). Rollback: revert the commit; nothing stored changes.

## Parts

### Part 1: any open file

- [x] Host: `postActiveFile` for any `file:`/`untitled:` editor, with `outside` and a label; `attachActiveFile` reads the editor's text. Done: suite check with a file outside the workspace (attachment is `kind: "text"` with its content) and inside (path, as today).
- [x] Panel: chip for outside files (tooltip, already-added check), click sends `attachActiveFile`. Done: webview unit tests.

### Part 2: context ring

- [x] Move the ring into `context-row` at the right. Done: webview unit test (ring inside the composer, not the footer); real-window measurement against Send.

### Part 3: docs and verification

- [x] Guide (`panel.md` composer and footer bullets), changelog; unit, both suites, real window. Done: all pass; screenshots.

## Standardized review

**Bottom line:** plan, approve with notes. It does what M asked (any open file, the ring above Send) with M's chosen behavior, reuses the existing text-attachment path and its 20,000-character cut, and never lets the panel name a file for the host to read. Two notes were folded in before presenting.

| Criterion | Verdict | Evidence |
| --- | --- | --- |
| Goal fidelity | pass | M's three messages and choice are the goals |
| Current-system accuracy | pass | Each claim cited; the chip checked in a test window |
| Scope and cohesion | pass | Two composer changes M asked for; `usage` explicitly left in the footer |
| Architecture and dependency direction | pass | The host owns reading files (from its own active editor); the panel only asks |
| Sequencing | pass | Host and panel per part; ring separate; docs last |
| Completeness | pass | Inside, outside, untitled, non-text editors, already-added, size |
| Failure and recovery | pass | Editor changed before the click; huge file; rollback |
| Verification | pass | Suite check for both attachment kinds; webview tests; real-window measurement |
| Feasibility | pass | `kind: "text"` and the cut exist; `PANEL_MESSAGE_TYPES` takes the new message [verified: `src/ui/protocol.ts:337`] |
| Decision readiness | pass | M decided the behavior |

Findings (notes, folded in):
- **Note, accuracy:** the secrets mitigation overstated the redactor; it scrubs what kernl shows and logs, not what is sent to the agent. Reworded: the click is the safeguard.
- **Note, simplicity:** the `~/…` label form was extra code; VS Code's `asRelativePath(uri, true)` already gives the folder-relative or full path.

## Changes made

- M (2026-10-21): "do this" for the open-file chip and **Ask kernl about this file or selection**, so both offer or attach any file.
- `src/controller.ts`: `postActiveFile` offers any `file:` or `untitled:` editor (`outside` plus a label from `asRelativePath(uri, true)`); `attachOpenFile` attaches a workspace file by path, any other by its current text; the `attachActiveFile` message and Ask kernl with nothing selected use it (other editor kinds keep `attachUris`).
- `src/ui/protocol.ts`: `activeFile.outside`; the `attachActiveFile` message (in `PANEL_MESSAGE_TYPES`).
- `src/webview/attachments.ts`: the chip's tooltip for outside files; hidden once the file is in the message (by mention or by its text chip); its click asks the host; chip changes refresh it.
- `src/webview/main.ts`, `media/panel.css`: the ring in `context-row` at the end; the row stays on one line (attachments wrap within their own area); the ring's text ends where Send's arrow does.
- Tests: the chip test (click asks the host), a new outside-file test, the ring's place; the suite's current-file check now attaches a workspace file by path and an outside file by its text (unsaved edits included), and Ask kernl attaches it too.
- Verified: tsc clean; unit 428/428; single-folder 104/104; multi-root 7/7. Real window: an outside file's chip shows and attaches as its text; the ring sits on the chip's line, its text 0.3 px from Send's arrow (after two CSS fixes found there: the ring wrapped under a long chip, and it ended 7.8 px right of the arrow).
- M (2026-10-21), before committing: an attached file's chip shows its name first (whole path in the tooltip), and less right padding on the ring. `attachmentChip` shows a text attachment's last path segment (`/` or `\\`); the ring's right inset is 3 px (Send's padding), so it no longer lines up with Send's arrow. Thread text (`Thread: …`) never reaches a chip: messages keep their original attachments [verified: `src/workspaceRuntime.ts:525`, `:537`]. Real window: the chip reads `todo.md` with the full path in its tooltip; unit 428/428.
- Suite finding (not this change): the tab-limit check failed (12-check cascade) because tabs' last use was a `Date.now()` timestamp, and two uses in one millisecond tied, the tie going to tab 1. Fixed at the owning layer, M's go-ahead: `markUsed` records an increasing use count (`src/controller.ts`), and the check shows tab 1 through `kernl.previousTab` and waits for the panel's own report. First attempt (only the test change) still failed 2 of 2: re-diagnosed from the timeline before the counter fix.
- Verified after all of it: tsc clean; unit 428/428; single-folder 104/104 twice; multi-root 7/7.
- Not checked: a new unsaved (`untitled:`) file in the real window (covered by the code path, not by a test).

## Open questions

- None (M chose the behavior; `usage` staying in the footer is stated above).
