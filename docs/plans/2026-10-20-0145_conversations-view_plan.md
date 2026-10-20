# Conversations as a full-panel view, without the wait

- Date: 2026-10-20 01:45
- Status: done (window check pending)
- Repos: kernl   Folders: `src/`, `src/webview/`, `media/`, `test/`   Files: `src/controller.ts`, `src/ui/protocol.ts`, new `src/ui/conversationRows.ts`, new `src/webview/conversations.ts`, `src/webview/main.ts`, `src/webview/connections.ts` (shared view classes), `media/panel.css`, `test/fixtures/fakeAcpAgent.ts`, tests, `docs/guides/panel.md`, `CHANGELOG.md`
- Subagents: none

## Context and problem

- **The lag:** clicking the clock (past conversations) takes a noticeable time before anything shows.
- **The popup:** the list opens as a small popup menu. M wants it to replace the whole conversation area, with a button to go back.

## Goals / Non-goals

- **Goal:** the clock opens a full-panel Conversations view at once, listing kernl's kept conversations immediately.
- **Goal:** each CLI agent's own sessions join the list as that agent answers, without holding the rest up. While one is still being asked, a quiet "Looking for Claude Code sessions…" row says so.
- **Goal:** the view has a Back button (and Escape) that returns to the conversation unchanged; picking a row opens it, as today.
- **Goal:** a search box filters by title; "New conversation" stays at the top.
- **Non-goal:** deleting or renaming conversations from the view (not asked).
- **Non-goal:** changing how a conversation is opened or continued (same code as today).

## What is true today (diagnosis)

```
click clock ─> saveSession ─> list kernl's conversations (11 files, 1.2 MB: fast)
                           └─> for each ready CLI agent: cached list < 5 min old?
                                  no ─> start a new agent process, ask session/list, wait (up to 10 s)   <-- the wait
           ─> Promise.all: nothing shows until the slowest agent answers                                <-- blocks the list
           ─> popup menu with every row                                                                  <-- not a full view
```

- **The list waits for every agent:**
  - `showSessions` awaits `Promise.all([sessions.list(...), this.agentSessions(ws)])` before showing anything [verified: `src/controller.ts` `showSessions`].
  - `agentSessions` awaits each ready agent [verified: `src/controller.ts` `agentSessions`].
- **A cold list starts an agent process:** on a cache miss, `listAgentSessions` starts a new ACP runner (a new agent process) and asks `session/list`, with a 10 s timeout [verified: `src/workspaceRuntime.ts` `listAgentSessions`, `LIST_TIMEOUT_MS = 10_000`].
- **The cache:** 5 minutes (`AGENT_SESSIONS_TTL_MS`) [verified: `src/controller.ts:75`]. So the first click after a reload, and any click more than 5 minutes after the last one, waits for the slowest agent's start [inferred: from the cache rule and `Promise.all`].
- **kernl's own list is not the wait:** 11 conversations, 1.2 MB in M's store [verified: `du` of `globalStorage/local.kernl/sessions/65eb2704e5ea9a34`].
- **Not measured:**
  - how long each agent takes to start and list in M's window [unverified: kernl doesn't log it; this plan adds a log line with each agent's time];
  - the in-panel menu's own render time [unverified: the same log line separates the two].
- **The popup:** the list opens through `this.prompts.pick` (the in-panel menu) [verified: `src/controller.ts` `showSessions`].
- **A pattern to follow:** a full-panel view already exists, Connections, with a header, a close button, Escape, and `position: fixed; inset: 0` [verified: `src/webview/connections.ts:46-130`, `media/panel.css:414-418`].

**Diagnosis card**

- **Symptom:** a delay between clicking the clock and the list appearing.
- **Generator:** the list is built only after every CLI agent's session list is fetched, and a cold fetch starts that agent.
- **Owning layer:** the controller's Conversations flow (`showSessions`), which decides when the list is shown.
- **Structural fix:** show the list from kernl's own store at once and add each agent's sessions as it answers.
  - Agents' lists already fetched are shown at once, even if older than 5 minutes, and refreshed in the background.
  - Recurrence test: reverting it makes the list wait for agents again.
- **Not a fix:** a longer cache, a shorter timeout, or a spinner on the old popup. Each hides the wait instead of removing the dependency.

## Options considered

| | A: full-panel view, streamed rows (recommended) | B: keep the popup, stream rows into it | C: full-panel view, wait as today |
| --- | --- | --- | --- |
| How | the clock shows a Conversations view over the transcript; rows from kernl's store at once; agent rows added as each answers; Back returns | the in-panel menu stays; rows are added to it as they arrive | the new view, but filled only when every agent has answered |
| Meets M's ask | yes (replaces the panel, back button, no wait) | no (still a popup) | half (still waits) |
| Cost | a new view module (following Connections), 3 protocol messages, a pure row builder | menu changes to accept updates | the new view only |
| Completeness | 9/10 | 5/10 | 6/10 |

RECOMMENDATION: A, because it is what M asked for and removes the wait at its source rather than hiding it.

## Decision

M approved option A on 2026-10-20.

## Design

```
click clock ─> host: rows from kernl's store + cached agent rows (any age) ─> panel shows the Conversations view   <-- changed: at once
           ─> for each ready agent with no fresh list: ask in the background (timed, logged)
                 each answer ─> host posts the updated rows ─> view updates in place                              <-- new
pick a row ─> host opens it (same code as today) ─> view closes        Back / Escape ─> view closes               <-- new
```

- **Rows:** a pure function `conversationRows(...)` in `src/ui/conversationRows.ts`.
  - It builds the rows from kernl's sessions, the agents' sessions, the current conversation, agent labels, and now.
  - Kernl's conversations come newest first, with "N messages · agent · 2 h ago" and the current one marked.
  - Then a group per agent ("Claude Code sessions not opened in kernl"), sessions already linked to a kernl conversation are left out (as today), and a pending row for each agent still being asked.
  - Unit tested.
