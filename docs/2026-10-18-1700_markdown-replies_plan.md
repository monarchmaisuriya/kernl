# Safe Markdown rendering for agent replies

- Date: 2026-10-18 17:00
- Status: done
- Repos: yourstack   Folders: src/webview, src/ui, media, test   Files: `src/webview/markdown.ts` (new), `src/webview/main.ts`, `src/ui/protocol.ts`, `src/controller.ts`, `media/panel.css`, `package.json`, `test/unit/markdown.test.ts` (new), `test/unit/webview.test.ts`, `test/unit/webviewSafety.test.ts`, `README.md`
- Subagents: none

## Context and problem

Agent replies appear as plain text. A reply with a code fence, a list, or a link shows raw backticks, dashes, and brackets. This is the biggest remaining readability gap in the redesigned panel.

The constraint that shapes everything: reply text is untrusted. It can echo file contents or web pages. If any of it became HTML, injected markup could press Approve by itself.

## Goals / Non-goals

Goals:

- **Elements:** assistant replies render paragraphs, headings, bold, italic, strikethrough, inline code, code fences (monospace block with a language label and a Copy button), bullet and numbered lists (nested), block quotes, horizontal rules, tables, and links.
- **Links:** clicking asks the host to open the URL in the browser. Only `http:` and `https:` are allowed; anything else shows as plain text. The webview itself never navigates.
- **Images:** never loaded. `![alt](url)` renders as a link labeled with the alt text (http(s) only).
- **Raw HTML in a reply:** shown as literal text.
- **Streaming:** each delta re-renders the current reply. A half-written code fence shows as an open code block, not broken layout.
- **Unchanged:** user messages, tool arguments and results, and approval cards stay plain text, exactly as today.

Non-goals:

- Syntax highlighting (a separate decision; it needs a highlighter dependency).
- Math, Mermaid diagrams, or embedded HTML.
- Markdown in approval cards (they must show the exact text being approved).

## What is true today

| Fact | Evidence |
| --- | --- |
| Assistant text is appended with `textContent += delta` into one `.assistant` div per reply | [verified: `src/webview/main.ts`, `case "text"`] |
| A safety test forbids `innerHTML`, `outerHTML`, `insertAdjacentHTML`, `document.write`, `eval(`, `new Function`, `DOMParser`, and `createContextualFragment` in every `src/webview/*.ts` | [verified: `test/unit/webviewSafety.test.ts`] |
| CSP: `default-src 'none'`; scripts by nonce; `img-src ${cspSource} data:`, so remote images can't load anyway | [verified: `src/ui/panel.ts`, `contentSecurityPolicy`] |
| Panel-to-host messages are validated against a fixed type list | [verified: `src/ui/protocol.ts`, `isPanelToHost`] |
| Webview bundle today: 7.4 KB | [verified: `out/webview/main.js`] |
| `marked@18.0.14` (MIT, zero dependencies, released 2026-09-22) exports `lexer` and `Lexer.lexInline`, which return tokens (`code`, `list`, `link`, `html`, ...) and never HTML | [verified: `npm view`; `package/lib/marked.d.ts:541-616,817`] |

## Options considered

| | A. Our own tokenizer | B. `marked` lexer, our own DOM builder (recommended) | C. `marked` HTML output plus a sanitizer (DOMPurify) |
| --- | --- | --- | --- |
| How it works | About 150 lines parse the subset we support | `marked.lexer(text)` gives tokens; we build elements from them with `createElement`/`textContent` | Render HTML, sanitize, insert with `innerHTML` |
| Safety | Never HTML | Never HTML: tokens only; `html` tokens become text | Depends on the sanitizer; violates the no-`innerHTML` rule |
| Edge cases (nested lists, emphasis rules, fences) | Ours to get right; easy to get wrong | CommonMark/GFM behavior from a mature parser | Same as B |
| Cost | No dependency | One pinned dependency; bundle grows by about 40 KB [unverified: measured in Part 1] | Two dependencies; looser model |
| Completeness | 6/10 | 9/10 | 7/10 |

RECOMMENDATION: B, because it gets mature Markdown parsing without ever producing HTML, so the existing safety rule stays absolute.

## Decision

