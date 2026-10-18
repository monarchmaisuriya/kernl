# How agent panels preview the files and web pages a tool touched

- Date: 2026-10-19 09:00
- Status: presented
- Mode: find out
- Repos: kernl   Folders: `src/acp/`, `src/agent/`, `src/webview/`, `src/workspaceRuntime.ts`
- Question / problem: What should kernl show as a preview of the files and web content an agent reads (M's reference: Claude desktop's thumbnail of a read image at the right of "Read kernl.png, ran a command")?

## Research: what do agent panels show as previews of files and web content?

- **Bottom line:** Images are previewed only when they're local or returned by the agent itself (Zed shows them inline, up to 384 px). Files get a file icon and a clickable name. Web content is text: the URL or title next to a globe icon. No open-source agent UI loads favicons or remote thumbnails, and Copilot disabled remote image rendering after a data leak (CamoLeak). The Claude desktop thumbnail is undocumented. Confidence: high for Zed, VS Code, ACP, and the Claude Code adapter (source code); low for the Claude desktop and Cursor rendering (closed, undocumented).
- **Where we are:** feeds the previews plan. About 25 minutes, one research agent plus local checks of the adapter and kernl.
- **Need from M:** accept, and answer the plan's two questions.

### What I found: kernl today

- **Images are dropped:** the ACP runner keeps only text blocks [verified: `src/acp/acpRunner.ts` `textOf`], and kernl's own agent too [verified: `src/agent/session.ts:34,158`]. So a read image and kernl's `browser_screenshot` [verified: `src/browser/tools.ts:47-52`] never reach the panel.
- **The panel only loads its own files and `data:` images** [verified: `src/ui/panel.ts:66` CSP `img-src ${cspSource} data:`; `localResourceRoots` = `out/webview` and `media`, line 37].
- **Saved vs shown:** `this.post` saves an event in the conversation; `this.host.post` only shows it [verified: `src/workspaceRuntime.ts:577-579`]. "Delete conversations" removes the whole `sessions` folder [verified: `src/sessions.ts:117`].

### What I found: what agents send

- **Claude Code, an image read:** an ACP image block, `{ type: "image", data: <base64>, mimeType }`; a URL or file reference becomes the text `[image: …]` [verified: local adapter 0.93.0 `dist/tool-calls/content.js:91-102`, `reporters/read.js:50-58`].
- **Claude Code, a text read:** title "Read <path> (a - b)", `kind: "read"`, `locations` [verified: `reporters/read.js:4-18`].
- **Claude Code, WebFetch:** title "Fetch <url>", `kind: "fetch"`, the question as display text; the result is the answer [verified: `reporters/web.js:3-13`].
- **Claude Code, WebSearch:** title `Search "<query>"`, `kind: "fetch"`; hits as "Title (url)" lines [verified: `reporters/web.js:16-44`].
- **ACP** defines `image` (base64 + mimeType) and `resource_link` (uri, name, title, description) blocks, with no display rules [primary: agentclientprotocol.com/protocol/content, read by the research agent].

### What I found: other panels

- **Zed:** draws a tool's image output inline, at most 384 px, with "Go to File" when the call has a location; web search hits are links (URI plus an arrow icon), no favicon [primary: zed `crates/agent_ui/src/conversation_view/thread_view.rs:11143-11212, 11332-11370`].
- **VS Code / Copilot:** web references show a globe icon and the URL, never a favicon; files show the theme's file icon; fetch rows say "Fetched {url}" or "Fetched N resources" with a collapsible list; remote images in chat Markdown are disallowed [primary: microsoft/vscode `chatReferencesContentPart.ts:411-421`, `fetchPageTool.ts:159-234`, `chatContentMarkdownRenderer.ts:24,114`].
- **Security:** CamoLeak (CVE-2025-59145) used rendered remote images to leak private repository content; GitHub's fix was to stop rendering images in Copilot Chat [primary: legitsecurity.com disclosure]. VS Code's webview guide asks for minimal capabilities and a strict CSP [primary: code.visualstudio.com/api/extension-guides/webview].
- **Claude desktop / Cursor:** collapsed step summaries are documented; thumbnails and favicons are not [primary: code.claude.com/docs/en/desktop; cursor.com/changelog/1-7 says only that Agent can read images].

