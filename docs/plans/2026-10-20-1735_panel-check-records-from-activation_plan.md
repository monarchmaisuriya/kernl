# Panel check: record the panel's messages from activation

- Date: 2026-10-20 17:35
- Status: done
- Repos: kernl   Files: `test/vscode/suite.ts` (plus the lifecycle probe already added: `src/ui/panel.ts`, `src/controller.ts`)
- Subagents: none
- Sign-off: M chose Option A (2026-10-20): "record the panel's deliveries from activation so the check sees the handshake whenever the panel loaded; keep the lifecycle probe."

## Context and problem

The suite check "panel: the real webview loads under its CSP and shakes hands with the host" failed once in 35 runs: "timed out waiting for the panel to receive its workspace list". In that run the panel had loaded and said ready before the check started recording. The panel is kept alive while hidden (`retainContextWhenHidden: true`), so opening it again sends no new ready, and the check waited for a burst of messages that had already gone out.

## What is true today

- The suite records what reaches the panel only from the start of `panelChecks` [verified: `test/vscode/suite.ts:1050-1056`].
- Nothing reaches the panel before it says ready [verified: `src/ui/panelChannel.ts` `post`].
- The check waits for the first `workspaces` message from the start of that record [verified: `test/vscode/suite.ts:1099`].
- The trigger of the early load is unknown. Losing window focus did not reproduce it in 3 of 3 runs [verified: timelines `kernl-timeline-1792497489769.txt`, `…555894.txt`, `…621459.txt`].

## Design

- Move the record of delivered messages (the `delivered` list and its timeline lines) into the timeline setup at the suite's start, where the panel lifecycle probe already subscribes. `panelChecks` reads that same list.
- Normal runs are unchanged: nothing is delivered before the panel is ready, and that happens when the check opens it.
- In an early-load run, the check finds the handshake (status and workspace list) whenever it happened, and the timeline shows when the panel resolved.
- Every other reader of the list uses an offset taken at the start of its check, or benefits from seeing more (for example, "the key never reaches the panel").

## Acceptance criteria

- Given a normal run, then both suites pass as before.
- Given the panel loaded before `panelChecks`, then the check still finds the workspace list (the record covers it).

## Parts

- [x] Move the recording; build; unit tests; both suites; recurrence test.

## Changes made

- `test/vscode/suite.ts`: the `delivered` record and its timeline lines move from `panelChecks` to the timeline setup at the suite's start, next to the lifecycle probe; `panelChecks` reads the same record.
- Lifecycle probe (kept): `AgentPanel.onLifecycle` and `lifecycleState()` (`src/ui/panel.ts`), exposed to the suite as `onPanelLifecycle` and `panelState` (`src/controller.ts`); the timeline logs the panel's state when it starts and every later step.
- Verified: unit 413/413; single-folder 100/100; multi-root 7/7.
- Recurrence test (temporary lines, removed): with the panel loaded before `panelChecks`, the fix passed 100/100 and the old recording failed with the original message, "timed out waiting for the panel to receive its workspace list".

## Open questions

- What loaded the panel early in the one failure. The lifecycle probe logs it if it happens again.