Use `marked@18.0.14`'s lexer only, and build DOM nodes from its tokens in a new `src/webview/markdown.ts`.

- **Links and Copy go through the host:** new panel messages `openLink` (host re-checks `http(s)` and calls `vscode.env.openExternal`) and `copy` (host calls `vscode.env.clipboard.writeText`).
- **Structural reason:** the parser only produces data, the one renderer turns data into DOM, and the host owns side effects (opening URLs, the clipboard). Each layer does one thing, and nothing in the webview can turn text into markup.

## Design

```
text delta --> pane.replyText += delta --> markdown.ts: lexer(text) --> tokens --> createElement/textContent --> replace .assistant children   <-- new
link click --> {type:"openLink", url} --> host: URL is http(s)? --> vscode.env.openExternal                                                   <-- new
Copy click --> {type:"copy", text} -----> host: vscode.env.clipboard.writeText                                                               <-- new
```

- **`src/webview/markdown.ts` (new):** `renderMarkdown(text, actions): DocumentFragment`.
  - One function per token type. Unknown token types fall back to their `raw` text.
  - `href` is accepted only if `new URL(href)` has protocol `http:` or `https:`; otherwise the link renders as plain text.
  - `actions` = `{ openLink(url), copy(text) }`, so the module has no knowledge of the host.
- **`src/webview/main.ts`:** each pane keeps `replyText` for the current reply. On `text`, append the delta and re-render that reply's element. `replyText` resets everywhere `assistant` resets today (user message sent, tool call, finished, cleared), so one reply never bleeds into the next. User and tool output paths are unchanged.
- **`src/ui/protocol.ts`:** add `{ type: "openLink"; url: string }` and `{ type: "copy"; text: string }`.
- **`src/controller.ts`:** handlers with the same `http(s)` check (the host is the trust boundary; the webview check is only for display).
- **`media/panel.css`:** styles for `.md` elements (code blocks with a header row, tables with borders, list spacing, block quotes), all on theme variables.
- **`package.json`:** `"marked": "18.0.14"` (exact).
- **Performance:** re-parsing the whole reply per delta is O(length) each time. Part 2 measures a 50 KB reply streamed in 1,000 deltas in jsdom. If it takes over 1 s, renders are coalesced per animation frame (decided by the measurement, not up front).

## Risks and mitigations

| Risk | Likelihood | Impact | Mitigation | How we'd notice |
| --- | --- | --- | --- | --- |
| A token type renders untrusted text as markup | Low | High | DOM built only with `createElement`/`textContent`; `html` tokens become text; safety test plus hostile-input tests | Unit tests |
| `javascript:` or `file:` links | Medium | High | Rejected in the webview (shown as text) and again in the host | Unit and VS Code tests |
| Re-render cost on long replies | Medium | Low | Measured; coalesce per frame if needed | Perf test |
| Re-rendering while the user selects text loses the selection | Medium | Low | Only the streaming reply re-renders; finished replies are never touched | Manual check |
| A future `marked` update changes token shapes | Low | Medium | Exact pin; unknown tokens fall back to raw text; tests per element | Unit tests |
| Supply chain | Low | Medium | Version at least 2 weeks old, zero dependencies, exact pin | n/a |

## Acceptance criteria

- **Elements:** given a reply with each supported element, when rendered, then each appears as its element (`pre code`, `ul/ol li`, `table`, `a`, `strong`, `em`, `del`, `blockquote`, `h1`-`h6`, `hr`).
- **Hostile input:** given `<img onerror>`, `<script>`, a `javascript:` link, and a `file:` link, then no `img`, `script`, or non-http(s) `a` exists, and the text is shown literally.
- **Streaming:** given a code fence streamed in pieces, after every delta the reply has one open code block containing the text so far. After the closing fence, the following text is outside it.
- **Links:** given a click on a rendered link, the panel sends `openLink` with the URL. The host opens only http(s) URLs.
- **Copy:** given a click on a code block's Copy, the panel sends `copy` with the exact code.
- **Unchanged paths:** user messages and tool output still render as plain text.
- **Performance (changed by M on 2026-10-18, twice):** in a 50 KB reply streamed in 1,000 deltas, the 99th percentile delta renders within 16 ms (one frame) and the slowest within 50 ms (no visible freeze); total, 99th percentile, and slowest are reported. The first strict criterion (slowest under 16 ms) failed about 1 run in 5 on a single garbage-collection-sized pause (16.6 ms once; otherwise about 6 ms).

