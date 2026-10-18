# Loader, tool rows, and message actions

- Date: 2026-10-19 08:10
- Status: done
- Repos: kernl   Folders: `src/webview/`, `src/acp/`, `src/ui/`, `media/`, `test/`
- Files: `src/webview/main.ts`, `src/webview/toolRow.ts`, new `src/webview/messageActions.ts`, new `src/webview/toolGroup.ts`, `src/acp/acpRunner.ts`, `src/ui/protocol.ts`, `media/panel.css`, `test/unit/webview.test.ts`, `test/unit/toolRow.test.ts`, `test/unit/acpRunner.test.ts`, `test/unit/webviewSafety.test.ts`, `test/fixtures/fakeAcpAgent.ts`, `test/vscode/suite.ts`, `docs/guides/panel.md`
- Research: `docs/research/2026-10-19-0800_loader-tool-rows-message-actions_research.md`
- Subagents: none

## Context and problem

From M's screenshots of a Claude Code run in the panel:

- **The loader is plain:** three small dim dots and "Working".
- **Command rows are noise:** each shows the raw command, starting with `cd /Users/…/js-client && grep -n …`, cut off at the edge. Reads show "0s".
- **Five steps, five rows:** one read and four searches each take a full row.
- **Message actions:** your messages have Restore and Fork as hover icons beside the bubble; AI replies have nothing, not even Copy. M wants Copy, Restore, Fork under each of your messages, and Copy, Fork under each reply.

## Goals / Non-goals

**Goals**

- A loader that reads as alive and informative: the word itself shimmers, with the elapsed time beside it, and it stays still under Reduce Motion.
- Command rows lead with what the command is for ("Find usages of buildRewardsUrl"), with the command in monospace below, without the redundant `cd`.
- Consecutive reads and searches collapse into one line ("Explored 1 file, 4 searches") that opens to the individual rows.
- An action row under every message: Copy, Restore, Fork under yours; Copy, Fork under each reply.

**Non-goals**

- Turning edits or commands into cards (Zed style). Edits already show +/− and View diff.
- An Esc-to-stop shortcut or a token count in the loader.
- Changing what Restore or Fork do on the host.

## What is true today

- **Loader:** `working` row, dots plus text, kept at the end of the transcript [verified: `src/webview/main.ts:191-208`; `media/panel.css:138-145`].
- **Command titles:** Claude Code's adapter sets the ACP `title` to the command and keeps the plain-words `description` in `rawInput` [verified: local `claude-agent-acp@0.93.0` `dist/tool-calls/reporters/bash.js:20-27`, `renderer.js:534-542`]. kernl shows a title with spaces as the whole row text [verified: `src/webview/toolRow.ts:54`]. The runner merges `rawInput` per call [verified: `src/acp/acpRunner.ts` `toolCallUpdate`] and knows the session's folder (`this.o.cwd`) [verified: `src/acp/acpRunner.ts:148`].
- **Row times:** every row shows its time from "0s" [verified: `src/webview/toolRow.ts:142,190`].
- **Output:** the whole output in a scrolling box [verified: `src/webview/toolRow.ts:201`].
- **Every call is a separate row** in the transcript [verified: `src/webview/main.ts:540-575`].
- **Message actions:** Restore (only with a checkpoint) and Fork on your messages, absolutely positioned to the left, visible on hover [verified: `src/webview/main.ts:307-311,497-501`; `media/panel.css:41-43`]. Copy reaches the clipboard through the existing `copy` message [verified: `src/controller.ts:689-690`].
- **Fork means "up to and including that message's reply"**; CLI agents can fork only from the last message and otherwise get an error [verified: `src/workspaceRuntime.ts:460-475`].
- **Replays rebuild everything:** every panel event except `cleared` is saved and replayed, including `finished` [verified: `src/workspaceRuntime.ts:579`].

```
agent ──tool_call(title, rawInput)──> acpRunner ──toolCall(name, args, info)──> panel ──> toolRow
                                         ^ <-- reads description, drops "cd <cwd> &&"      ^ <-- label + command, grouping
```

## Options considered

