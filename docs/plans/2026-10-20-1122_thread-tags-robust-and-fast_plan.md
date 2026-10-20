# Thread tags: whole threads on demand, agents' own sessions, and a fast search

- Date: 2026-10-20 11:22
- Status: done (window check pending)
- Repos: kernl   Folders: `src/`, `src/webview/`, `test/`   Files: `src/sessions.ts`, `src/ui/protocol.ts`, `src/workspaceRuntime.ts`, `src/controller.ts`, new `src/threadTools.ts`, `src/webview/attachments.ts`, `test/fixtures/fakeAcpAgent.ts`, tests, `docs/guides/panel.md`, `CHANGELOG.md`
- Subagents: none
- Sign-off: M asked to "research plan implement" (2026-10-20); decisions below follow the research and are reported at the end.

## Context and problem

M asked to make thread tags more robust and faster. Four limits are left from 0.5.0:
1. A long thread is cut to its first request and newest turns.
2. There's no tool to read more of a tagged thread.
3. An agent's own session that was never opened in kernl can't be tagged.
4. The `@` search reads every stored conversation on each keystroke.

## Research

- **Progressive disclosure:** tools that give coding agents memory of past chats show a compact view first and let the agent fetch detail on demand:
  - memsearch's Claude Code plugin has three layers: Search, Expand, Transcript ([memsearch](https://docsearch.algolia.com/mcp/docs/repo/zilliztech/memsearch));
  - AgentKits Memory exposes search, timeline, and details tools ([AgentKits Memory](https://mcp.directory/servers/agentkits-memory));
  - Engram stores conversations verbatim and gives the agent a search tool ([Engram](https://computer-agents.com/blog/infinite-memory-never-forget)).

  [verified: search results 2026-10-20; these are project pages, not independent evaluations]
- **Zed and Cursor:**
  - Zed lists previous threads in `@` and offers "New From Summary" ([Zed agent panel](https://zed.dev/docs/ai/agent-panel)). Its docs don't say whether a mentioned thread is sent in full.
  - Cursor's `@Past Chats` sent summaries.
- **kernl today:**
  - `threadExcerpt` keeps the header, the first turn, and the newest turns within 20,000 characters [verified: `src/sessions.ts`].
  - Tags come only from kernl's store [verified: `threadCandidates`].
  - `SessionStore.list` parses every file [verified: `src/sessions.ts` `list`].
  - An agent's own session is read through ACP `session/load` (its replay) [verified: `AcpRunner.loadNow`, `WorkspaceRuntime.loadAgentSession`].

## Goals / Non-goals

- **Goal (outline):** a tagged thread's text starts with an outline of every turn (its number and the request's first line), so the agent sees the whole thread's shape even when the middle is left out.
- **Goal (`read_thread`):** a tool for kernl's agent and the CLI agents. It reads chosen turns of a thread tagged in this conversation, or the turns that mention a word, up to 30,000 characters.
  - It doesn't ask, like reading a file; the text is scrubbed and marked untrusted.
  - Only threads tagged in the conversation's own messages can be read.
- **Goal (agents' sessions):** `@` also lists the CLI agents' own sessions for the window's folders (from the lists Conversations fetches; opening `@` refreshes them in the background).
  - A tagged one is read through the agent when the message is sent, with a timeout and a note if it fails.
  - It's kept for `read_thread` while the conversation is open.
- **Goal (search speed):** listing conversations reads only files that changed since the last listing. It's checked by size and modification time, so another VS Code window's changes are seen.
- **Non-goal:** semantic (embedding) search; the title match and `read_thread`'s word search cover the need without a model call.

## Options considered

| | A: outline + `read_thread` (recommended) | B: summary by the model | C: send the whole thread |
| --- | --- | --- | --- |
| How | the excerpt gains a turn outline; the agent reads more with a tool | the kernl model writes a summary at send time | no cut |
| Works with every agent and provider | yes (text and a tool) | needs kernl's model and key | breaks small context windows |
| Matches the research | progressive disclosure | summaries (Cursor) | none |
| Completeness | 9/10 | 6/10 | 4/10 |

RECOMMENDATION: A, because the agent always sees the whole thread's shape and can fetch any part, without a model call or a context overflow.

## Design

- **Excerpt (`src/sessions.ts`):**
  - `threadTurns(record)` returns each turn's text (one owner, used by the excerpt and the tool).
  - `threadExcerpt` puts an "Outline" after the header (up to 3,000 characters; one line per turn: `3. <request's first 80 characters>`). Then the first turn, the newest turns, and "Read any turn with read_thread (thread <handle>)".
  - `threadPage(...)` (pure) answers `read_thread`: turns `"4-9"` or `"7"`, or `search` (turns containing the words, case-insensitive), within 30,000 characters, saying what was cut.
- **Handles:** a thread's handle is its kernl id, or `<agent>:<sessionId>` for an agent's own session. It's shown in the excerpt and taken by the tool.
- **Agent sessions:**
  - `ThreadRef.agentSession = { agent, sessionId, root }`.
  - `WorkspaceRuntime.readAgentSession` starts a short-lived runner for that agent in that folder, loads the session, and collects its replay (user messages, replies, tool calls) as transcript events. It has a 30 s timeout and is cached for the runtime's conversation.
  - The host checks that `root` is one of the window's folders.
- **`read_thread` (`src/threadTools.ts`):** `{ thread, turns?, search? }`.
  - The runtime finds the thread among its conversation's tagged messages and reads it (store, or agent cache or load).
  - The result is scrubbed and labelled untrusted.
  - It's added, gated "allow", to kernl's agent and to the CLI agents' kernl tools.
- **Store (`SessionStore.list`):** keeps each folder's summaries in memory with each file's size and modification time.
  - A listing reads the directory, checks each file's metadata, and parses only new or changed files.
  - Removed files drop out.
- **Search (`threadCandidates`):** adds agents' sessions from the cached lists (not linked to a kept conversation). An empty query (just `@`) starts the background listing for ready agents whose list is missing or old, sharing the same request as Conversations.

## Risks and mitigations

| Risk | Likelihood | Impact | Mitigation | How we'd notice |
| --- | --- | --- | --- | --- |
| Loading an agent's session at send is slow | Medium | Send waits | 30 s timeout; a note when it fails; cached for the conversation | Log line with the time |
| `read_thread` reads a conversation the user didn't tag | Low | Unwanted context | Only threads tagged in the conversation's own messages | Unit test |
| Another window changes a conversation | Medium | Stale title in `@` | Size and modification time are checked on every listing | Unit test |
| A thread's text carries instructions | Medium | Prompt injection | Marked untrusted, as today | Review |

## Acceptance criteria

- Given a 60-turn thread, when tagged, then the agent's text has an outline of all 60 turns and says how to read more. `read_thread` with `turns: "20-22"` returns those turns.
- Given a conversation that never tagged thread X, when the agent calls `read_thread` on X, then it's refused.
- Given Claude Code's own session listed for the folder, when M types `@` and its title, then it's offered. Tagged and sent, the agent gets its turns; if the agent can't load it, the message says so.
- Given 300 stored conversations, when `@` is typed, then the listing parses only changed files (unit test counts parses).

## Rollout and rollback

- No settings. Revert the commit to undo. Old thread chips (without `agentSession`) keep working.

## Parts

- [x] Store listing cache. Done: unit test (a second listing parses nothing; a changed file is parsed again; a removed one drops out).
- [x] Turns, outline, page. Done: unit tests.
- [x] `read_thread` and tagged-thread lookup. Done: unit test for the page; a VS Code check (a CLI agent's prompt reaches kernl's tool through MCP is covered by the existing kernl tools check, so a runtime-level check: tagged allowed, untagged refused).
- [x] Agents' sessions in `@` and on send. Done: a VS Code check with the fake agent (FAKE_LIST, FAKE_LOAD): `@` lists its session; tagged and sent, the replayed question reaches the agent's text.
- [x] Docs, changelog, suites, package, install.

## Standardized review

- **Bottom line:** present as is (0 blocking, 1 must-verify, 1 note).
- **Criteria:**
  - **Goal fidelity:** pass. All four limits addressed.
  - **Accuracy:** pass. Tagged.
  - **Scope:** pass. No semantic search.
  - **Architecture:** pass.
    - One owner for turns;
    - the tool lives in its own module;
    - the store owns its cache;
    - agent reading reuses the ACP runner the way listing does.
  - **Sequencing:** pass.
  - **Completeness:** pass.
  - **Failure:** pass. Timeouts, refusals, cross-window changes.
  - **Verification:** pass.
  - **Feasibility:** violation (finding 1).
  - **Decision readiness:** pass.
- **Findings:**
  1. **must-verify:** that `session/load` on a short-lived runner doesn't disturb the same session open elsewhere. Claude Code allows loading a session read-only while another process has it [unverified: tested only with the fake agent; the same path Conversations already uses to open a session].
  2. **note:** an agent's session is read again for each new conversation that tags it (the cache lives with the conversation).

## Changes made

- Store: `SessionStore.list` keeps each folder's summaries with file size and modification time and parses only new or changed files; a corrupt file still fails loudly.
- Excerpt: `threadTurns` (one owner), an outline of every turn when something is left out, turns numbered as in the outline, a note naming the handle and the left-out range; no "last active" when the agent gives no date.
- `threadPage` answers `read_thread` (turns "7" / "4-9", or all the words of a search; 30,000 characters; where to read on).
- `read_thread` (`src/threadTools.ts`), gated "allow", for kernl's agent and the CLI agents; `WorkspaceRuntime.readThread` reads only threads tagged in the conversation's own messages.
- Agents' sessions: `ThreadRef.agentSession`, `threadHandle`; `@` lists them from the cached lists (opening `@` refreshes those in the background, sharing Conversations' request); on send, `readAgentSession` loads the session through a short-lived runner (30 s timeout, logged), cached for the tab; the host checks the folder is one of the window's.
- Tests: four unit tests (whole short thread, outline, page, listing cache) and two VS Code checks (read_thread tagged and refused; an agent's own session tagged and its replay reaching the message).
- Found while testing: a session opened in kernl earlier is listed once, as kernl's conversation (by design).

## Open questions

None.
