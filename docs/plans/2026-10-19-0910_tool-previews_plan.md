# Previews of the files and web pages a tool touched

- Date: 2026-10-19 09:10
- Status: done
- Repos: kernl   Folders: `src/acp/`, `src/agent/`, `src/webview/`, `src/ui/`, `media/`, `test/`
- Files: `src/acp/acpRunner.ts`, `src/agent/session.ts`, `src/workspaceRuntime.ts`, `src/sessions.ts`, `src/controller.ts`, `src/ui/panel.ts`, `src/ui/protocol.ts`, `src/webview/main.ts`, `src/webview/toolRow.ts`, `src/webview/toolGroup.ts`, new `src/webview/previews.ts`, `media/panel.css`, tests, `test/fixtures/fakeAcpAgent.ts`, `docs/guides/panel.md`
- Research: `docs/research/2026-10-19-0900_tool-previews_research.md`
- Subagents: none

## Context and problem

M's reference is the Claude desktop app: a collapsed step line, "Read kernl.png, ran a command", with a small thumbnail of the image at its right edge. M wants previews like that for files and for web content.

In kernl today, an image the agent reads (or kernl's own browser screenshot) never reaches the panel. A text file shows only as a path. A web fetch shows the raw "Fetch https://…" text, and search hits come as plain text lines.

## Goals / Non-goals

**Goals**

- An image a tool read or produced shows as a thumbnail on its line (and on its group's line), and larger when the line is opened.
- A group of reads shows which files, as chips (file icon plus name) that open the file.
- A web fetch shows the site as a chip (globe icon plus site name); search hits show as a list of title and site links.
- Previews come back after a window reload, and are deleted with their conversation.

**Non-goals**

- Favicons or any other image from the web (question 1).
- Previews of PDFs, notebooks, or videos.
- Text snippets of read files on the line (the opened row already shows the output).

## What is true today

- **Images are dropped** in both agent paths: the ACP runner and kernl's own agent keep only text [verified: `src/acp/acpRunner.ts` `textOf`; `src/agent/session.ts:34,158`].
- **Claude Code sends a read image as base64** `{ type: "image", data, mimeType }` [verified: adapter 0.93.0 `dist/tool-calls/content.js:91-97`]; kernl's `browser_screenshot` returns a PNG block [verified: `src/browser/tools.ts:47-52`].
- **Web calls:** "Fetch <url>" / `Search "<q>"`, `kind: "fetch"`, `rawInput.url` / `.query`; hits are "Title (url)" lines [verified: adapter `reporters/web.js:3-44`].
- **The panel loads only its own files and `data:` images** [verified: `src/ui/panel.ts:37,66`].
- **Saved vs shown:** `this.post` saves to the conversation, `this.host.post` only shows [verified: `src/workspaceRuntime.ts:577-579`]. "Delete conversations" removes the `sessions` folder; deleting one conversation removes its `.json` [verified: `src/sessions.ts:92,117`].

```
agent ──image block──> acpRunner / session ──X dropped                       <-- today
agent ──image block──> acpRunner / session ──toolImage──> runtime ──saves file──> previews/<conversation>/<call>.png
                                                                 └─post toolPreview(file)──> panel thumbnail   <-- new
```

## Options considered

| Aspect | A: saved image files, shown by link (recommended) | B: images inside the saved conversation | C: live only |
| --- | --- | --- | --- |
| How it works | The host writes each image to kernl's storage and saves only its file name; the panel loads it from there | The base64 image goes into the conversation's `.json` | Shown while the window is open; not saved |
| After a reload | Back | Back | Gone |
| Cost | A storage folder the panel may read; deleting it with the conversation | Conversations grow by megabytes; every replay re-sends them | Smallest |
| When it fails | A missing file shows no thumbnail | Slow loads, large files | M reloads often, so previews keep vanishing |
| Completeness | 9/10 | 6/10 | 5/10 |

RECOMMENDATION: A, because previews survive reloads without bloating conversations.

## Decision

Option A, no favicons. Images are taken from the agent's own output (never fetched), saved under kernl's storage, and the panel may read only that previews folder.

## Design

### Part 1: images reach the panel

- **Events:** `SessionEvents.toolImage?(id, { mimeType, data })`. The ACP runner emits it for each `image` block in a tool's content; kernl's agent for each image part in a tool message.
- **Accepted:** PNG, JPEG, GIF, WebP only (no SVG); at most 5 MB decoded. Others are skipped (the row still shows the text).
- **Saved:** `globalStorage/previews/<conversation id>/<call id>-<n>.<ext>`; the conversation saves `{ type: "toolPreview", id, file }`.
- **Shown:** `status` carries `previewBase` (the previews folder as a webview link); the panel loads `previewBase/file`. `panel.ts` adds the previews folder to `localResourceRoots`.
- **Deleted:** with "Delete conversations", which removes the whole `sessions` folder the previews live in. kernl has no single-conversation delete (`SessionStore.remove` is never called), so a fork can keep using its original's images.

### Part 2: thumbnails

- On a row's line: a 24 px rounded thumbnail before the time; on a group's line: up to 3, then "+N".
- Opened: the image at up to 384 px wide (panel width at most), with **Open** when the call has a file location (opens it in VS Code).
- `alt` is the file name or "Screenshot"; images are decorative on the line (`aria-hidden`) and labeled when opened.

### Part 3: file chips

- A group's line lists its files as chips after the summary ("Explored 2 files, 3 searches · useRewards.ts · helpers.ts"), up to 3 then "+N"; each opens the file (existing `openLocation`, workspace files only).
- Names come from the call's locations (CLI agents) or its path argument (kernl's `read_file`).

### Part 4: web chips and search hits

- A fetch's line: "Fetch" with a chip of the site name (`example.com`); the full URL in the tooltip; opened: the link (existing `openLink`, http(s) only) and the question asked.
- A web search's line: the query and "N results"; opened: each hit as title and site, a link.
- kernl's `browser_navigate` gets the same site chip.

## Risks and mitigations

| Risk | Likelihood | Impact | Mitigation | How we'd notice |
| --- | --- | --- | --- | --- |
| A huge image slows the panel | Medium | Medium | 5 MB cap; thumbnails scaled by CSS | Panel test with an oversized image |
| An image renders something unsafe | Low | High | Raster types only, from the agent's own output; never a URL; no SVG | Unit test that SVG and URLs are refused |
| Previews outlive their conversation | Medium | Low (disk) | Deleted with the conversation and with "Delete conversations" | Unit test of both deletes |
| The panel reads other storage | Low | Medium | Only `previews/` is a resource root, not `sessions/` | Code review of `panel.ts` |
| OpenCode or Codex send images differently | Medium | Low | Falls back to today's text | Live run per agent |

## Acceptance criteria

- Given Claude Code reads a PNG, when the call finishes, then its line shows a thumbnail, and opening it shows the image larger with Open.
- Given a group of reads, then its line shows up to 3 file chips that open the files.
- Given a web fetch, then its line shows the site name, and opening it gives the link.
- Given a web search, then opening it lists each hit as a link.
- Given a reload, then thumbnails are back; given the conversation is deleted, then its images are gone from disk.
- Given an SVG or a URL image, then nothing is saved or shown.

## Rollout and rollback

No change to stored conversations beyond a new optional event type; older conversations replay unchanged. Rollback: revert and reinstall; the previews folder can stay (it's deleted with history).

## Parts

### Part 1: images reach the panel

- [x] `toolImage` from both agent paths; save, record, delete. Done: unit tests (runner image block, kernl screenshot, SVG refused, size cap, both deletes).

### Part 2: thumbnails

- [x] Row and group thumbnails; opened image with Open. Done: panel tests; fake agent reads an image; end-to-end check.

### Part 3: file chips

- [x] Group file chips. Done: panel test.

### Part 4: web chips and hits

- [x] Fetch site chip, search hits list, `browser_navigate` chip. Done: panel tests.

### Finish

- [x] `docs/guides/panel.md`; full suites; package; install; check in M's window.

## Standardized review

- **Bottom line:** usable once M answers the two questions.
- **Criteria:** goal fidelity pass (each asked preview has a part); current-system accuracy pass (tagged against code and the adapter); scope pass (no favicons, PDFs, snippets); architecture pass (agent paths emit, the runtime saves, the panel shows); sequencing pass (Part 1 before 2; 3 and 4 independent); completeness pass (storage, CSP roots, deletes, docs); failure and recovery pass (caps, fallbacks, revert); verification pass (test per criterion); decision readiness: two questions.
- **Findings:**
  1. **Must-verify:** OpenCode and Codex image and web output, checked live at the end.
  2. **Note:** M's reference behavior (Claude desktop) is undocumented; the plan follows what the screenshot shows.

## Changes made

- **Part 1:** `toolImage` from the ACP runner (image blocks) and kernl's agent (`imagesOf`); `SessionStore.savePreview` (PNG, JPEG, GIF, WebP, up to 5 MB) under `sessions/previews/`; `toolPreview` saved with its file name; `previewBase` in the status; the panel may load only that folder. An image-only result no longer shows "completed" as its output.
- **Part 2:** a 24 px thumbnail on the row's line and up to 3 (then "+N") on its group's line; opened, the image up to 384 px with **Open <file>**. The panel accepts only a saved preview's own name.
- **Part 3:** a group's line names its files as chips (each once, up to 3); a chip opens the file without opening the group; kernl's `read_file` counts too.
- **Part 4:** a fetch shows "Fetch <site>", its address as a link when opened; a web search shows "N results" and its hits as title + site links; `browser_navigate` shows its site; only http(s); no images from the web.
- **Found while testing, fixed (approved by M):** previews were never saved with their conversation (posted after the run's save), and New Chat saved the new, empty conversation instead of the one it left (`saveSession` and kernl's `exportHistory` read `this.session` / the thread after an `await`). Both now read everything when the save starts; a preview is saved into its own conversation. Checks: unit test for the export (fails with the old code), VS Code check that New Chat saves the left conversation with its preview and agent session.
- **Verification:** unit 237 pass, VS Code 60 pass (55 + 5), 0 fail. In M's window (00:31 run): thumbnails and file chips on the group line, both previews saved with the conversation; site chips not exercised live (no fetch in that run).

## Open questions

1. **Favicons for web content.** A (recommended): no; a globe icon and the site name. B: kernl fetches each site's favicon from your machine and shows it. B tells each site you looked at it, and loading web images is how CamoLeak leaked data. RECOMMENDATION: A because it keeps the panel from contacting sites the agent touched. Completeness: A 8/10, B 8/10.
2. **Keeping image previews.** A (recommended): saved in kernl's storage, deleted with the conversation (back after a reload). C: only while the window is open. RECOMMENDATION: A because you reload often. Completeness: A 9/10, C 5/10.