- **Protocol:**
  - host to panel: `{ type: "conversations"; workspace; title; rows; open? }`;
  - panel to host: `{ type: "openConversation"; workspace; row }` (kernl id, agent session, or new conversation).
- **Host (`showSessions`):**
  - saves the current conversation;
  - posts rows from the store with the cached agent lists, `open: true`;
  - then starts each agent's list that's missing or older than 5 minutes, in parallel. Each answer updates the cache, posts new rows, and logs "Claude Code listed N sessions in 1.8 s". An agent that fails or times out drops its pending row.
  - Opening a row uses today's code, moved into one function.
  - A running workspace keeps today's rule (no list while it runs).
- **Panel (`src/webview/conversations.ts`):** a full-panel section like Connections.
  - Header: a Back button (left arrow, "Back to the conversation"), the title "Conversations in Develop", and the search box below.
  - Rows are buttons (keyboard reachable). Picking one sends `openConversation` and closes the view. Back and Escape close it.
  - Updates while open keep the search text and scroll.
  - Switching workspace or starting a new chat closes it.
  - Built with createElement and textContent only (webview safety test).
- **Shared look:** the full-view classes become `.panel-view`, `.panel-view-header`, `.panel-view-body`, used by Connections and Conversations alike (CSS rename only).
- **Command Palette:** "kernl: Conversations" reveals the panel and opens the view (the popup fallback goes away for this command).

## Risks and mitigations

| Risk | Likelihood | Impact | Mitigation | How we'd notice |
| --- | --- | --- | --- | --- |
| A row's position moves as agent rows arrive while M aims at it | Medium | A misclick | kernl's conversations come first and never move; agent groups are added below | Use in window |
| A stale cached agent list shows a session the agent has since deleted | Low | Opening it fails | Today's open path reports the agent's error; the refresh replaces the row | Error notice |
| Many agents start at once on every click | Low | CPU | Only missing or older-than-5-minutes lists are asked; the same as today, but not waited on | Log lines |
| Existing VS Code checks use the popup | Certain | Checks fail | Update them to the new messages in this change | Suites |

## Acceptance criteria

- Given a reloaded window, when M clicks the clock, then the Conversations view replaces the panel at once with kernl's conversations, and "Looking for Claude Code sessions…" shows until Claude Code answers. Then its sessions appear below.
- Given the view, when M presses Back or Escape, then the conversation shows exactly as before.
- Given the view, when M clicks a conversation, then it opens (as today) and the view closes.
- Given an agent that never answers, then its pending row disappears after 10 s and the rest of the list stays usable throughout.
- Given text in the search box, then only matching titles show, and updates keep the filter.

## Rollout and rollback

- No settings. Revert the commit to undo.

## Parts

### Part 1: rows and streaming in the host
- [x] `conversationRows` with unit tests; `showSessions` posts at once and streams agent lists, with timing logs; one open path. Done: unit tests. A VS Code check with a slow fake agent shows the first rows arrive before the agent answers, then an update with its sessions.

### Part 2: the Conversations view
- [x] `src/webview/conversations.ts`, the protocol messages, shared view classes, and Back/Escape/search. Done: webview unit tests (renders, filters, picks, Back, updates keep the filter); the existing conversation checks updated to the view.

### Finish
- [ ] Guide, changelog, both suites, package, install, window check (open and close the view; no message sent).

## Standardized review

- **Bottom line:** present as is after M's sign-off (0 blocking, 1 must-verify, 1 note).
- **Criteria:**
  - **Goal fidelity:** pass. Both asks (the lag, the full view with Back) map to goals and acceptance criteria.
  - **Current-system accuracy:** pass. Code paths tagged; store size measured.
  - **Scope:** pass. No delete or rename.
  - **Architecture:** pass. The fix is in the controller's flow, which owns when the list shows; rows are a pure function; the view follows Connections; shared CSS classes instead of a copy.
  - **Sequencing:** pass. Part 2 depends on Part 1's messages.
  - **Completeness:** pass. Docs, changelog, existing checks.
  - **Failure and recovery:** pass. Agent timeout, failure, stale rows, a running workspace.
  - **Verification:** pass. Unit, webview, VS Code checks with a slow fake agent, and a window check.
  - **Feasibility:** violation (finding 1).
  - **Decision readiness:** pass. One option to approve.
- **Findings:**
  1. **must-verify:** the agents' start time in M's window is inferred, not measured. The new log line measures it after the change; the fix doesn't depend on the number.
  2. **note:** the Command Palette path no longer has a popup fallback when the panel is hidden; it reveals the panel instead, which matches how the clock behaves.

## Changes made

- Part 1: `src/ui/conversationRows.ts` (pure, unit tested); `showSessions` reveals the panel, posts kernl's conversations with cached agent lists at once, then asks each missing or stale agent in the background, logging "<agent> listed N session(s) in X s" and posting updated rows; `openConversation` is the one open path; the old `agentSessions` and the popup are gone.
- Part 2: `src/webview/conversations.ts` (Back, Escape, search, groups, pending rows, current mark); `conversations` and `openConversation` messages; Connections and Conversations share `.panel-view*` classes.
- Tests: rows unit tests, two webview tests, the three conversation checks moved to the view, and a check with an agent that takes 4 s (the view shows in under 2 s, its sessions fill in after).
- Mid-build request from M: Send became a plain icon button like `+`, with its menu opening on hover (500 ms) or Arrow Up, and the arrow in the accent color when there's text (decided by M in two questions).

## Open questions

None.
