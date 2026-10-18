# Permission modes for every agent, and fixes from the test drive

- Date: 2026-10-19 03:00
- Status: done (M: "TEST DRIVE EVERY SETTING, INTERACTION ... plan to fix everything, use your best judgement and finish all")
- Repos: yourstack
- Files:
  - New: `src/modes.ts`
  - Changed: `src/acp/agents.ts`, `src/acp/acpRunner.ts`, `src/gate/approvalGate.ts`, `src/workspaceRuntime.ts`, `src/controller.ts`, `src/checkpoints.ts`, `src/providers/registry.ts`, `src/ui/protocol.ts`, `src/webview/main.ts`, `src/webview/modeMenu.ts` (new), `media/panel.css`, `src/webview/icons.ts`, tests, `README.md`
- Subagents: none

## Context and problem

M wants a permission-mode menu like Claude Code's (Ask Before Edits, Edit Automatically, Plan Mode, Auto Mode, Bypass Permissions) for every agent, showing only the modes that agent supports. Today the footer's "Asks first" is plain text and does nothing.

M also asked me to test-drive every setting in their VS Code and fix what's broken.

## Test drive (2026-10-19, M's window "Work (Workspace)", by clicking; typing isn't possible for me there)

| # | What I did | What happened | Verdict |
| --- | --- | --- | --- |
| 1 | Clicked "Asks first" | Nothing; it's a span | Bug: M's request |
| 2 | Clicked the agent chip | Menu took ~8 s to appear: it re-checks every CLI's login before showing | Bug |
| 3 | Fresh install, YourStack | "needs setup: Set yourstack.model to a model id": the default provider (Anthropic) has no default model | Bug |
| 4 | Manage providers | DeepSeek "no key yet": M's earlier key never got stored. Cause unverified (I can't type in VS Code) | Mitigated by 5; see open questions |
| 5 | Banner | Says "Set yourstack.model", but its button is "Set API key", which doesn't fix the model | Bug |
| 6 | Agent chip: picked YourStack (needs setup), then left setup | The workspace switched to YourStack anyway, so it now can't run | Bug |
| 7 | Send | Message and error showed within ~1 s on retest (the first look caught a background repaint) | Works |
| 8 | Restore points in Develop (9 git repos inside) | Snapshots record nested repos as single pointers (mode 160000), not their files, so Restore wouldn't restore them while reporting success [verified: scratch repo test, and a scratch snapshot of `~/Develop`: 1 file + 9 pointers] | Serious bug |
| ok | Workspace chip and switching folders; model chip; attach menu (Conversations shows "none yet"); open-file chip; send menu; history; New conversation | All worked | |

## Research: what each agent supports (probed live, no prompts sent)

| Mode (our name) | YourStack (our gate) | Claude Code (`mode`) | Codex (`mode`, `collaboration_mode`) | OpenCode (`mode` + launch config) |
| --- | --- | --- | --- | --- |
| Ask before edits | every edit and command asks (today) | `default` | `read-only`, `default` | `build` + ask config (today) |
| Edit automatically | file edits and writes in the folder don't ask; commands, deletes, and other tools do | `acceptEdits` | `workspace-write`, `default` | `build` + config with `edit: allow` (relaunch) |
| Plan mode | read and search only; every change refused; the model is told to plan | `plan` | `read-only`, `plan` | `plan` |
| Auto mode | not supported | `auto` | `agent` ("Auto review"), `default` | not supported |
| Bypass permissions | not supported | `bypassPermissions` | `agent-full-access`, `default` | not supported |

[verified: Claude adapter 0.93.0 `availableModes` and config `mode`; codex-acp 2.2.2 config `mode` and `collaboration_mode`; opencode 2.0.27 config `mode` build/plan]

## Decision on Bypass (contradiction named)

In the customisation plan M chose "no skip-all-approvals mode". Now M asks for a menu "like this", which includes Bypass.

- Resolution: Bypass is offered only for agents whose own CLI implements it (Claude Code, Codex). Picking it asks for confirmation with a modal that spells out the risk.
- YourStack keeps no skip-all mode, as decided earlier.
- Reported to M so they can change it.

## Goals / Non-goals

Goals:

1. **Mode chip:**
   - A button showing the current mode (icon and name).
   - It opens an in-panel menu like Claude Code's: icon, name, and one-line description for each mode the workspace's agent supports. The current mode is checked.
   - It's per workspace and kept across reloads.
   - Changing the agent keeps the mode if the new agent supports it; otherwise it falls back to Ask.
