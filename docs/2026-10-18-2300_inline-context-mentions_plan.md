# Inline context mentions and the current-file suggestion

- Date: 2026-10-18 23:00
- Status: done
- Repos: yourstack   Files: `src/webview/attachments.ts`, `src/webview/main.ts`, `media/panel.css`, `src/ui/protocol.ts`, `src/controller.ts`, `test/unit/webview.test.ts`, `test/vscode/suite.ts`, `README.md`
- Subagents: none

## Context and problem

M showed two screenshots (2026-10-18):

1. **Context inside the message:** attached files and folders appear as highlighted `@path` tokens within the message text (`@Develop/ @Develop/forms-backend-v2/assets-endforms/postcss.config.js`). Today YourStack shows them as chips above the input. [verified: `src/webview/attachments.ts`, `chips`]
2. **Current-file suggestion:** a dashed "+ TS useRewards.ts" chip offers the file open in the editor; one click adds it.

## Goals / Non-goals

Goals:

- **Inline mentions:**
  - Files and folders appear as `@path` tokens inside the text, colored like links, from every source (`@` autocomplete, `+` Files & Folders, drops, Explorer "Add to YourStack chat", the suggestion).
  - A token deletes as one unit with Backspace.
  - The message keeps the tokens, so the agent sees where each file was mentioned, and the attachment list goes with it as today.
- **Current-file suggestion:**
  - A dashed chip with the file's type badge and name, for the editor file the user is looking at, when it's inside the shown workspace and not mentioned yet.
  - Clicking it inserts the mention; it hides once mentioned.
- **Text attachments** (Conversation, Issue, Pull Request) stay chips above the input: they're content, not paths.

Non-goals:

- A rich-text (contenteditable) editor: pasted HTML and undo would become ours to secure and rebuild.
- Mentions of symbols or line ranges.

## What is true today

| Fact | Evidence |
| --- | --- |
| The composer is a `<textarea>`; attachments live in a separate list rendered as chips | [verified: `src/webview/main.ts`, `src/webview/attachments.ts`] |
| `send` carries `attachments` (path + kind, or text) | [verified: `src/ui/protocol.ts`] |
| The host knows workspace roots; no active-editor messages exist | [verified: `src/controller.ts`] |

## Options considered

| | A. Highlight layer behind a native textarea (recommended) | B. contenteditable with atomic token elements |
| --- | --- | --- |
| How it works | The textarea's text is drawn by a mirrored layer beneath it, with mention spans colored; the textarea keeps the caret, selection, undo, IME | Tokens are real inline elements in an editable div |
| Safety | No HTML editing; text stays text | Paste, drop, and undo must be intercepted to keep HTML out |
| Matches the screenshot | Yes (colored, background-tinted tokens) | Yes, plus pill borders |
| Risk | Layer must match the textarea's font and wrapping exactly (same CSS) | Large: browser contenteditable quirks |
| Completeness | 8/10 | 9/10 |

RECOMMENDATION: A, because it keeps the browser's own text editing (and our no-HTML rule) while looking the same.

## Design

- **Webview (`attachments.ts`):**
  - Keeps `known` (mentioned path to kind) and renders the highlight layer from the input text: `@path` tokens that are in `known` become `.mention` spans, everything else plain text.
  - Paths with spaces are written `@"path with spaces"`.
  - `insertMention(a)` puts `@path ` at the caret.
  - Backspace right after a known token removes the whole token.
  - On send, attachments = known mentions still present in the text, plus text chips.
- **Suggestion:**
  - The host posts `activeFile { path?: string }` on active-editor changes and on panel ready, relative to the shown workspace's root (undefined outside it).
  - The panel shows the dashed chip unless that path is already mentioned.
- **CSS:**
  - The textarea text is transparent with a visible caret; the layer draws the text.
  - Both share font, padding, line height, wrapping, and scroll position.

## Risks and mitigations

| Risk | Likelihood | Impact | Mitigation | How we'd notice |
| --- | --- | --- | --- | --- |
| Layer and textarea drift (wrapping, scroll), so tokens misalign | Medium | Medium | Same box metrics; sync scroll on input and scroll; screenshots at 300 and 500 px | Screenshots |
| A typed `@word` that isn't a picked file looks like a mention | Low | Low | Only picked paths highlight and attach | Click test |
| Active-editor path leaks other folders | Low | Low | Only paths inside the shown workspace are suggested | VS Code check |

## Acceptance criteria

- **Inline insertion:** given a file picked from `@` autocomplete, then the text holds `@src/app.ts ` highlighted, and sending attaches it.
- **Atomic delete:** given Backspace right after the token, then the whole token is removed and it's no longer attached.
- **Current-file suggestion:** given an editor showing `src/a.ts` in the workspace, then the chip "+ TS a.ts" shows; clicking inserts the mention and the chip hides.
- **Text attachments:** given an Issue attachment, then it stays a chip and still sends.
- **Safety:** HTML typed or dropped into the composer is still only text.

## Parts

- [x] Inline mentions with the highlight layer, atomic delete, send extraction. Done when jsdom tests cover insert, highlight, delete, send, and HTML safety.
- [x] Current-file suggestion (host `activeFile`, chip). Done when a jsdom test and a VS Code check (open a file in the editor, see the suggestion) pass.
- [x] Screenshots, regression, README, package. Done when all pass.

## Standardized review

Reviewed with the plan rubric against `src/webview/attachments.ts`, `src/webview/main.ts`, `media/panel.css`, `src/ui/protocol.ts`, and `src/controller.ts`.

- **Findings, fixed in this file:**
  1. **Must-verify, fixed (failure):** without a rule, a typed `@word` would highlight or attach things the user never picked. Only picked paths count.
  2. **Note, fixed (scope):** text attachments have no path to show inline; they stay chips.
  3. **Note (verification):** layer alignment can only be judged visually; screenshots are a Part 3 gate.
- **Criteria:** goal fidelity, current-system accuracy, scope, dependency direction (host owns paths, panel owns text), sequencing, completeness, failure handling, verification, feasibility, and decision readiness: all pass.
- **Overall:** 0 blocking, 1 must-verify (fixed), 2 notes.

## Changes made

- Mentions drawn by a layer behind a transparent-text textarea (same metrics; alignment verified by overlaying the textarea's own text in red at 300 and 500 px: no offset); only picked paths highlight and attach; Backspace removes a whole mention; text attachments stay chips; host posts `activeFile` (workspace files only) for the dashed suggestion. Unit 169, VS Code 45.

## Open questions

None.