## Rollout and rollback

- Ships in the next VSIX. No settings or data change.
- Rollback: reinstall the previous VSIX.

## Parts

### Part 1: Markdown renderer

- [x] Add `marked@18.0.14`; `src/webview/markdown.ts`; `test/unit/markdown.test.ts`; extend the safety test's file list. Done when tests cover every element, hostile input, link filtering, and a fence streamed in pieces, and the bundle size is recorded.

### Part 2: Wire into the panel and host

- [x] Re-render the streaming reply; `openLink` and `copy` messages with host handlers; CSS; perf measurement. Done when the jsdom panel tests and a VS Code check (link refusal for `file:`, copy reaches the clipboard) pass, and the perf result is recorded.

### Part 3: Screenshots, regression, package

- [x] Preview the real bundle with a fake host, dark and light, at 300 and 500 px; unit and VS Code suites (dev and minified); README; VSIX; reinstall. Done when all pass and M has the screenshots.

## Standardized review

Reviewed with the plan rubric against `src/webview/main.ts`, `src/ui/protocol.ts`, `src/ui/panel.ts`, the safety and panel tests, and the `marked@18.0.14` type definitions.

- **Findings:**
  1. **Must-verify, fixed in Design (correctness):** a reply's raw text must reset at the same four points as the current `assistant` element (send, tool call, finished, cleared), or text from one reply would re-render inside the next. Covered by a panel test in Part 2.
  2. **Note (defense in depth):** the safety test scans our sources, not the bundled parser. Acceptable, because the parser's output is data that only our renderer turns into DOM; the hostile-input tests exercise the real bundle.
- **Criteria:** goal fidelity pass (formatting with no path to HTML); current-system accuracy pass (claims tagged with evidence); scope pass (highlighting, math, diagrams excluded); dependency direction pass (parser makes data, renderer makes DOM, host owns side effects); sequencing pass (renderer before wiring); completeness pass (tests, CSS, README, rollback); failure and recovery pass (unknown tokens fall back to raw text; no data change); verification pass (element, hostile, streaming, perf, and host checks); feasibility pass (lexer API verified in the type definitions); decision readiness pass (no open questions).
- **Unverified, measured in Parts 1 and 2:** bundle growth and render cost.

## Changes made

- Part 1: `marked@18.0.14` (exact); `src/webview/markdown.ts` builds DOM from lexer tokens only (raw HTML as text, images as links, http(s)-only links without `href`, entities decoded for display, task-list checkboxes); `test/unit/markdown.test.ts` (7 tests); the safety test covers `markdown.ts`. Found while testing: task checkboxes arrive as block-level children, and the renderer now handles them.
- Surprise in Part 2: the first wiring rebuilt the whole reply on every delta and took 19.2 s for 50 KB in 1,000 deltas (jsdom). Lexing was 1.46 s of that; building DOM was the rest. Per-frame batching would not have fixed it. With M's approval, `MarkdownView` re-lexes the full text but rebuilds DOM only from the first changed top-level block. Result: total 1.6 s, slowest delta 3.5 ms (budget 16 ms).
- Part 2: `httpUrl()` moved into `src/ui/protocol.ts`, so the panel and the host share one http(s) rule; panel messages `openLink` (host re-checks, then `vscode.env.openExternal`) and `copy` (`vscode.env.clipboard`); Markdown CSS on theme variables; panel tests for rendering, Copy, links, plain user messages, and per-reply reset; VS Code check that Copy reaches the clipboard.
- Part 3: screenshots (dark and light, 300 and 500 px) sent to M. Unit 109/109; VS Code 31/31 on dev and minified bundles; README; VSIX packaged and installed (installed files match). Minified webview bundle: 56.8 KB (was about 5 KB), above the plan's 40 KB estimate.
- Not verified by an automated test: that a clicked http(s) link actually opens the browser (a test would open a real browser). The refusal rule is unit-tested; the host handler is 3 lines that call it.

## Open questions

None.
