# Thread mentions and a one-line panel header

- Date: 2026-10-20 01:29
- Status: presented
- Mode: explore options
- Repos: kernl   Folders: `src/`, `src/webview/`, `package.json`
- Question / problem: how can kernl's panel header sit on one line, and how can a message tag other conversations (any agent, any model provider)?

## Options: put the header on one line, and let a message tag another conversation as context for any agent

- **Bottom line:**
  - **Header:** VS Code draws the icon row, not kernl. With `workbench.activityBar.location: top`, VS Code puts the side bar's icons on their own row and hides that row only with `workbench.activityBar.autoHide` on and one view container in the bar. Recommended: turn on `autoHide` (a user setting; kernl changes it only with your OK).
  - **Thread tags:** extend the existing "+ → Conversations..." attachment into `@` mentions. The `@` popover lists threads from every workspace and agent next to files. A tagged thread is a reference that kernl turns into a plain-text excerpt when the message is sent: the goal, then the newest turns, within a size limit. Plain text works with every agent and provider.
- **Where we are:** framing done; VS Code 1.142 source and kernl's code read; 4 external sources checked. Next step is the plan.
- **Need from M:** pick the options (D1 to D3 in the plan).

### The problem, framed

- **What:**
  - **Header:** the panel shows the kernl icon on one row and "Kernl: Agent" with its buttons on another.
  - **Thread tags:** a message can't easily carry another conversation; today only the + menu attaches one, and only from the same workspace.
