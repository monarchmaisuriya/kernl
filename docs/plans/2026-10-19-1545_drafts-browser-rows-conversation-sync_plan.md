# Keep unsent drafts; no blank browser rows; kernl's CLI conversations pick up turns added elsewhere

- Date: 2026-10-19 15:45
- Status: built (window check left)
- Repos: kernl   Folders: `src/`, `test/`   Files: `src/webview/main.ts`, `src/webview/attachments.ts`, `src/ui/protocol.ts`, `src/controller.ts`, `src/browser/describe.ts`, `src/workspaceRuntime.ts`, `src/sessions.ts`, tests, `docs/guides/panel.md`, `docs/guides/cli-agents.md`, `CHANGELOG.md`
- Subagents: none

## Context and problem

1. M's unsent message ("open browser and look for brevo loyalty apis") disappeared when VS Code restarted.
2. A kernl browser row called by an agent reads "Browser: open" for a moment, until the agent sends the URL.
3. Reopening one of kernl's own Claude Code conversations shows kernl's saved transcript only; turns added to that session in a terminal or the Claude app don't show (sessions opened from the agent's list do reload).

## Goals / Non-goals

- **Goal:** the message box's text and attachments survive a panel reload and a VS Code restart, per window, until sent or cleared.
- **Goal:** a browser row never shows a verb without its object.
- **Goal:** reopening a kernl CLI conversation adds the turns the agent has after kernl's last saved turn, keeping kernl's own transcript (Restore points, previews).
- **Non-goal:** drafts per workspace (the panel has one message box shared by all workspaces today [verified: `main.ts` `select()` leaves `input` alone]).

## What is true today

- No draft is kept: the webview has no `getState`/`setState` or draft message [verified: grep of `src/webview/main.ts`]. Queued messages are saved per workspace on disk [verified: `workspaceRuntime.ts:418-425`].
- `setInput` puts text back; `attachments.add()` re-recognizes mentions already in the text [verified: `main.ts:851-855`, `attachments.ts:138-149`]; `take()` returns and clears [verified: `attachments.ts:296-300`].
- `describeBrowserCall` gives `target: hostOf("")` = "" before the URL arrives, so the row reads "Browser: open" [verified: `src/browser/describe.ts`; seen in the live run].
- `openSession` shows the saved transcript and sets the agent session to load on the next send, with its replay dropped [verified: `workspaceRuntime.ts` `openSession`; `acpRunner.ts` `load(..., "drop")`]. Imported sessions load at once with the replay shown [verified: `openAgentSession`].

## Options considered (item 3)

| | A: append what the agent has after kernl's last turn (recommended) | B: replace with the agent's replay | C: a notice only |
| --- | --- | --- | --- |
| How | load the session at open, collect the replay, find kernl's last message in it, add the turns after it below kernl's transcript | show the replay as the whole transcript | say "turns were added elsewhere" without showing them |
| Keeps Restore points and previews | yes | no | yes |
| When it fails | kernl's last message can't be found in the replay (edited elsewhere): nothing is added, logged | | |
| Completeness | 9/10 | 5/10 | 4/10 |

RECOMMENDATION: A because it shows everything new without losing what kernl knows about its own turns.

## Decision

M signed off: all three parts, option A for reopened conversations.

## Design

### 1. Drafts

```
type / attach ──(400 ms after the last change)──> panel: {type:"draft", text, attachments} ──> host: workspaceState "kernl.draft"
panel ready ──> host: {type:"restoreDraft", text, attachments} ──> box filled, chips back
send / clear ──> draft "" saved
```

- `attachments.current()`: the attachments now, without clearing (`take()` keeps clearing on send).
- Saved per window (VS Code `workspaceState`), so another window's draft stays its own. Text attachments over 50,000 characters in total are left out of the saved draft (logged), so the state stays small.
- Restored only into an empty box (a draft never overwrites what you've typed since the panel opened).

### 2. Browser rows

- `describeBrowserCall` leaves `target` undefined until it's known; the row reads "Browser: open a page", then "Browser: open developers.brevo.com" once the URL arrives (verbs without a target get an object: "open a page", "click an element", "type into a field").

### 3. Turns added elsewhere

- `openSession` for a CLI conversation with an agent session (not an import): after showing kernl's transcript, kernl loads the session now (`loadNow`, replay collected, not shown), finds kernl's last user message in the replay (the agent's copy starts with kernl's text; it may add an attachment note), and adds the turns after it (closed as turns, `replayTranscript`) with a note "Added in another app since this conversation was last open in kernl".
- Not found: nothing is added; a log line says why.
- The workspace counts as running while it loads (as imports do); queued messages send after.

## Risks and mitigations

| Risk | Likelihood | Impact | Mitigation | How we'd notice |
| --- | --- | --- | --- | --- |
| Opening a conversation now starts the agent | Certain | A few seconds; the agent runs (it would on the next send anyway) | Same as imports; only CLI conversations | Window check |
| The agent's replay doesn't contain kernl's last message (compacted, edited) | Low | Nothing added | Logged; transcript unchanged | Log |
| A large draft in workspaceState | Low | Slower state writes | 50,000-character cap on saved text attachments | Unit test |

## Acceptance criteria

- Given text and an attached file in the box, when VS Code restarts, then the box shows the same text and chip.
- Given a sent message, when VS Code restarts, then the box is empty.
- Given an agent's browser call before its URL arrives, then the row reads "Browser: open a page".
- Given a kernl Claude Code conversation with two turns added in a terminal, when it's reopened in kernl, then kernl's turns (with Restore) show, followed by the two added turns and the note.

## Rollout and rollback

- No setting; each part reverts on its own.

## Parts

### Part 1: drafts
- [x] Panel draft messages, host storage, restore. Done: panel tests (draft sent after typing, cleared on send, restored into an empty box only); a VS Code check (draft survives a panel reload).

### Part 2: browser rows
- [x] Describer without empty targets. Done: unit test.

### Part 3: turns added elsewhere
- [x] Load on open, anchor, append. Done: unit test for the anchor and append (`turnsAfter`); VS Code check with the fake agent (a saved conversation plus extra replayed turns shows both, with Restore on kernl's turn).

### Finish
- [ ] Docs, changelog, suites, package, install, window check.

## Standardized review

- **Bottom line:** executable after one decision (item 3); no blocking findings.
- **Criteria:** goal fidelity pass; accuracy pass (tagged); scope pass; architecture pass (draft storage in the host, wording in the describer, sync in the runtime reusing the import path); sequencing pass (independent parts); completeness pass; failure handling pass (no anchor: nothing added, logged; oversized drafts capped); verification pass; feasibility pass; decision readiness: A, B, or C.
- **Findings:** 1. **must-verify:** that Claude Code's replay of a kernl session contains kernl's user messages as sent (live run, optional). 2. **note:** drafts are per window, not per workspace, matching the one shared message box.

## Changes made

- Drafts: the panel sends the box's text and attachments 400 ms after a change (at once, empty, on send); the host keeps it in workspaceState (`kernl.draft`, text attachments capped at 50,000 characters) and gives it back on ready, into an empty box only.
- Browser rows: no empty targets ("Browser: open a page" until the URL arrives).
- Reopened kernl CLI conversations: loaded from the agent at open; the turns after kernl's last message are added under a note; on a failed load the session loads on the next send, as before.
- Verified: unit tests (0 failures), single-folder suite 72/72 (drafts and turns-added checks), multi-root 6/6.

## Open questions

- Item 3: A, B, or C.