| Aspect | A: follow the converged pattern (recommended) | B: keep rows, restyle only |
| --- | --- | --- |
| How it works | Shimmer word + elapsed; description-first command rows; grouped reads and searches; action rows under messages | New dot animation and colors; same row content |
| Fixes "cd /Users/… &&" noise | Yes | No |
| Fixes five rows for five lookups | Yes | No |
| Cost | Four parts, mostly webview; one runner change | Small |
| When it fails | An agent that sends no description: falls back to the command (still without the `cd`) | Same complaint returns |
| Completeness | 9/10 | 4/10 |

RECOMMENDATION: A, because the noise comes from what the rows show, not how they look.

## Decision

Option A. The `cd` and description handling sit in `acpRunner.ts`, the layer that knows the agent's folder and the raw input; the panel only renders what it's given.

## Design

### Part 1: message actions

- **Your messages:** a row under the bubble, right-aligned: **Copy** (the message text), **Restore** (only when it has a checkpoint; same flow as today), **Fork**. They replace the side icons.
- **Replies:** when a turn finishes, a row under that turn's reply, left-aligned: **Copy** (all of the turn's reply text, as Markdown, without tool rows), **Fork** (forks at that turn, the same as Fork on the message above it).
- **Visibility:** shown on hover and keyboard focus within the message; always shown for the latest turn. Icons only, with tooltips and `aria-label`s; "Copied" confirms for 1.5 s.
- **CLI agents:** Fork on an earlier turn is disabled with the tooltip "<Agent> can fork only from the last message", instead of failing after the click.
- **Replays:** built from the saved `userMessage` and `finished` events, so a reloaded conversation has them too.

### Part 2: loader

```
 ✦ Working · 14s                      <- "Working" shimmers (2 s sweep); time is muted, from 1 s
 ● Waiting for your approval · 1m 02s <- static amber dot, no shimmer
```

