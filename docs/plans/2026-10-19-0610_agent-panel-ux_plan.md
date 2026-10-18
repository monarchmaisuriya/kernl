# Show the agent's work: thinking, live tool calls, plan, context, approvals

- Date: 2026-10-19 06:10
- Status: done (M: "Approved with your recommendations. Build all four parts in order, with tests, and check them in my window at the end.")
- Repos: kernl
- Files:
  - Changed: `src/acp/acpRunner.ts`, `src/agent/session.ts`, `src/agent/runner.ts`, `src/providers/registry.ts`, `src/workspaceRuntime.ts`, `src/ui/protocol.ts`, `src/webview/main.ts`, `src/webview/toolRow.ts`, `media/panel.css`, `package.json`, tests, `README.md`
  - New: `src/webview/thinking.ts`, `src/webview/planBar.ts`, `src/webview/contextRing.ts`
- Research: `docs/research/2026-10-19-0600_agent-panel-ux_research.md`
- Subagents: none

## Context and problem

M: "it works but it doesn't show tool call or thinking". M wants deep research and a plan to improve the UI/UX with best practice.

## What is true today

- **ACP agents:**
  - Their thinking, usage, slash commands, titles, and config changes are dropped [verified: M's log; `acpRunner.ts` `sessionUpdate`].
  - Tool calls show only when finished, without kind, locations, or diffs [verified: same].
  - The plan is shown as a fake tool result [verified: same, `plan` case].
- **kernl's own agent:**
  - Reasoning content parts are dropped [verified: `session.ts:19-23`].
  - Claude thinking is never requested as a summary, and is off unless `reasoningEffort` is set [verified: `registry.ts:155`].
  - Token usage is reported once, at the end [verified: `session.ts` `events.usage` after the loop].
- **The panel today:**
  - Tool rows have status and time [verified: `toolRow.ts`].
  - Thought rows exist only for the sequential-thinking tool.
  - A plain "Working" indicator shows while running.
  - Approval cards offer Approve / Reject / View diff.

```
agent --session/update--> acpRunner.sessionUpdate
   agent_message_chunk    -> text            (shown)
   tool_call              -> toolCall        (shown, final only)
   tool_call_update       -> toolResult      (only completed/failed)        <-- in_progress dropped
   agent_thought_chunk    -> (logged once)   <-- thinking dropped
   plan                   -> fake toolResult <-- not a plan view
   usage_update / available_commands_update / config_option_update / session_info_update -> dropped
model stream --> session.ts textOf() keeps type "text" only   <-- reasoning dropped
```

## Goals

1. **Thinking shows, for every agent:**
   - ACP `agent_thought_chunk` streams in.
   - kernl's own agent shows LangChain `reasoning` / `thinking` parts and DeepSeek `reasoning_content`.
   - Claude is asked for summarized thinking.
   - The thinking block streams open with "Thinking…", then collapses to "Thought for 12s" plus a one-line preview; a click reopens it.
   - Setting `kernl.thinkingDisplay`: `auto` (default), `collapsed`, `expanded`.
2. **Live tool calls:**
   - Each call is one state keyed by its id. Every `tool_call_update` merges in: status pending, running, done, failed, or cancelled; title, content, and locations.
   - Icons are chosen by kind.
   - Edits show the file plus `+N −M` lines and a "View diff" link that opens VS Code's diff editor.
   - Locations are clickable (open the file at that line).
   - Stop marks unfinished calls cancelled.
3. **A plan bar pinned above the input,** from ACP `plan` and kernl's own `write_todos`:
   - Collapsed, it reads "Current: <in-progress step> · 2/5".
   - Expanded, it lists every step with its status.
   - Each update replaces the plan whole.
4. **Context ring in the footer:**
   - ACP `usage_update` (`used`/`size`, cost), and live usage for kernl's own agent.
   - The ring shows a percentage, turning yellow at 75%, orange at 90%, and red at 95%.
   - The tooltip shows used/size and cost.
5. **Session details:**
   - `available_commands_update` feeds the "/" menu for CLI agents.
   - `session_info_update` names the conversation.
   - `config_option_update` keeps the mode chip in sync when the agent changes mode itself (for example, leaving plan mode).
6. **Approvals:**
   - Buttons follow the agent's options: Allow once, Allow always (saying where it applies), Reject.
   - Keyboard: Cmd/Ctrl+Y allows once, Cmd/Ctrl+N rejects.
   - Each card shows the tool's kind and a short description.
7. **Accessibility and polish:**
   - The transcript is `role="log"`.
   - A reply is announced once, when it completes; approvals and errors are announced.
   - Animations honor reduced motion (`vscode-reduce-motion` and `prefers-reduced-motion`).
   - Only theme colors are used; high contrast is checked.
   - Each turn has a visually hidden heading.
   - Errors are in plain language with the fix.

Non-goals (later, named):
- Per-hunk accept/reject inside the panel (the diff editor covers review).
- Live terminal content from agents: kernl runs commands itself, so no `terminal` content arrives.
- Notices and compaction updates, which need capabilities we don't advertise yet.
- Replacing `retainContextWhenHidden` with saved state.

## Options considered (where thinking lives)

| | A. Thinking as its own transcript block, in arrival order (recommended) | B. Fold thinking into the Working indicator | C. Thinking in a side drawer |
| --- | --- | --- | --- |
| How | A block in place: streams open, collapses when done | Only the latest thought line, replaced as it goes | A separate panel listing all thinking |
| Matches | Zed `auto`, Claude Code, Copilot, LangChain guidance | Partly Claude Code's focus view | None of the references |
| Fails when | Very long thinking (mitigated by collapse plus a height cap while streaming) | History lost; can't reread | Disconnected from what it explains |
| Completeness | 9/10 | 5/10 | 4/10 |

RECOMMENDATION: A, because every reference client shows thinking in place and in order, collapsed once done.

## Design

```
acpRunner.sessionUpdate                           session.ts stream
  agent_thought_chunk  -> events.thinking(delta)     reasoning parts / reasoning_content -> events.thinking(delta)
  tool_call(+_update)  -> events.toolCall(state)     tool_call_chunks -> events.toolCall(state)       <-- one state per id
  plan                 -> events.plan(entries)       write_todos args -> events.plan(entries)
  usage_update         -> events.usage({used,size,cost})  usage_metadata per message -> events.usage   <-- live
  available_commands_update -> events.commands(list)
  session_info_update  -> events.title(title)
  config_option_update -> runtime: mode chip sync
        |
  workspaceRuntime.events() -> HostToPanel: thinking, toolCall (upsert), plan, usage, commands, title
        |
  panel: thinking.ts | toolRow.ts (upsert by id) | planBar.ts | contextRing.ts | approval cards
```

- **Protocol** (HostToPanel):
  - `thinking {workspace, id, delta, done?}`;
  - `toolCall` gains `status`, `kind`, `locations`, and `diff` summary fields, and is upserted by id (one row per id; later messages update it);
  - `plan {workspace, entries}`;
  - `usage` gains `used`, `size`, `cost`;
  - `commands {workspace, items}`;
  - `title {workspace, title}`.
  - PanelToHost: `openLocation {path, line}` and `showToolDiff {workspace, id}`.
- **Diffs:** ACP diff content (`path`, `oldText`, `newText`) is kept on the host (not sent whole to the panel). The panel gets `+N −M` counts, and "View diff" opens VS Code's diff editor through the existing `ProposalDiffs`.
- **Claude request:** with a reasoning effort set, `thinking: {type: "enabled", budget_tokens, display: "summarized"}`. Without one, unchanged.
- **Thinking's end:** a thinking block ends when text, a tool call, or the end of the run arrives, and then collapses.

## Risks and mitigations

| Risk | Likelihood | Impact | Mitigation | How we'd notice |
| --- | --- | --- | --- | --- |
| Thinking floods the transcript | Medium | Medium | Collapses when done; height cap while streaming; setting | Screenshot review |
| `display: "summarized"` rejected by the API or library | Low | Medium | Live check first; fall back to no thinking with a log line | Live check |
| Upserted tool rows reorder or duplicate | Medium | Medium | Keyed by id; a test streams pending, in_progress, completed | Panel test |
| Very frequent `usage_update` makes the panel jumpy | Low | Low | Ring updates at most every 500 ms | Manual |
| Screen-reader noise from streaming | Medium | Medium | Announce once on completion | Test the `aria-live` attributes |

## Acceptance criteria

- **ACP thinking:** given an ACP agent sending `agent_thought_chunk`, then a "Thinking…" block streams, collapses when text starts, and reopens on click.
- **Live tool rows:** given `tool_call` (pending) then `tool_call_update` (in_progress, then completed with a diff), then one row goes running to done, shows `+N −M`, and "View diff" opens the diff editor.
- **Plan bar:** given a `plan` update, then the bar shows "Current: …" and the counts; the next update replaces it.
- **Context ring:** given `usage_update {used: 150000, size: 200000}`, then the ring reads 75% in yellow.
- **kernl's own reasoning:** given DeepSeek or Claude (with an effort set), then its thinking shows the same way.
- **Approval keyboard:** given an approval with allow_always, then the card offers Allow always with its scope, and Cmd/Ctrl+Y allows once.

## Rollout and rollback

Local VSIX. Each part ships and is checked in M's window; revert by commit.

## Parts

### Part 1: thinking and live tool calls (fixes M's report)

- [x] ACP: thought chunks, tool call state with merged updates (status, kind, locations, diff), cancelled on Stop.
- [x] kernl's own agent: reasoning parts, DeepSeek `reasoning_content`, Claude `display: "summarized"` (live-checked).
- [x] Panel: thinking block (setting), tool rows upserted by id with kind icons, `+N −M`, View diff, and clickable locations.

### Part 2: plan bar and context ring

- [x] Plan from ACP `plan` and `write_todos`; pinned bar.
- [x] Usage: ACP `usage_update`, live usage for kernl's own agent; ring with thresholds.

### Part 3: session details and approvals

- [x] Slash commands from ACP, session titles, mode sync from `config_option_update`.
- [x] Approval cards from option kinds, with shortcuts.

### Part 4: accessibility and polish

- [x] `role="log"`, one announcement per reply, reduced motion, hidden turn headings, high-contrast check, plain-language errors.

## Standardized review

Reviewed with the plan rubric against `acpRunner.ts`, `session.ts`, `registry.ts`, `toolRow.ts`, `main.ts`, the research brief, and the installed SDK types.

- **Findings, fixed in this file:**
  1. **Must-verify, fixed (feasibility):** Claude's `display` field exists in the installed Anthropic SDK (0.122.0, `display?: 'summarized' | 'omitted'`) and LangChain passes `thinking` through [verified: `node_modules/@anthropic-ai/sdk/resources/messages/messages.d.ts:2433`, `@langchain/anthropic` `thinking?: AnthropicThinkingConfigParam`]. Part 1 still includes a live call before relying on it.
  2. **Must-verify, fixed (failure):** diff content can be large. It stays on the host, and only counts go to the panel (keeps the panel fast and keeps file contents out of panel messages).
  3. **Note:** some items are later work (per-hunk review, terminal content, notices, saved state), each named as a non-goal with its reason.
- **Overall:** 0 blocking, 2 must-verify (fixed), 1 note.

## Changes made

- **Part 1:**
  - `acpRunner.ts`: one state per tool call merged through `tool_call_update` (status, kind, locations, diff); `agent_thought_chunk` becomes thinking; `diffSize` gives an edit's `+N −M`.
  - `session.ts`: thinking from `thinking` / `reasoning` parts and DeepSeek `reasoning_content` (verified live: 56 characters of reasoning streamed apart from the answer).
  - `registry.ts`: Claude thinking requests `display: "summarized"` (type-checked against SDK 0.122; not live-checked, no Anthropic key).
  - Panel: `thinking.ts` (streams open, collapses to "Thought for Ns"; `kernl.thinkingDisplay`); `toolRow.ts` updates in place (kind icons, waiting and running marks, `+N −M`, View diff, file links). Host: `showToolDiff`, `openLocation` (workspace files only).
- **Part 2:** `planBar.ts` (ACP `plan` and kernl's `write_todos`, replaced whole); `contextRing.ts` (`usage_update`, 75/90/95% levels, numbers and cost in the label); kernl's own agent reports usage live.
- **Part 3:**
  - Slash commands: "/" offers a CLI agent's own commands.
  - Titles: `session_info_update` titles the conversation.
  - Mode sync: `config_option_update` keeps the mode chip in step when the agent changes its own mode.
  - Approvals: an agent's "always" option is shown in its own words, used only from its own button, never as a fallback (`Decision`, `toPermissionResponse`). M confirmed keeping it on 2026-10-18, replacing the earlier allow-once-only choice.
  - Shortcuts: ⌘/Ctrl+Y once, ⌘/Ctrl+⌥/Alt+Y always, ⌘/Ctrl+⌥/Alt+Z reject. They follow Zed instead of the planned Ctrl+N, which is VS Code's New File, and are ignored while typing.
- **Part 4:** the transcript is a log that doesn't read out tokens; the announcer covers finished replies, approvals, and errors (urgent); there are hidden turn headings, reduced-motion rules (`vscode-reduce-motion` too), and high-contrast borders.
- **Tests:** unit 215 (rich ACP scenario, diff size, always-allow, approval queue, thinking and to-dos in kernl's agent, panel tests for each part); VS Code end-to-end check with the rich fake agent through the real controller.

## Check in M's window (after the reload, 22:21)

| Check | Result |
| --- | --- |
| Send shows the message and Working at once | Pass |
| Claude Code (Auto): the file read is one row, "Read js-client/…/useRewards.ts", with a file icon and a check; it expands to a clickable location, the arguments, and the output | Pass |
| Context ring from Claude Code's `usage_update` | Pass (4%) |
| OpenCode: "Thinking…" streams open, then collapses to "Thought for 14s" with a preview when the reply starts | Pass |
| OpenCode's context ring | Pass (1%) |
| Switching to OpenCode drops Auto (unsupported) to Ask; switching back and choosing Auto restores it | Pass |
| No update dropped (no "ignoring session update" lines in kernl's log) | Pass |
| Plan bar and approvals | Not triggered by these runs (no plan, Auto mode); covered by the panel tests, the end-to-end check with the rich fake agent, and the browser preview |
| **Found:** locations showed the full absolute path | Fixed: tool rows show workspace-relative paths (end-to-end check pins it) |

M's setup restored: Develop on Claude Code, Auto mode. The two test conversations are in history.

## Open questions

None. Decided by M: kernl's Claude thinking stays opt-in via reasoning effort; Parts 1 to 4 built in order; Allow always kept.