### Side by side

| Aspect | kernl today | Zed | VS Code / Copilot | Claude desktop (M's screenshot) | Which to follow |
| --- | --- | --- | --- | --- | --- |
| Read image | Dropped | Inline, ≤ 384 px | Named resource | Thumbnail on the collapsed line | Thumbnail on the line, bigger when opened |
| Read text file | Path in the row, link when opened | File icon + path | Theme file icon + name | Name in the summary | File chips (icon + name) on the line |
| Web fetch | "Fetch <url>" text | URL text | Globe + URL, "Fetched …" | Unknown | Globe + site name on the line, link when opened |
| Web search | Raw text lines | Links | Reference list | Unknown | Hits as title + site links |
| Remote images / favicons | None | None | Disallowed | Unknown | None |

### What this means for our code

- `src/acp/acpRunner.ts`, `src/agent/session.ts`: pass image blocks on (a new event), not just text.
- `src/workspaceRuntime.ts` + `src/sessions.ts`: save an image in kernl's storage next to its conversation and show it by a webview link; delete it with the conversation.
- `src/ui/panel.ts`: let the panel load that one storage folder.
- `src/webview/toolRow.ts`, `toolGroup.ts`: thumbnails, file chips, and web chips on the line; full image, links, and hits when opened.

### Confidence and gaps

| Claim | Tag | Source tier | What would raise confidence |
| --- | --- | --- | --- |
| Claude Code sends read images as base64 blocks | verified | primary (adapter source) | A live read of a PNG |
| No open-source agent UI loads favicons | verified for Zed, VS Code | primary (source) | — |
| Claude desktop's thumbnail behavior | unverified | none | Inspecting the desktop app |
| Image sizes Claude Code sends | unverified | — | A live read of a large image |
| OpenCode and Codex image and web blocks | unverified | — | A live run of each |

### Sources

- ACP content and tool calls: https://agentclientprotocol.com/protocol/content, https://agentclientprotocol.com/protocol/tool-calls
- claude-agent-acp: https://github.com/agentclientprotocol/claude-agent-acp (`src/tool-calls/reporters/read.ts`, `web.ts`, `content.ts`)
- Zed: https://github.com/zed-industries/zed (`crates/agent_ui/src/conversation_view/thread_view.rs`, `crates/agent/src/tools/read_file_tool.rs`, `web_search_tool.rs`, `fetch_tool.rs`)
- VS Code: https://github.com/microsoft/vscode (`chatReferencesContentPart.ts`, `fetchPageTool.ts`, `chatToolInvocationPart.ts`, `chatContentMarkdownRenderer.ts`)
- Claude Code desktop: https://code.claude.com/docs/en/desktop
- Claude web search: https://support.claude.com/en/articles/10684626-enabling-and-using-web-search
- Cursor 1.7: https://cursor.com/changelog/1-7
- CamoLeak: https://www.legitsecurity.com/blog/camoleak-critical-github-copilot-vulnerability-leaks-private-source-code
- VS Code webviews: https://code.visualstudio.com/api/extension-guides/webview

## Standardized review

- **Bottom line:** usable. The kernl and adapter facts are from local source; other panels from their source code; the Claude desktop reference is undocumented, which the brief says.
- **Criteria:** question fit pass; method pass (codebase, then primary sources at pinned commits); source quality pass; coverage pass (Zed, VS Code, Claude, Cursor, ACP, security); claim traceability pass; uncertainty pass (gaps table).
- **Findings:**
  1. **Note:** M's reference (Claude desktop) can't be checked from sources; the plan follows its visible behavior (a thumbnail on the collapsed line) plus Zed's open-to-larger pattern.
  2. **Must-verify:** OpenCode and Codex image and web output; the plan falls back to today's text when a block isn't there.
