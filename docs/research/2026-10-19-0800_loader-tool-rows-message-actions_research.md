# How agent panels show progress, tool calls, and message actions

- Date: 2026-10-19 08:00
- Status: presented
- Mode: find out
- Repos: kernl   Folders: `src/webview/`, `src/acp/`, `media/`
- Question / problem: What do leading agent panels do for the "working" indicator and tool-call rows, and what does that mean for kernl's loader and tool rows?

## Research: what do leading agent panels do for the working indicator and tool calls?

- **Bottom line:** They converge. The status word itself is the loader (a shimmer sweeping across "Working" every ~2 s) with muted elapsed time next to it and a static fallback for reduced motion. Tool calls are one-line rows; consecutive reads and searches collapse into one summary ("Explored 3 files, 2 searches"); commands show a plain-words label and the command in monospace with `cd <cwd> &&` removed. Confidence: high (source code of Codex, VS Code chat, Zed, and the Claude Code ACP adapter, read at pinned commits).
- **Where we are:** feeds the loader, tool-row, and message-action plan. About 25 minutes, one research agent plus local checks.
- **Need from M:** accept.

### What I found: kernl today

- **Loader:** three 5 px dots pulsing plus the word "Working" or "Waiting for your approval" [verified: `src/webview/main.ts:191-208`, `media/panel.css:138-145`].
- **Command rows show the raw command:** Claude Code's adapter puts the command text in the ACP `title` [verified: local `claude-agent-acp@0.93.0` `dist/tool-calls/reporters/bash.js:22`], and kernl shows the title as the row's text [verified: `src/webview/toolRow.ts:54`]. So rows read `cd /Users/…/js-client && grep -n …` (M's screenshot).
- **The plain-words description is already sent:** the Bash input's `description` stays whole in `rawInput` for clients like kernl [verified: `dist/tool-calls/renderer.js:534-542`]; the Agent SDK documents it as a summary the user reads, often without seeing the command [primary: `@anthropic-ai/claude-agent-sdk@0.3.302/sdk-tools.d.ts` L814-826, read by the research agent].
- **Every call is its own row,** including "0s" on instant reads [verified: `src/webview/toolRow.ts:142`, `src/webview/main.ts:540-575`].
- **Message actions:** your messages have Restore and Fork as hover icons beside the bubble; replies have none [verified: `src/webview/main.ts:307-311,497-501`, `media/panel.css:41-43`]. A `copy` message to VS Code's clipboard exists [verified: `src/controller.ts:689-690`].

### What I found: other panels

- **Shimmer as the loader:**
  - Codex: spinner, shimmering "Working", then dim `(Ns • esc to interrupt)`; a ~10-character bright band sweeps every 2 s [primary: openai/codex `codex-rs/tui/src/status_indicator_widget.rs` L96-110; `shimmer.rs` L21-80].
  - VS Code chat (Copilot): a text-clip gradient, 2 s cycle; the spinner glyph is hidden while text shimmers; only the stable verb shimmers, changing file names stay still [primary: microsoft/vscode `chat.css` L3576-3601; `chatProgressContentPart.ts` L90-115, L160-213].
  - Claude Code: a rotating spinner verb; settings for reduced motion and the turn duration [primary: code.claude.com/docs/en/settings-reference].
  - Zed: a braille spinner; a different one plus "Awaiting Confirmation" while waiting for approval; elapsed time only after 30 s [primary: zed `thread_view.rs` L8023-8110; `conversation_view.rs` L108-109].
- **Reduced motion:** Codex, VS Code, and Claude Code fall back to static text [primary: codex `motion.rs`; vscode `chat.css` L3631-3638; Claude Code settings docs]. WCAG 2.2.2 requires moving content over 5 s beside other content to be stoppable [primary: w3.org Understanding 2.2.2].
- **Grouping:** Codex shows one "Exploring" / "Explored" cell with merged `Read a, b, c` lines [primary: codex `exec_cell/render.rs` L242-406]; VS Code builds "Read 3 files, searched for 2 phrases, ran 1 command" and counts failures separately [primary: vscode `chatToolGroupSummary.ts` L139-216].
- **Commands:** VS Code removes a redundant `cd <cwd> &&` ("Removed redundant cd command") [primary: vscode `commandLineCdPrefixRewriter.ts`]; Codex previews the first and last 5 output lines with `… +N lines` [primary: codex `exec_cell/render.rs` L43, L118-181]; VS Code expands output on failure, collapses on success [primary: `chatTerminalToolProgressPart.ts` L1113-1120].
- **Cards vs rows:** Zed uses a card only for approvals, edits, and terminals [primary: zed `thread_view.rs` L8935-8939].
- **Progress timing:** under 1 s needs no indicator; over 10 s, say what's happening [secondary: NN/g progress indicators].

### Side by side

| Aspect | kernl today | Codex | VS Code chat | Zed | Which to follow |
| --- | --- | --- | --- | --- | --- |
| Loader | 3 pulsing dots + "Working" | Spinner + shimmer + elapsed + interrupt hint | Shimmer, no spinner | Spinner; elapsed after 30 s | Shimmer word + muted elapsed (VS Code look, Codex info) |
| Waiting for approval | Amber dots, slower | n/a | n/a | Different spinner + label | Static amber mark + label, no shimmer |
| Command label | Raw command | Highlighted command, `bash -lc` removed | Command, `cd` removed | Command in a card | Description, command below in monospace, `cd` removed |
| Reads and searches | One row each | Grouped "Explored" | Grouped sentence | Rows | Grouped "Explored 3 files, 2 searches" |
| Instant calls | "0s" shown | Time from 0 s | n/a | n/a | Hide times under 1 s |
| Output | Full, scrollable | Head + tail 5 lines | Collapsed unless failed | Card | Head + tail 5 lines, `+N lines` |

### What this means for our code

- `src/acp/acpRunner.ts`: read `rawInput.description` (or `command_description`) and the command for execute calls; drop a leading `cd <session cwd> &&` there, where the cwd is known.
- `src/webview/toolRow.ts`: description as the label, command in monospace; times under 1 s hidden; output head and tail.
- `src/webview/main.ts` + `media/panel.css`: a shimmer loader; a group container for consecutive read and search rows; action rows under messages.

### Confidence and gaps

| Claim | Tag | Source tier | What would raise confidence |
| --- | --- | --- | --- |
| Claude Code sends `description` in `rawInput` | verified | primary (adapter source) | — |
| OpenCode's bash tool sends a description | unverified | — | A live OpenCode run, reading `rawInput` |
| Codex's command titles | unverified | — | A live Codex run |
| Cursor's loader | unverified | secondary (forum) | No official source; doesn't change the call |

### Sources

- openai/codex: https://github.com/openai/codex (`codex-rs/tui/src/status_indicator_widget.rs`, `shimmer.rs`, `motion.rs`, `exec_cell/render.rs`)
- microsoft/vscode: https://github.com/microsoft/vscode (`src/vs/workbench/contrib/chat/browser/widget/media/chat.css`, `chatProgressContentPart.ts`, `chatToolGroupSummary.ts`, `chatTerminalToolProgressPart.ts`, `commandLineCdPrefixRewriter.ts`)
- zed-industries/zed: https://github.com/zed-industries/zed (`crates/agent_ui/src/conversation_view/thread_view.rs`, `conversation_view.rs`)
- claude-agent-acp: https://github.com/agentclientprotocol/claude-agent-acp (`src/tool-calls/reporters/bash.ts`, `renderer.ts`)
- Claude Agent SDK tool types: https://unpkg.com/@anthropic-ai/claude-agent-sdk@0.3.302/sdk-tools.d.ts
- Claude Code settings: https://code.claude.com/docs/en/settings-reference
- NN/g progress indicators: https://www.nngroup.com/articles/progress-indicators/
- WCAG 2.2.2 Pause, Stop, Hide: https://www.w3.org/WAI/WCAG22/Understanding/pause-stop-hide.html

## Standardized review

- **Bottom line:** usable. Every pattern used in the recommendation comes from source code or vendor docs; kernl facts are from local code.
- **Criteria:** question fit pass; method pass (codebase first, then primary source code at pinned commits); source quality pass; coverage pass (Codex, VS Code, Zed, Claude Code; Cursor noted as unverifiable); claim traceability pass; uncertainty pass (gaps table).
- **Findings:**
  1. **Note:** the research agent read the upstream repositories; I re-read only the local adapter. The upstream line numbers are as it reported them.
  2. **Must-verify:** OpenCode and Codex command descriptions; the plan falls back to the command when none is sent.
