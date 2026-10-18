# How kernl's panel should show an agent's work

- Date: 2026-10-19 06:00
- Status: presented
- Mode: find out
- Repos: kernl
- Question / problem: Why don't tool calls and thinking show, and what do best-practice agent panels do that kernl doesn't?

## Research: why don't tool calls and thinking show, and what do best-practice agent panels do?

- **Bottom line:** Thinking and most agent activity are dropped by kernl, not missing from the agents. CLI agents send thinking (`agent_thought_chunk`), usage, plans, slash commands, and titles over ACP, and kernl ignores most of them. Kernl's own agent never asks Claude for a thinking summary and throws away DeepSeek's reasoning. Zed (the reference ACP client), Claude Code, and Copilot converge on a clear pattern, below. Confidence: high (primary sources and kernl's own logs and code).
- **Where we are:** feeds the agent-panel UX plan. About 35 minutes, including one research agent reading primary sources.
- **Need from M:** accept, and decide the plan's open questions.

### What I found: kernl today

- **Your OpenCode run sent updates kernl dropped:** `agent_thought_chunk` (thinking), `usage_update`, and `available_commands_update` [verified: M's kernl log, `output_logging_20261018T214906/1-kernl.log`: "OpenCode: ignoring session update 'agent_thought_chunk'" and the others]. That run made no tool call; OpenCode answered from the attached file.
- **ACP handling:** kernl handles 5 of the 11 update kinds and drops `agent_thought_chunk`, `usage_update`, `available_commands_update`, `config_option_update`, `session_info_update`, and replayed `user_message_chunk` [verified: `src/acp/acpRunner.ts` `client().sessionUpdate`; SDK update list in `node_modules/@agentclientprotocol/sdk/dist`].
  - Tool calls are reported only when finished (an in-progress update is ignored).
  - `kind`, `locations`, and diff content are unused.
  - The plan is squeezed into a fake tool result.
- **Kernl's own agent:**
  - It keeps only `text` content parts, so reasoning parts are dropped [verified: `src/agent/session.ts:19-23` `textOf`].
  - Claude thinking is requested only when `reasoningEffort` is set, as `{type:"enabled", budget_tokens}`, without a summary display [verified: `src/providers/registry.ts:155`]. On current Claude models the API returns empty thinking unless `display: "summarized"` is set [primary: platform.claude.com/docs/en/build-with-claude/thinking, fetched 2026-10-18].
  - DeepSeek thinks by default [verified: registry comment, line 63], but its reasoning never reaches the panel.

### What I found: the spec and best practice

- **ACP defines every dropped update** [primary: agentclientprotocol.com protocol/prompt-turn, tool-calls, agent-plan, schema, slash-commands, session-config-options, rfds/session-usage]:
  - Tool calls carry `kind` (read, edit, delete, move, search, execute, think, fetch, switch_mode, other) for icons, and a `status` (pending, in_progress, completed, failed).
  - They also carry `locations` for following the agent, and `content` that may be a diff (`oldText` null means a new file).
  - Plans are replaced whole on every update.
  - `usage_update` gives `used` and `size` (context window), and optionally cost.
  - On cancel, the client should mark unfinished calls cancelled.
- **Zed (reference ACP client):**
  - Thinking streams expanded, then auto-collapses (setting `agent.thinking_display`: `auto` by default; also preview, always expanded, always collapsed).
  - Read, search, fetch, and think calls are compact rows; edits, terminals, and calls waiting for approval are cards.
  - Each kind has an icon.
  - Plans are pinned ("Current: <entry>" plus counts, expandable).
  - A context ring shows a percentage and turns to a warning color at 85% [primary: zed source `crates/agent_ui/src/conversation_view/thread_view.rs`, PR 52874, zed.dev/docs/ai/agent-panel].
- **Claude Code (VS Code):**
  - Thinking shows as collapsed blocks; Ctrl+O toggles all of them.
  - A "Focus view" hides tool detail but keeps the to-do list visible.
  - The mode indicator sits in the prompt footer, alongside a context indicator.
  - Screen readers hear a reply once, when complete, never per token [primary: code.claude.com/docs/en/vs-code].
- **Copilot (VS Code):**
  - Finished steps collapse to "Completed N steps", and reasoning shows as collapsible previews.
  - Checkpoints and per-file keep or undo are offered.
  - A context indicator breaks down where the context goes [primary: code.visualstudio.com docs, 2026-10-14].
- **General UX:**
  - Show progress for anything over about 1 s.
  - Past about 10 s, explain what's happening and show step counts [primary: NN/g progress indicators].
  - Keep system status visible; errors in plain language [NN/g heuristics].
  - Make clear why the system did what it did [Microsoft HAX G11].
  - Use `role="log"` with polite announcements, and honor reduced motion [MDN; VS Code webview guide: `vscode-reduce-motion` body class].
  - Shown reasoning is a model-written summary, not its actual internal reasoning (Anthropic, OpenAI docs), so label it as thinking, not as the explanation.

### Side by side

| Aspect | kernl today | Zed | Claude Code | Copilot | Which to follow |
| --- | --- | --- | --- | --- | --- |
| Thinking | Not shown | Streams open, auto-collapses | Collapsed blocks | Collapsible previews | Zed's `auto` (streams open, collapses) |
| Tool calls | One row, result only at the end | Rows by kind; cards for edits, terminals, approvals | Rows; diffs for edits | Collapse to "N steps" | Zed's rows/cards split, with live status |
| Plan / to-dos | A fake tool result | Pinned, "Current: ..." | To-do list stays visible | To-do list | Pinned above the input |
| Context usage | Token totals at the end | Ring, warning at 85% | Indicator in the footer | Indicator with breakdown | Ring in the footer |
| Approvals | Approve / Reject | Buttons by option kind, shortcuts | Says where "always" is saved | Scoped choices | Buttons by option kind, keyboard |

### What this means for our code

- `src/acp/acpRunner.ts`: handle all update kinds, keep a per-call state (status, kind, title, locations, content), and send updates to the panel as they arrive.
- `src/agent/session.ts`: read `reasoning` / `thinking` content parts and DeepSeek's `reasoning_content`; report usage as it arrives.
- `src/providers/registry.ts`: ask Claude for summarized thinking.
- Panel: a thinking block; tool rows keyed by call id that update in place; a pinned plan; a context ring; approval cards by option kind; and an accessibility pass.

### Confidence and gaps

| Claim | Tag | Source tier | What would raise confidence |
| --- | --- | --- | --- |
| OpenCode sends thinking and kernl drops it | verified | M's log | — |
| Claude needs `display: "summarized"` | verified (docs), unverified (in our LangChain version) | primary | A live call through `@langchain/anthropic` 1.5.12 with `display` set |
| Zed's patterns | verified | primary (source) | — |
| Codex sends usage and plans | unverified | — | A live probe (research rate-limited) |
| Cursor's thinking display | unverified | — | No official doc found |

### Sources

- ACP protocol: https://agentclientprotocol.com/protocol/prompt-turn, /protocol/tool-calls, /protocol/agent-plan, /protocol/schema, /protocol/slash-commands, /protocol/session-config-options, /rfds/session-usage
- claude-agent-acp: https://github.com/agentclientprotocol/claude-agent-acp
- Zed: https://github.com/zed-industries/zed (thread_view.rs, PR 52874), https://zed.dev/docs/ai/agent-panel
- Claude Code in VS Code: https://code.claude.com/docs/en/vs-code
- Claude thinking: https://platform.claude.com/docs/en/build-with-claude/thinking
- Copilot: https://code.visualstudio.com/docs/copilot/chat/chat-agent-mode, https://code.visualstudio.com/docs/copilot/chat/chat-checkpoints
- VS Code webviews: https://code.visualstudio.com/api/ux-guidelines/webviews, https://code.visualstudio.com/api/extension-guides/webview
- NN/g: https://www.nngroup.com/articles/progress-indicators/, https://www.nngroup.com/articles/ten-usability-heuristics/
- Microsoft HAX: https://www.microsoft.com/en-us/haxtoolkit/library/
- MDN live regions: https://developer.mozilla.org/en-US/docs/Web/Accessibility/ARIA/Guides/Live_regions
- LangChain reasoning blocks: https://docs.langchain.com/oss/javascript/langchain/messages

## Standardized review

- **Bottom line:** usable. The cause is verified from kernl's own logs and code; best practice comes from primary sources (spec, reference-client source, vendor docs).
- **Criteria:**
  - Question fit: pass.
  - Method: pass (codebase first, then primary sources).
  - Source quality: pass.
  - Claim traceability: pass.
  - Coverage: pass (Zed, Claude Code, Copilot, Cursor partial).
  - Uncertainty: pass (gaps table).
- **Findings:**
  1. **Must-verify:** whether `@langchain/anthropic` 1.5.12 passes `display: "summarized"` through. The plan includes a live check before relying on it.
  2. **Note:** Cursor's thinking display is unverified. It doesn't change the recommendation (three other clients agree).