- The shimmer is a text gradient from `--vscode-descriptionForeground` to `--vscode-foreground` (VS Code chat's technique). No dots.
- Elapsed time counts from when the panel sees the run start; format as tool rows (`14s`, `1m 02s`).
- Reduce Motion (OS setting or `vscode-reduce-motion`): static text, no sweep.
- `role="status"` stays; the time isn't announced (it would chatter): the label updates only on state change.

### Part 3: tool rows

- **Protocol:** `ToolInfo` gains `command?: string` and `description?: string` (both optional, so older replays still render).
- **Runner:** for `kind: "execute"`, `command` = `rawInput.command` with a leading `cd <session folder> &&` (or `;`) removed; `description` = `rawInput.description ?? rawInput.command_description`.
- **Row:** with a description, the row reads "<description>" and the command shows in monospace after it (truncated with an ellipsis, full in the tooltip and when opened). Without one, "Ran" + command. kernl's own `execute` keeps "Running <command>".
- **Times:** hidden under 1 s.
- **Output:** the first and last 5 lines, with "Show all N lines" between them when longer; a failed call opens itself.

### Part 4: grouped reads and searches

```
 ✓ Explored 1 file, 4 searches        >   <- one line; opens to the five rows
    ✓ Read js-client/src/…/useRewards.ts
    ✓ Find usages of buildRewardsUrl   grep -n "buildRewardsUrl" …
```

- **Quiet calls:** kind `read` or `search` (CLI agents' ACP kind; kernl's `read_file`, `ls`, `glob`, `grep`).
- **Grouping:** two or more quiet calls in a row (nothing else between them: no text, thinking, other tool, or approval) share one group; a single one stays a plain row.
- **Summary:** "Exploring…" with a live count while any member runs; "Explored N files, M searches" when done; "· 1 failed" in error color when any failed. Collapsed by default.
- Subagent steps group the same way inside their row.

## Risks and mitigations

| Risk | Likelihood | Impact | Mitigation | How we'd notice |
| --- | --- | --- | --- | --- |
| An agent sends no description | Medium (OpenCode, Codex unverified) | Low | Fall back to "Ran <command>" | Live check per agent |
| A `cd` into a subfolder gets dropped wrongly | Low | Medium (misleading) | Only drop `cd` to exactly the session folder | Unit test with a subfolder `cd` |
| A group hides a failure | Medium | Medium | "· N failed" in the summary, in error color | Panel test |
| Shimmer distracts | Low | Low | 2 s cycle, muted colors, still under Reduce Motion | M's check |
| Action rows clutter long transcripts | Medium | Low | Shown on hover/focus except the latest turn | M's check |

## Acceptance criteria

- Given a Claude Code command with a description, when its row shows, then it reads the description with the command (no `cd <folder> &&`) in monospace.
- Given `cd <subfolder> && x`, when its row shows, then the `cd` stays.
- Given a read and four searches in a row, when they finish, then one line says "Explored 1 file, 4 searches" and opens to five rows.
- Given a group where one search failed, then the summary says "· 1 failed".
- Given an instant read, then its row shows no time.
- Given 40 output lines, when the row is opened, then lines 1-5 and 36-40 show with "Show all 40 lines".
- Given a running agent, then "Working" shimmers with the elapsed time; under Reduce Motion it doesn't move.
- Given any of your messages, then Copy, Fork (and Restore when there's a checkpoint) sit under it; given a finished reply, Copy and Fork sit under it.
- Given a CLI agent with two turns, then Fork on the first turn is disabled with a tooltip.
- Given a reloaded conversation, then every action row is back.

## Rollout and rollback

Panel and runner only; no stored-data change (new `ToolInfo` fields are optional). Rollback: revert the commit and reinstall.

## Parts

### Part 1: message actions

- [x] `messageActions.ts` builds the rows; user and reply rows in `main.ts`; side icons removed. Done: panel tests for each button and the replay.
- [x] CLI fork disabled on earlier turns. Done: panel test.

### Part 2: loader

- [x] Shimmer label, elapsed time, waiting state, reduced motion. Done: panel test for text and time; CSS checked in the preview.

### Part 3: tool rows

- [x] `command`/`description` in the runner. Done: unit tests (description, `command_description`, `cd` to folder dropped, `cd` to subfolder kept).
- [x] Row label, times under 1 s, output head and tail, failed opens. Done: `toolRow` tests.

### Part 4: grouping

- [x] `toolGroup.ts` and grouping in `main.ts`. Done: panel tests (group of five, single stays a row, broken by text, failure count, subagent steps).

### Part 5: quieter rows (M's follow-up after the first check)

M, after seeing the build: no box around the message buttons, and no tick marks on tool calls; a failed call reads "Failed: <description>" in red.

- [x] The box came from a class collision (the row's `user` class picked up the bubble's `.user` style). Rows are now `user-actions` / `reply-actions`. Done: panel test checks only the bubble is `.user`.
- [x] No status column on tool rows or groups: no tick, cross, waiting circle, or stop dash. A running row's text shimmers like "Working"; a waiting one is still; done is plain; failed reads "Failed: …" in red (description and command). Done: panel tests for each state.

### Part 6: shell lookups fold too (approved by M)

Claude Code runs many lookups through its Bash tool, so they arrive as `execute` and didn't group (M's screenshot: 1 read + 4 `grep` commands).

- [x] The runner classifies a command as a lookup only when every part is read-only: `grep`, `rg`, `find`, `ls`, `cat`, `head`, `tail`, `wc`, `sed -n` (plus a harmless `cd`), joined by `|`, `&&`, `||`, `;`. Rejected: any write or run (`>` other than to `/dev/null`, `<`, `` ` ``, `$(`, a lone `&`, `find -delete/-exec/-ok/-fprint`, `sed -i` or a `w`/`e` command, `rg --pre`). `cat`/`head`/`tail`/`wc`/`sed` count as reads; the rest as searches. Done: unit tests with M's four commands and each rejection.
- [x] `ToolInfo.lookup` carries it; the panel folds lookups like reads and searches. Done: panel test; end-to-end check on the fake agent's described `grep`.

### Live check in M's window (23:32 run, Claude Code, "where is useRewards called?")

| Check | Result |
| --- | --- |
| Buttons under your message and the reply | Float, no box (Copy, Restore, Fork; Copy, Fork) |
| Loader | "Working · 18s", ticking |
| Command rows | Lead with Claude Code's description ("Search for the re-…"), command after it, no `cd` into the workspace folder |
| Grouping | "Explored 2 searches" folded two `grep` commands; 6 of 7 commands were lookups |
| **Found:** one lookup stayed a row | `grep … \| head -50; echo ---; sed -n 15,40p …`: `echo` wasn't on the list (Part 7) |
| **Found:** Claude Code never reports a call as running | Its calls go pending → completed, so rows don't shimmer; the loader does. Left as is |

### Part 7: the kernl mark everywhere (M's follow-up)

- [x] A `kernl` icon (the K mark from the logo, drawn solid) replaces the sparkle icon in all seven places: empty state, Working loader, thinking, sequential thoughts, the "think" tool kind, the Auto mode chip, the text-attachment chip. The sparkle icon is removed. Done: no `sparkle` left in `src/`; panel preview.
- [x] `echo` may join a lookup (it writes nothing without a redirect, and redirects are still refused); like `cd`, it doesn't count as one. Done: classifier test with M's command.

### Part 8: output formatting and the new logo (M's follow-up)

M, after the commit: "formatting is not correct, and use the new icon/logo everywhere" (`kernl.png` replaced at 23:45 with a new mark).

- [x] **Output:** Claude Code's adapter wraps command output in a ```` ```console ```` fence and file reads in a ```` ``` ```` fence [verified: adapter `dist/tool-calls/renderer.js:269`, `reporters/read.js:46-60`]; kernl shows text, so the fences appeared. The runner unwraps one fence around the whole output. Done: unit tests (console fence, longer fence, text that only contains a fence stays).
- [x] **Logo:** `media/icon.png` is the new `kernl.png`; `scripts/logo-mark.swift` makes `media/mark.png` (the light glyph as a transparent, single-color image, 256 px); the activity bar uses it, and the panel's `kernl` icon paints it with the text color (CSS mask, allowed by the panel's `img-src`). The hand-drawn K paths are removed. Done: panel test; render check at 13-160 px; live check.

### Finish

- [x] Fake agent's rich scenario sends a described `cd <cwd> && grep`; VS Code end-to-end check asserts the row. Done: suite passes.
- [x] `docs/guides/panel.md` updated. Done: describes the new rows and actions.
- [x] Full unit + VS Code suites, package, install, and a check in M's window. Done: all pass; screenshots match.

## Standardized review

- **Bottom line:** usable once M answers the two questions below.
- **Criteria:** goal fidelity pass (each screenshot complaint maps to a part); current-system accuracy pass (all claims tagged against code and the adapter source); scope pass (cards, Esc, tokens excluded); architecture pass (`cd` and description at the runner, rendering in the panel); sequencing pass (parts are independent; grouping builds on the row from Part 3); completeness pass (protocol, runner, panel, CSS, tests, docs); failure and recovery pass (fallbacks, failure count, revert); verification pass (each criterion has a test); decision readiness: two open questions.
- **Findings:**
  1. **Must-verify:** OpenCode and Codex descriptions are unverified; the fallback keeps them readable. Checked live at the end.
  2. **Note:** Fork under your message and Fork under the reply right after it do the same thing (question 1).

## Changes made

- **Part 1:** `messageActions.ts`; a row under each of your messages (Copy, Restore, Fork) and under each finished reply (Copy of the whole turn's reply, Fork); the newest turn's rows always show; CLI agents' earlier Fork is dimmed with the reason. Side icons removed.
- **Part 2:** "Working" shimmers (2 s sweep, VS Code chat's technique) with the elapsed time from 1 s; waiting shows a static amber shield; still under Reduce Motion; only the label is a live region.
- **Part 3:** `describeCommand` in the runner (description or `command_description`; drops `cd` only into the session folder); command rows lead with the description; no time under 1 s; long output shows 5 + 5 lines with Show all; failed calls open.
- **Part 4:** `toolGroup.ts`; two or more reads and searches in a row fold into "Exploring · …" / "Explored N files, M searches" with "· N failed"; works in subagent steps.
- **Verification:** unit 224 pass, 0 fail; VS Code 59 pass (54 + 5), 0 fail, including the described command end to end; packaged and installed (files match). Not yet seen in M's window: needs a reload.

## Open questions

1. **What Fork on your message means.** Today it's "a new conversation up to and including this message's reply", so it would match Fork under the reply.
   - A (recommended): keep that; both buttons fork the same turn. Works the same for every agent.
   - B: Fork on your message starts a new conversation *before* it, with the message back in the box to edit; Fork under the reply keeps the reply. kernl's agent only: CLI agents can't fork before their last message.
   - RECOMMENDATION: A because it keeps one meaning of Fork for every agent. Completeness: A 8/10, B 8/10.
2. **What Copy on a reply copies.** A turn's reply can be split by tool rows.
   - A (recommended): all of the turn's reply text, joined, as Markdown.
   - B: only the last block (the final answer).
   - RECOMMENDATION: A because nothing the agent said gets lost. Completeness: A 9/10, B 6/10.
