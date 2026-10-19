# Agent chip in the bottom row; send options arrow off without text

- Date: 2026-10-19 14:40
- Status: done
- Repos: kernl   Folders: `src/webview/`, `test/unit/`   Files: `src/webview/main.ts`, `src/webview/sendMenu.ts`, `test/unit/webview.test.ts`, `docs/guides/panel.md`
- Subagents: none

## Context and problem

The composer's toolbar holds the agent picker ("Claude Code") next to the model, thinking, and fast chips. M wants the agent picker in the bottom row with the workspace ("Develop") and mode ("Auto mode") chips. The arrow next to Send opens the send options even when the box is empty, where every option is disabled.

## Goals / Non-goals

- **Goal:** the agent chip (and its setup warning button) sits in the bottom row, between the workspace chip and the mode chip.
- **Goal:** the send options arrow is disabled when the box is empty, as Send is.
- **Non-goal:** changing what the agent menu offers, or the model, thinking, and fast chips (they stay in the toolbar).

## What is true today

- Toolbar: `attachButton, setupButton, agentChip, modelChip, thinkingChip, fastChip, spacer, sendGroup` [verified: `src/webview/main.ts:161`].
- Bottom row: `workspaceChip, modeChip, jobsChip, spacer, contextRing, usage` [verified: `src/webview/main.ts:196`].
- The arrow (`sendMenu.button`) is disabled only without a workspace; with no text its items are disabled but it still opens [verified: `src/webview/sendMenu.ts:87-94`].
- Send itself is disabled with no text unless the agent is running (then it is Stop) [verified: `src/webview/main.ts` `sendButton.disabled`].

## Options considered

| | A: between workspace and mode (recommended) | B: first in the bottom row | C: after the mode chip |
| --- | --- | --- | --- |
| Reads as | where (Develop), who (Claude Code), how (Auto mode) | who, where, how | where, how, who |
| Fits | the mode chip describes the agent's modes, so it follows the agent | | |
| Completeness | 9/10 | 8/10 | 7/10 |

RECOMMENDATION: A because the mode chip's choices depend on the agent, so the agent comes right before it.

## Decision

Pending M's sign-off.

## Design

```
toolbar:  [+] [model] [thinking] [fast] ............ [send][v]   <-- agent chip and setup button leave
footer:   [Develop] [! setup] [Claude Code] [Auto mode] [jobs] ... [context] [usage]   <-- they arrive here
```

- Move `setupButton` and `agentChip` into the footer, between `workspaceChip` and `modeChip`; their behavior, anchors, and labels don't change. The agent menu opens from its new place (anchored menus position from the button).
- `sendMenu.update`: `button.disabled = !state.available || !state.hasText`. With no text there is nothing to send in any of the three ways, so the arrow is off; typing turns it on.

## Risks and mitigations

| Risk | Likelihood | Impact | Mitigation | How we'd notice |
| --- | --- | --- | --- | --- |
| The footer gets crowded in a narrow panel | Medium | Chips truncate | Chips already shrink with ellipsis (`.chip` min-width 0); check at the narrow width M uses | Window check |
| The agent menu opens off screen from the bottom row | Low | Menu clipped | Anchored menus already open from footer chips (workspace) | Window check |

## Acceptance criteria

- Given the panel, then the agent chip is in the bottom row between the workspace and mode chips, and the toolbar no longer has it.
- Given an empty message box, then the send options arrow is disabled; given text, it's enabled.
- Given an agent that needs setup, then the warning button shows next to the agent chip in the bottom row.

## Rollout and rollback

- No setting; rollback is reverting the change.

## Parts

### Part 1
- [ ] Move the agent chip and setup button; disable the arrow without text. Done: panel tests (placement; arrow off when empty, on with text) pass; existing agent chip tests pass.
- [ ] Panel guide line updated; package, install, check in M's window.

## Standardized review

- **Bottom line:** executable after one decision (placement); no blocking findings.
- **Criteria:** goal fidelity pass; current-system accuracy pass (tagged); scope pass; architecture pass (webview only); sequencing pass; completeness pass (tests, docs); failure handling n/a (layout only); verification pass; feasibility pass; decision readiness: placement A, B, or C.
- **Findings:** 1. **note:** crowding at narrow widths; checked in M's window.

## Changes made

None yet.

## Open questions

- Placement A, B, or C.
