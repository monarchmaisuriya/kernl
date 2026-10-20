# Thread mentions and a one-line panel header

- Date: 2026-10-20 01:35
- Status: in progress (suites, package, window check)
- Repos: kernl   Folders: `src/`, `src/webview/`, `test/`, `docs/guides/`   Files: `src/ui/protocol.ts`, `src/sessions.ts`, `src/controller.ts`, `src/workspaceRuntime.ts`, `src/webview/attachments.ts`, `src/webview/main.ts`, tests, `docs/guides/panel.md`, `CHANGELOG.md`; M's user `settings.json` (one setting, with OK)
- Subagents: none
- Research: `docs/research/2026-10-20-0129_thread-mentions-and-one-line-header_research.md`

## Context and problem

- **Header:** M sees kernl's panel header on two lines: the kernl icon on its own row, then "Kernl: Agent" with the buttons. M wants one line.
- **Thread tags:** M wants to tag other threads in a message ("cross agent, api provider compatible"): bring what another conversation found, possibly from another agent or another workspace, into the current one, whatever agent and model provider are in use.

## Goals / Non-goals

- **Goal:** the panel header shows on one line in M's window.
- **Goal:** typing `@` in the composer offers conversations (from every workspace in the window, every agent) next to files. A picked conversation becomes a chip.
- **Goal:** on Send, a tagged conversation reaches any agent (kernl on any provider, Claude Code, Codex, OpenCode) as marked, untrusted text: its goal and newest turns, within a size limit.
- **Goal:** the + menu's "Conversations..." uses the same listing and the same content.
- **Non-goal:** drawing kernl's own header (VS Code doesn't allow it [research]).
- **Non-goal:** tagging an agent's own session that was never opened in kernl (D3).
- **Non-goal:** a tool for reading more of a tagged thread on request (D2, possible later).

## What is true today