- **Why:** less wasted space at the top of the panel; reuse what another conversation (maybe another agent's) worked out, without copying it by hand.
- **Who:** M, using several agents and workspaces side by side.
- **Whom:** the agent receiving the message, which needs the other thread's content in a form it can read.
- **When:** every message that builds on earlier work.
- **Where:**
  - **Header:** VS Code's secondary side bar header.
  - **Thread tags:** the composer (`src/webview/attachments.ts`), the session store (`src/sessions.ts`), and the message text every agent gets (`attachmentNote`, `src/ui/protocol.ts:77`).
- **Which:** VS Code's layout settings; kernl's `@` popover and text attachments.
- **How:** type `@`, see threads with files, pick one, and it shows as a chip. On send, the agent gets the thread's content as marked, untrusted text.
- **How much:** the header needs no code, or one command. Thread tags touch about 6 files, are additive, and don't change the protocol for agents.

### What must be true

- **Hard constraint:** kernl can't draw in VS Code's view header. Extensions contribute only the view title and title-bar actions. [verified: `package.json` `contributes.views`, `menus.view/title`]
- **Hard constraint:** kernl doesn't change a user setting without M's consent (CLAUDE.md, core rule 5).
- **Hard constraint:** every agent (kernl's own on any provider, Claude Code, Codex, OpenCode) must be able to read a tagged thread.
  - Text is the only form all of them take: kernl's agent gets `userText + attachmentNote(...)` [verified: `src/agent/session.ts:131`].
  - CLI agents get a text block too [verified: `src/acp/acpRunner.ts:203`].
- **Convention:** files and folders are `@` mentions inside the text; conversations, issues, and pull requests are chips [verified: `src/webview/attachments.ts:1-3`].
- **Fact:** a conversation's content is kept as kernl's own transcript events, the same shape whatever the agent or provider [verified: `SessionRecord.events`, `src/sessions.ts:14-29`]. So a thread from Claude Code can be read by kernl's DeepSeek agent and the reverse.
- **Fact:** today's conversation text is cut from the end: `attachmentNote` keeps the first 20,000 characters [verified: `src/ui/protocol.ts:84`]. A long thread therefore loses its latest decisions.
- **Fact:** conversations are stored per workspace folder, by a hash of the folder's path [verified: `src/workspaceRuntime.ts:569-571`]. The + menu lists only the shown workspace's [verified: `src/controller.ts` `pickSessionAttachment`].
- **Fact:** the text attachment carries the whole transcript into the panel and the saved draft [verified: `addAttachments` with `text`, `src/controller.ts:1006`].
- **Open check:** whether the secondary side bar counts exactly one visible view container in M's window (needed for `autoHide` to hide the row). [unverified: check by turning the setting on in M's window and looking]

### How VS Code draws the header

```
workbench.activityBar.location
   "default"  ─> auxiliary bar icons go in the title row (one line)      <-- one line, but moves every icon bar in VS Code
   "top"      ─> icons get their own row above the title (two lines)     <-- M's setting today
                   └─ hidden when activityBar.autoHide is on AND the bar has ≤ 1 visible view container   <-- one line
```

- **Source:** VS Code 1.142's auxiliary bar part:
  - `getCompositeBarPosition()` returns `0` (top) for `"top"` and `1` (title) for `"default"`;
  - `shouldShowCompositeBar()` returns false when the position is top or bottom, `autoHide` is on, and `visibleCount<=1`.

  [verified: `Visual Studio Code.app/.../workbench.desktop.main.js`, read 2026-10-20]
- **Primary side bar:** `autoHide` hides an icon bar only when it has one or fewer visible containers, so the primary side bar (Explorer, Search, and others) keeps its icons. [inferred: same check, applied per part]
- **M's settings:** `"workbench.activityBar.location": "top"` and `"workbench.activityBar.compact": true` [verified: `~/Library/Application Support/Code/User/settings.json:2,15`].

### How others tag past threads

| Product | How | Content sent | Evidence |
| --- | --- | --- | --- |
| Zed (Agent Panel) | `@` in the message editor lists previous threads among files, directories, symbols, and rules; "New From Summary" starts a thread from a summary | not stated in its docs | [Zed agent panel docs](https://zed.dev/docs/ai/agent-panel) [verified: fetched 2026-10-20] |
| Cursor | `@Past Chats` included "summarized versions" of previous chats | summary | [docs (now redirected)](https://docs.cursor.com/context/@-symbols/@-past-chats); forum reports say it was removed or unreliable in 2.x ([1](https://forum.cursor.com/t/bring-back-reference-past-chats/140780), [2](https://forum.cursor.com/t/cursor-context-menu-past-chats-always-shows-no-available-options/150344)) [verified: search results; docs page redirects] |
| Windsurf / Cascade | `@` activates rules; memories are retrieved automatically | n/a | [Cascade memories](https://docs.devin.ai/desktop/cascade/memories) [verified: no thread mention found] |
| kernl today | + → Conversations... (same workspace) attaches a text chip | whole transcript, first 20,000 characters | `src/controller.ts` `pickSessionAttachment` [verified] |

- **What this means:** `@`-mentioning a thread next to files is the established pattern (Zed). Sending a condensed form rather than the raw whole thread is common (Cursor's summaries, Zed's "New From Summary"). No source gives a cross-agent standard: the shared form has to be text.

### Options

**Header**

| | H1: turn on `autoHide` (recommended) | H2: activity bar back to the side | H3: leave it |
| --- | --- | --- | --- |
| How | `workbench.activityBar.autoHide: true` (user setting) | `workbench.activityBar.location: default` | nothing |
| Effect | the kernl icon row disappears; "Kernl: Agent" and the buttons stay on one line | the icon moves into the title row; every icon bar moves to the side | two rows |
| Cost | one setting; kernl can offer it as a command that asks first | changes M's whole layout | none |
| Fails when | a second container is added to the secondary side bar (the row comes back, which is useful then) | M wants icons on top | n/a |
| Completeness | 9/10 | 6/10 | 3/10 |

**What a tagged thread sends (any agent, any provider)**

| | T1: excerpt (recommended) | T2: excerpt plus a `read_thread` tool | T3: model summary |
| --- | --- | --- | --- |
| How | plain text: title, agent, workspace, the first request, then the newest turns that fit (20,000 characters), marking what was left out | T1, plus a kernl tool (and kernl MCP tool for CLI agents) that reads more of a tagged thread on request | the current kernl model writes a summary at send time |
| Works with | every agent and provider (text) | every agent that calls tools (all four do) | needs kernl's model and key, even when the receiving agent is Claude Code |
| Cost and blast radius | small: replaces `transcriptText`, no new protocol | adds a tool to two tool lists and the MCP server | an extra model call per tag, with latency and cost |
| Fails when | a thread's key detail sits in the cut middle | tool overhead; still an excerpt first | no kernl provider configured; summaries drop detail |
| Evidence | today's text cut keeps the oldest part (`protocol.ts:84`), so an excerpt is a direct fix | Zed and Cursor give no detail on on-demand reading | Cursor's summaries |
| Completeness | 8/10 | 9/10 | 6/10 |

**Which threads can be tagged**

| | S1: every conversation kernl kept, in all of the window's workspaces (recommended) | S2: S1 plus the agents' own sessions never opened in kernl |
| --- | --- | --- |
| How | list the session store for each open workspace (folder and worktrees), newest first, with the agent's name | also ask each CLI agent for its sessions, and load one through the agent when tagged |
| Cost | reads local files only | starts the agent to replay a session (seconds; may need a login) |
| Completeness | 8/10 | 9/10, but slow and fragile |

### Flow of the recommended option

```
type "@lo" ─> panel asks host ─> files matching "lo"  +  threads matching "lo" (all workspaces)   <-- new
pick a thread ─> chip "Thread: Fix login (Claude Code, Develop)" (a reference, no text)            <-- changed
Send ─> host loads the thread ─> excerpt (goal + newest turns, ≤ 20,000 chars) ─> attachmentNote ─> any agent   <-- changed
```

### Recommendation

RECOMMENDATION: H1 + T1 + S1, because together they put the header on one line without moving M's layout, and they tag any stored conversation for any agent through the one form every agent reads (text). They also fix today's cut, which drops a thread's newest part. T2 (`read_thread`) can come later if excerpts prove too short.

### Sources

- [Zed: Agent Panel](https://zed.dev/docs/ai/agent-panel)
- [Cursor docs: @Past Chats](https://docs.cursor.com/context/@-symbols/@-past-chats)
- [Cursor forum: Bring back @-reference Past Chats](https://forum.cursor.com/t/bring-back-reference-past-chats/140780)
- [Cursor forum: Past Chats always shows "No available options"](https://forum.cursor.com/t/cursor-context-menu-past-chats-always-shows-no-available-options/150344)
- [Windsurf Cascade: Memories](https://docs.devin.ai/desktop/cascade/memories)
- VS Code 1.142 workbench source (`workbench.desktop.main.js`, auxiliary bar part), read locally

## Standardized review

- **Bottom line:** present as is (0 blocking, 1 must-verify, 1 note).
- **Criteria:**
  - **Question and decision fit:** pass. Both questions are stated, along with the decisions they feed (D1 to D3).
  - **Method:** pass. Source read locally; kernl code read; 4 external sources.
  - **Source quality:** pass. VS Code's own code anchors the header claim; Zed's docs are primary; Cursor's evidence is conflicting and graded as such.
  - **Coverage and alternatives:** pass. Status quo included for the header; three content forms; two scopes.
  - **Claim traceability:** pass. Each claim is tagged with file:line or a link.
  - **Evidence handling:** pass. Cursor's status is shown as conflicted; Zed's content form as not stated.
  - **Analysis quality:** pass. The same drivers are applied to each option.
  - **Codebase fit:** pass. It reuses the text attachment, the session store, and `attachmentNote`.
  - **Uncertainty and limits:** violation (finding 1).
  - **Recommendation proportionality:** pass.
  - **Reproducibility:** pass. Files and lines are named.
- **Findings:**
  1. **must-verify:** H1 depends on M's secondary side bar having one visible view container. Check by turning `autoHide` on in M's window (with OK) and looking.
  2. **note:** how Zed fills a thread mention (full or summary) is unknown; it doesn't change the recommendation, since kernl must send text either way.