2. **Modes really apply:**
   - YourStack: in the gate (plus a plan note to the model).
   - CLI agents: through their ACP config options, confirmed in the reply. The fail-closed rule stays: if a mode can't be confirmed, nothing runs.
   - OpenCode "Edit automatically" relaunches the agent with its conversation reloaded.
3. **Fix test-drive bugs 2, 3, 5, 6, and 8:**
   - The agent menu opens at once, from cached readiness (refreshed on focus, at startup, and in the background).
   - Anthropic gets a default model (`claude-sonnet-5-5`).
   - The banner's button runs one "Choose provider and model" flow, which asks for a key when needed.
   - Picking a not-ready agent switches only once its setup is complete.
   - Restore points include files inside nested git repositories.

Non-goals: Auto or Bypass for YourStack; default models for OpenAI and Google (their ids aren't verified here).

## Design

- **`src/modes.ts`:** `PermissionMode = "ask" | "acceptEdits" | "plan" | "auto" | "bypass"`, with `MODE_INFO` (label, icon, description). `modesFor(harness)` lists the supported modes, from the CLI spec or the YourStack list.
- **`agents.ts`:**
  - `CliAgentSpec.modes: Partial<Record<PermissionMode, { session: AskMode; env?: Record<string,string>; disclosure }>>` replaces `askMode` and `disclosure`.
  - `AskMode` gains `configOptions` (several options set together; used for Codex).
- **`acpRunner.ts`:**
  - The runner reads its mode spec through a function.
  - `applyMode()` re-applies it to the live session (setting the options and confirming them, as `forceAskMode` does today); new sessions use it too.
- **Gate:** `GatePolicy.mode()`. The order is: a deny rule wins, then plan refuses every non-read, then allow rules apply, then Edit automatically allows edit and write of non-sensitive paths, then the user is asked.
- **Runtime:**
  - `mode` field and `setMode(mode)`: YourStack applies it at once; CLI agents call `runner.applyMode()`.
  - A change in launch env (OpenCode) exports the conversation, resets the runner, and reloads.
  - In plan mode the YourStack agent's message is prefixed with a plan instruction (the transcript shows the user's text unchanged).
  - `view()` adds `mode` and `modes`.
- **Controller:**
  - A `setMode` panel message. Bypass needs a modal confirmation.
  - The mode is kept per workspace root in workspace state.
  - Agent changes re-check the mode.
  - Readiness is cached for the picker.
  - Picking a not-ready agent runs its setup and switches only if it's ready after.
  - The banner action opens the provider and model flow.
- **Panel (`modeMenu.ts`):**
  - A popover in the send menu's style, with an icon, label, description, and check per mode.
  - Restricted Mode keeps the "Read-only" chip with no menu.
- **Checkpoints:**
  - After `add -A`, the gitlink entries name nested repos. Each one is snapshotted in its own shadow repository (recursively).
  - The top commit's message carries `nested-checkpoints: {json}`.
  - `changes` and `restore` cover them, with paths prefixed by the nested repo's folder.
  - Old checkpoints (no manifest) still work.

## Risks and mitigations

| Risk | Likelihood | Impact | Mitigation | How we'd notice |
| --- | --- | --- | --- | --- |
| A mode change doesn't take effect in a CLI agent | Medium | High | Each change is confirmed from the agent's reply; otherwise a refusal message, and the mode stays as it was | Unit test with the fake agent |
| Bypass picked by accident | Low | High | Modal confirmation; not offered for YourStack | VS Code check |
| Nested-repo snapshots slow on a big folder | Medium | Medium | Each nested repo's own .gitignore applies; the first one runs in the background at startup | Timed on `~/Develop` |
| Codex plan needs two options | Low | Medium | Set together and both confirmed | Live probe |

## Acceptance criteria

- **Mode menu:** given Claude Code, when the mode chip is clicked, then 5 modes show; for YourStack 3 show; for OpenCode 3 show; for Codex 5 show.
- **YourStack Edit automatically:** given that mode, when the agent edits a file, then no card appears; a command still asks.
- **YourStack Plan:** given plan mode, when the agent tries to edit, then it is refused.
- **CLI modes:** given Claude Code (fake agent), when Edit automatically is chosen, then `mode=acceptEdits` is set on the session and confirmed.
- **Bypass confirmation:** given Bypass, then a confirmation appears; declining keeps the old mode.
- **Restore covers nested repos:** given a folder with a nested repo, when a nested file changes and Restore runs, then it's restored.
- **Agent menu speed:** given cached readiness, when the agent chip is clicked, then the menu opens without waiting for the CLIs' checks.