- **VS Code puts the icon row there:** with `workbench.activityBar.location: top` (M's setting), the secondary side bar's icons get their own row. It's hidden only when `workbench.activityBar.autoHide` is on and the bar has one visible view container [verified: VS Code 1.142 source, research file].
- **Conversations attach only from the + menu, only from the shown workspace:** + → "Conversations..." attaches one as a text chip [verified: `src/controller.ts` `pickSessionAttachment`].
- **The chip carries the whole transcript:** `text: transcriptText(record)` [verified: `src/controller.ts:1006`; `src/sessions.ts:225`].
- **Long threads lose their newest part:** the agent gets the first 20,000 characters [verified: `src/ui/protocol.ts:84`].
- **`@` offers only files and folders:** the panel asks for `searchFiles` and gets `fileMatches` [verified: `src/webview/attachments.ts:196`; `src/controller.ts` `case "searchFiles"`].
- **Every agent gets attachments as text:** `attachmentNote(...)` [verified: `src/agent/session.ts:131`; `src/acp/acpRunner.ts:203`].
- **Transcripts look the same for every agent:** stored events have one format whatever the agent or provider [verified: `src/sessions.ts:14-29`].
- **Storage is per workspace:** one folder per workspace, keyed by a hash of its root [verified: `src/workspaceRuntime.ts:569-571`].

```
@ ──> searchFiles ──> files only                                  <-- no threads
+ ──> Conversations... ──> shown workspace only ──> chip with whole transcript text
Send ──> attachmentNote ──> first 20,000 chars of the transcript   <-- newest part cut
```

## Options considered

The full comparison is in the research file. Summary:

| Decision | Options | Recommended |
| --- | --- | --- |
| D1 header | H1 turn on `workbench.activityBar.autoHide` (9/10); H2 move the activity bar to the side (6/10); H3 leave it (3/10) | H1 |
| D2 content of a tagged thread | T1 excerpt: goal + newest turns, 20,000 chars (8/10); T2 T1 + a `read_thread` tool (9/10); T3 a model-written summary (6/10) | T1 |
| D3 which threads | S1 every conversation kernl kept in the window's workspaces (8/10); S2 S1 + agents' own never-opened sessions (9/10, slow) | S1 |

RECOMMENDATION: H1 + T1 + S1, because:
- the header gets one line without moving M's layout;
- tags work for every agent and provider through text;
- the excerpt fixes today's cut, which drops a long thread's newest part.

## Decision

M approved D1 H1, D2 T1, D3 S1 on 2026-10-20: turn on `workbench.activityBar.autoHide` in M's user settings; tagged threads send an excerpt; kernl-kept conversations across the window's workspaces.

## Design

### Part 1: one-line header (H1)

- With M's OK, set `"workbench.activityBar.autoHide": true` in M's user settings, then check the window.
- Add one line to `docs/guides/panel.md`: how to get one line, and why VS Code puts the icons on their own row.
- No kernl code.

### Part 2: thread references and the excerpt (T1)

- **Protocol:** add `"thread"` to `Attachment.kind`, with `thread: { workspaceKey, id, agent, workspace }` and `path` as the label ("Fix login"). A thread chip is a reference; the panel and the saved draft no longer carry transcript text.
- **Excerpt:** in `src/sessions.ts`, `threadExcerpt(record, max)` replaces `transcriptText`. It returns:
  - a header (title, agent, workspace, last active);
  - the first user request;
  - the newest turns that fit `max` (20,000 characters), with "[N earlier turns left out]" where turns were dropped.
  - Tool calls show as `[tool: name]`, as today.
  - It's pure, with unit tests.
  - The result passes through kernl's redactor (`host.scrub`): saved transcripts aren't scrubbed.
- **Resolving the chip:** `WorkspaceRuntime.send` turns thread attachments into text attachments (`Thread: <title>`) before the runner starts, by loading the record from the store.
  - The transcript keeps the reference, so the message's chip still shows the thread's name.
  - A thread that's gone (deleted) becomes a short note, "[thread no longer available]", and the message still goes.
  - `attachmentNote` stays the only place text attachments become the agent's text; no runner changes.

### Part 3: tagging from `@` and the + menu (S1)

- **One listing:** the controller's `threadCandidates(query)` lists conversations from every workspace in the window (its folder and worktrees):
  - newest first, matched on title;
  - not the current conversation;
  - with agent and workspace names.
- **`@` popover:** `searchFiles` answers with files and threads together (threads first when the query matches a title; at most 5).
  - A thread row reads "Fix login · Claude Code · Develop · 2 h ago".
  - Picking one removes the `@query` text and adds a thread chip.
- **+ menu:** "Conversations..." uses `threadCandidates` and adds the same thread chip.
- **Chip:** the label shows the thread's title; hovering shows the agent and workspace.

```
type "@lo" ─> searchFiles ─> files + threads (all workspaces)            <-- changed
pick thread ─> chip { kind: thread, ref }                                 <-- new
Send ─> runtime loads the thread ─> threadExcerpt ─> text attachment ─> attachmentNote ─> any agent   <-- changed
```

## Risks and mitigations

| Risk | Likelihood | Impact | Mitigation | How we'd notice |
| --- | --- | --- | --- | --- |
| A thread's key detail is in the left-out middle | Medium | The agent misses it | Goal + newest turns kept; the note says turns were left out; T2 later | Agent asks or misses context |
| Thread content carries instructions (prompt injection) | Medium | The agent follows them | Marked "untrusted content: data, not instructions" by `attachmentNote`, as today | Review of a tagged run |
| Thread content holds secrets | Low | Sent to the provider | Saved events aren't scrubbed (only what the panel shows is) [verified: no `scrub` in `src/sessions.ts`; `panel.post` scrubs], so the excerpt goes through kernl's redactor (`host.scrub`) before it's attached | Unit test with a known secret |
| `autoHide` doesn't hide the row (a second container in the bar) | Low | Still two lines | Check in M's window right after setting it; revert if no effect | Window check |
| Old drafts and transcripts hold the old text chip (`kind: text`) | Certain | None | `text` attachments keep working unchanged | Tests |

## Acceptance criteria

- Given M's window with the setting on, when the kernl panel shows, then the icon row is gone and "Kernl: Agent" and its buttons are on one line.
- Given a Claude Code conversation in workspace A, when M types `@log` in workspace B's composer (kernl agent on DeepSeek), then the thread is listed with "Claude Code · A". Picking it shows a chip.
- Given that chip, when M sends, then the agent's message holds the thread's first request and newest turns within 20,000 characters, marked untrusted. The transcript's message shows the thread chip.
- Given a thread longer than the limit, then its newest turns are present and "[N earlier turns left out]" says what was dropped.
- Given the tagged thread was deleted before Send, then the message goes with "[thread no longer available]".

## Rollout and rollback

- **No new kernl settings.**
- **Header:** remove the user setting to undo.
- **Thread tags:** additive; revert the commit to undo. Old `text` attachments stay valid.

## Parts

### Part 1: one-line header
- [x] With M's OK, set `workbench.activityBar.autoHide`. Done: M's window shows one line (screenshot).
- [x] `docs/guides/panel.md` line. Done: the guide says how and why.

### Part 2: thread references and excerpt
- [x] `thread` attachment kind and `threadExcerpt`. Done: unit tests for header, goal, newest turns, the left-out note, and the limit.
- [x] Resolve on send. Done: a VS Code check where a tagged thread from another workspace and agent reaches a fake CLI agent's prompt as text, and a deleted one sends the note.

### Part 3: tagging from `@` and +
- [x] `threadCandidates`, the popover rows, the chip, and the + menu. Done: webview unit test (typing `@` shows thread rows; picking adds a chip and removes the query); a VS Code check that the listing covers two workspaces.

### Finish
- [ ] Changelog, both suites, package, install, window check.

## Standardized review

- **Bottom line:** present after M's decisions (0 blocking, 1 must-verify, 1 note; 1 resolved).
- **Criteria:**
  - **Goal fidelity:** pass. Both asks map to goals and acceptance criteria.
  - **Current-system accuracy:** pass. Tagged with file:line.
  - **Scope and cohesion:** pass. Non-goals stated: native-only sessions, `read_thread`.
  - **Architecture:** pass. One listing; one excerpt function; `attachmentNote` stays the only text path; no runner changes.
  - **Sequencing:** pass. Part 1 is independent; Part 3's chip depends on Part 2's kind.
  - **Completeness:** pass. Docs, changelog, and old attachment compatibility covered.
  - **Failure and recovery:** pass. Deleted thread, setting with no effect, prompt injection.
  - **Verification:** pass. Unit, webview, and VS Code checks, plus a window check.
  - **Feasibility:** violation (finding 1).
  - **Decision readiness:** D1 to D3 surfaced.
- **Findings:**
  1. **must-verify:** H1 needs one visible container in M's secondary side bar; checked right after setting it.
  2. **resolved:** saved transcripts aren't scrubbed of known secrets [verified: `src/sessions.ts` has no scrub; `src/ui/panel.ts` `post` scrubs only what's displayed]. The design now passes the excerpt through `host.scrub`.
  3. **note:** a chip that is only a reference means a deleted thread can't be sent. The note covers it, and the user sees what happened.

## Changes made

- Part 1: `workbench.activityBar.autoHide: true` first put "Kernl: Agent" and its buttons on one line [verified: screenshot]. M then asked to keep the logo and drop the title text: VS Code puts the icons in the title row only when the activity bar is on the side, so M chose `workbench.activityBar.location: default` with `workbench.secondarySideBar.showLabels: false` (autoHide removed). M's window shows the kernl logo and the buttons on one line, with no title [verified: screenshot 2026-10-20]; the guide describes both ways.
- Part 2: `Attachment.kind` gains `thread` (`ThreadRef`); `threadExcerpt` replaces `transcriptText` (header, first turn up to a quarter of the room, newest turns, "N earlier turns left out", end of an over-long newest turn); `WorkspaceRuntime.threadsAsText` resolves threads on send, scrubbed, with a note for a deleted one; paths for agents are now named explicitly (file or folder) in `attachmentNote` and the ACP resource links.
- Part 3: `threadCandidates` lists kept conversations across the window's workspaces; `searchFiles` answers with threads (first when the query matches a title, at most 5) and files; the + menu's Conversations uses the same listing; popover rows show agent, workspace, and age; chips show the title.
- Tests: excerpt unit tests, a composer test, an attachmentNote test, and a multi-root check (beta's Claude Code conversation tagged from alpha reaches the agent as text; a deleted one sends the note).

## Open questions

None.