## Parts

- [x] Modes: model, agents, runner, gate, runtime, controller, panel menu.
- [x] Fixes: readiness cache, default model, banner flow, not-ready switching, nested checkpoints.
- [ ] Tests, README, package, reinstall, re-test in M's window.

## Standardized review

Reviewed with the plan rubric against the files named above and the live probes.

- **Findings, fixed in this file:**
  1. **Blocking, fixed (decision readiness):** Bypass contradicts an earlier decision of M's. It's resolved as stated above and surfaced in the report, not chosen silently.
  2. **Must-verify, fixed (failure):** a CLI mode change while a turn runs: the ACP config can be set mid-turn. Not confirmed equals refused, and the old mode is kept.
  3. **Must-verify, fixed (completeness):** OpenCode's Edit automatically depends on the launch environment, so it needs a relaunch with the conversation reloaded (session/load). If load isn't supported, the existing notice says a new conversation starts.
  4. **Note:** finding 4 (key not stored) can't be reproduced without typing. The new "Key stored" confirmation makes success visible, and M is asked to retry.
- **Criteria:** all pass after fixes.
- **Overall:** 1 blocking (fixed), 2 must-verify (fixed), 1 note.

## Changes made

- `src/modes.ts` (new): the five modes, their labels and icons, YourStack's three modes, and the plan note.
- `src/acp/agents.ts`:
  - each agent's supported modes (session options, launch env, disclosure) replace `askMode`;
  - Codex sets `mode` and `collaboration_mode` together;
  - OpenCode's Edit automatically uses an `edit: allow` config.
- `src/acp/acpRunner.ts`:
  - `applyMode()` switches the live session;
  - every mode is confirmed from the reply, with one re-set for OpenCode's lagging reply;
  - unconfirmed means refused.
- `src/gate/approvalGate.ts`: deny rule, then plan refusal, then allow rule, then Edit automatically (edits and writes, not credential files), then ask.
- `src/workspaceRuntime.ts`:
  - mode per workspace, applied at the gate or on the CLI session;
  - OpenCode relaunches with the conversation reloaded;
  - falls back to Ask when the agent changes;
  - plan note for YourStack;
  - `view()` carries `mode` and `modes`.
- `src/controller.ts`:
  - `setMode` (Bypass confirmation, a refusal message, kept per root);
  - the agent menu opens from cached readiness;
  - a not-ready agent switches only after setup succeeds.
- `src/providers/registry.ts`: Anthropic defaults to `claude-sonnet-5-5`; the missing-model message names the model chip.
- Panel: the mode chip is a button with an in-panel menu (icon, name, meaning, check); the banner button is "Choose provider and model".
- `src/checkpoints.ts`: nested git repositories get their own snapshots, listed in the outer checkpoint's message; `changes` and `restore` include them.
- Tests: gate modes, live mode change and lagging reply (runner), agent mode tables, panel mode menu and Restricted Mode, nested-repo restore, and two VS Code checks.

## Re-test in M's window (after the reload, 2026-10-19 21:1x)

| Check | Result |
| --- | --- |
| Mode chip shows the current mode with an arrow; the menu lists YourStack's 3 modes with meanings and a check | Pass |
| Edit automatically on YourStack: chip and transcript note ("Permission mode: Edit automatically.") | Pass |
| Default model: the chip shows `claude-sonnet-5-5` | Pass |
| Agent menu opens instantly | Pass (was ~8 s) |
| Claude Code: 5 modes with its own meanings; Edit automatically kept on switch | Pass |
| Bypass: confirmation appears; Cancel keeps the mode; confirm shows an amber "Bypass permissions" chip | Pass |
| OpenCode: 3 modes; Bypass falls back to Ask on switch | Pass |
| Codex: 5 modes with its own meanings | Pass |
| Picking YourStack (needs setup) opens the provider and model flow; abandoning it keeps Codex with a warning | Pass |
| Plan item click | Background-click tool limit only. In real Chromium every point of each item hits the item, and a click sends `setMode plan`. |
| Follow-up | The missing-key message pointed to the old "Set API key" command; it now points to the model chip |

Left as found: Develop (OpenCode, Ask, M's conversation). Debug is now on Codex in Ask mode, because YourStack can't be selected there until a key is added (by design).

## Open questions

- Finding 4: M's DeepSeek key wasn't stored, and how M entered it is unknown. After this ship, retry via the model chip or Manage providers; a "Key stored" message now confirms it.
