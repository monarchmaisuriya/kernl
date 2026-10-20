# Small and medium follow-ups: commands everywhere, command hints, shared session reads, frames, terminal credentials, tab shortcuts

- Date: 2026-10-20 15:11
- Status: done (window check pending)
- Repos: kernl   Folders: `src/`, `src/ui/`, `src/webview/`, `src/browser/`, `src/terminal/`, `test/`
- Files:
  - commands everywhere: `src/webview/panelCommands.ts` (moves to `src/ui/panelCommands.ts`), `src/webview/main.ts`, `src/controller.ts`, `src/workspaceRuntime.ts`, `src/chatRequest.ts`, `package.json`;
  - hints: `src/ui/protocol.ts`, `src/acp/acpRunner.ts`, `src/webview/attachments.ts`;
  - shared session reads: new `src/agentThreads.ts`, `src/workspaceRuntime.ts`, `src/controller.ts`;
  - frames: `src/browser/integratedBrowser.ts`, `src/browser/snapshot.ts`;
  - terminal: `src/terminal/readTools.ts`, `src/terminal/history.ts`;
  - shortcuts: `package.json`, `src/extension.ts`, `src/controller.ts`;
  - plus tests, `docs/guides/*.md`, `CHANGELOG.md`.
- Subagents: none (parallel sessions offered after sign-off; see Parts)

## Context and problem

M chose to finish the "small" and "medium" items left open after 0.8.1:

1. **Commands everywhere:** kernl's slash commands work only in the panel's message box. In Ask kernl (`Ctrl+Alt+Shift+K`) and `@kernl` in VS Code's chat, `/new` is sent to the agent as text.
2. **Command hints:** an agent can say what a command takes (ACP `input.hint`, for example Codex's `/review` "[instructions]"). kernl drops it, so the `/` menu doesn't show it.
3. **Shared session reads:** tagging one of a CLI agent's own sessions reads it through the agent (a short-lived agent process, up to 30 s). Each tab keeps its own copy, so two tabs tagging the same session read it twice.
4. **Frames:** before a real click, kernl checks that nothing covers the element. Elements inside a frame skip that check.
5. **Terminal credentials:** output of a command that names a credential file (`cat .env`) is hidden from agents, but only for commands kernl recorded. VS Code's own view of the last command, and the user's terminal selection, aren't checked.
6. **Tab shortcuts:** tabs have no keyboard shortcuts.

## Goals / Non-goals

- **Goals:** each item above works as described in "Design", with a test that fails without it.
- **Non-goal:** the "large or risky" group:
  - stopping two tabs from editing the same file;
  - per-tab Restore;
  - a Windows terminal fallback;
  - why VS Code stops passing real input to kernl's browser tab.
- **Non-goal:** frames from another site (out-of-process frames). kernl can't read inside them from the page.

## What is true today

- **Commands:**
  - the panel matches kernl's commands (`commandFor`, `menuRows`) [verified: `src/webview/panelCommands.ts`];
  - the panel runs them, by posting messages or clicking chips, with availability read from the chips [verified: `src/webview/main.ts` `runCommand`, `commandAvailable`];
  - Ask kernl and `@kernl` call `sendFromOutside`, which posts a plain `send` [verified: `src/controller.ts:376-388`];
  - the agent's command list goes only to the panel; the runtime doesn't keep it [verified: `src/workspaceRuntime.ts` `commands: (items) => this.post(...)`];
  - `@kernl` declares no chat commands [verified: `package.json` `chatParticipants`].
- **Hints:** kernl keeps a command's name and description only [verified: `src/acp/acpRunner.ts:659-660`]. ACP has `input.hint` ("A hint to display when the input hasn't been provided yet") [verified: [ACP slash commands](https://agentclientprotocol.com/protocol/slash-commands)]. Codex's `/review` and Claude Code's commands with an argument hint send one [verified: claude-agent-acp 0.93.0 `acp-agent.js:9628-9636`].
- **Session reads:** the per-tab `agentThreads` map is keyed by handle and never refreshed [verified: `src/workspaceRuntime.ts:676-694`]. A tagged thread carries `updatedAt` from the agent's list [verified: `src/ui/protocol.ts` `ThreadRef`].
- **Frames:**
  - `HIT_TEST` returns "" (not covered) when the element is in a frame [verified: `src/browser/integratedBrowser.ts:36-44`];
  - the snapshot reads `Accessibility.getFullAXTree` with no frame id [verified: `:253`];
  - whether that includes elements inside same-site frames is unknown [unverified: Part 4 probe].
- **Terminal:**
  - `credentialFile` hides recorded output [verified: `src/terminal/history.ts:45-49,167-169`];
  - VS Code's last-command text is passed through after `scrub` only [verified: `src/terminal/readTools.ts:48-51`];
  - VS Code's tool writes the command after a fixed line, "The following is the last command run in the terminal:" (or "…is currently executing…") [verified: VS Code 1.142 `workbench.desktop.main.js`, tool `terminal_last_command`];
  - the selection is returned as is [verified: `src/terminal/readTools.ts:65-68`].
- **Key presses in webviews:** VS Code forwards every key press in a webview to its own keybindings, even ones the page handles [verified: VS Code 1.142 `webview/browser/pre/index.html:603-623`]. So Cmd+W in kernl's panel today closes the active editor. Shortcuts must be VS Code keybindings limited to kernl's panel.

## Options considered (the one real choice: commands everywhere)

| | A: one shared command module; the host runs every command (recommended) | B: outside text goes through the panel |
| --- | --- | --- |
| How | `panelCommands.ts` moves to `src/ui/` with a pure `commandAvailable(view)`; the host runs all commands; the panel only shows the menu and posts `runCommand` | Ask kernl and `@kernl` hand the text to the panel, which runs `commandFor` and either runs the command or sends |
| One owner | yes: matching, availability, and running each have one place | running stays in the panel; the host can't tell `@kernl` what happened |
| `@kernl` reply | "Ran kernl's /new in Main" | can only say "handed to the panel" |
| VS Code chat menu | `@kernl` declares the commands, so VS Code's own `/` menu lists them | not listed |
| Cost | moderate: move running from the panel to the host | small |
| Completeness | 9/10 | 6/10 |

RECOMMENDATION: A, because it leaves exactly one owner each for "is this a kernl command", "can it run now", and "run it". Every entry point then behaves the same.

## Decisions for M

- **D1, commands everywhere:** option A.
- **D2, tab shortcuts.** These apply only while kernl's panel has focus, so they replace VS Code's own action for that key only there:

  | Keys | Action | VS Code's own action replaced while kernl has focus |
  | --- | --- | --- |
  | Cmd+T / Ctrl+T | New tab | Go to Symbol in Workspace |
  | Cmd+W / Ctrl+W | Close this tab (not the first; asks while working) | Close editor (today it closes an editor even from kernl's panel) |
  | Ctrl+Tab | Next tab | Open next editor in the editor history |
  | Ctrl+Shift+Tab | Previous tab | Open previous editor |

  RECOMMENDATION: all four. They match Cursor's Cmd+T and the browser habits the tab strip copies, and Cmd+W stops closing an editor by accident.
- **D3, the selection rule:** the terminal selection is hidden from the agent when it overlaps the recorded output of a command that names a credential file. When kernl recorded nothing in that terminal, it's hidden when VS Code's own last command names one. RECOMMENDATION: yes. It covers the case kernl can know about without blocking ordinary selections.

## Design

### 1. Commands everywhere (D1 = A)

- **Shared module:** `src/ui/panelCommands.ts` (moved; the panel and host both import it) adds `commandAvailable(command, { view, restricted })`. It is pure and reads only `WorkspaceView` fields:
  - `close` needs `tabOf`;
  - `agent` needs not `running`;
  - `model` needs a model choice (kernl's agent, or a CLI agent's model option);
  - `mode` needs two or more modes and no Restricted Mode.

  The panel's chip-based check goes.
- **The runtime keeps the agent's command names** (`commandNames`), set where it posts them. For kernl's own agent, the names are the host's skill list.
- **Host:**
  - `controller.runCommand(workspace, name)`: the single place commands run (newChat, newTab, closeTab, showSessions, pickHarness, the model picker, the mode picker as an in-panel menu anchored at the mode chip, showConnections, openSettings, showHelp);
  - `PanelToHost` gains `{ type: "runCommand"; workspace; name }`; `newChat`, `showConversations`, and `showHelp` fold into it.
- **Panel:** `runCommand` posts `runCommand`. The menu and typed-command handling stay. The mode menu opens when the host asks (in-panel menu `anchor: "mode"`).
- **Ask kernl / `@kernl`:** `sendFromOutside` runs `commandFor(text, runtime.commandNames)` first:
  - a command runs, and `@kernl` replies "Ran kernl's /new in Main";
  - a refusal is replied;
  - otherwise the text is sent as today.
- **`@kernl` chat commands:** `package.json` `chatParticipants[0].commands` lists kernl's commands, so VS Code's chat shows them after `@kernl /`. `handleKernlRequest` treats `request.command` as `/<command>`. A unit test checks that `package.json` lists exactly `PANEL_COMMANDS`.

### 2. Command hints

- `SkillView` gains `hint?: string`; `acpRunner` keeps `c.input?.hint`.
- An agent's row in the `/` menu shows the hint after its name, muted (`/review [instructions]`). Choosing it still inserts `/review `.

### 3. Shared session reads

- **New `src/agentThreads.ts`:** `AgentThreadReader`, one per window, owned by the controller and passed in `RuntimeHost`.
  - `read(ref)` reads a CLI agent's session (today's `readAgentSession`, moved).
  - It caches by `<agent>:<sessionId>@<updatedAt>`, so a session changed since gets read again.
  - It shares a read already in flight, and keeps at most 20 sessions (oldest dropped).
- **Runtime:** keeps its per-conversation map as "what this conversation saw" (so `read_thread` matches the excerpt), filled from the reader.

### 4. Frames

- **Probe first (test-only):** a page with a same-site iframe holding a button, and an overlay inside the frame. Does `browser_snapshot` list the button? Does `DOM.getBoxModel` give top-page coordinates?
- **If the button is listed:** `HIT_TEST` runs on the top page.
  - It starts at `document.elementFromPoint(x, y)`.
  - While the hit is a same-site `<iframe>`, it moves into it, subtracting the frame's position, and tests again.
  - It reports a cover in the frame, or above it in the page.
  - A frame from another site is reported as "inside a frame kernl can't check", and the click goes ahead with the existing input check.
- **If the button isn't listed:** the snapshot also reads each same-site frame's tree (`Page.getFrameTree`, then `Accessibility.getFullAXTree({ frameId })`), with refs that work as today. Then the hit test above.
- The probe's answer goes into the plan before building.

### 5. Terminal credentials (D3)

- **VS Code's last command:** `readTools` takes the command from VS Code's text (the line after its fixed heading) and applies `credentialFile`. If it names a credential file, the output is replaced with the same "[output hidden: …]" note as recorded commands.
- **Selection:** `TerminalHistory.selectionHidden(selection)` returns a reason when the selection overlaps the recorded output of a credential-naming command in the active terminal. When nothing is recorded there, it checks VS Code's last command. The tool then returns the note instead of the text.

### 6. Tab shortcuts (D2)

- **Commands:** `kernl.newTab`, `kernl.closeTab`, `kernl.nextTab`, `kernl.previousTab`, hidden from the Command Palette except New tab.
- **Keybindings:** `when: focusedView == kernl.panel`. Close also needs `kernl.tabClosable`, a context key the controller sets when the shown tab changes. On the first tab, Cmd+W does nothing in kernl, rather than closing an editor.
- Next and previous wrap around the shown workspace's tabs.

## Risks and mitigations

| Risk | Likelihood | Impact | Mitigation | How we'd notice |
| --- | --- | --- | --- | --- |
| `focusedView` isn't set for webview views | Low | Shortcuts don't fire | Must-verify in M's window (keys can't be pressed by tests); fallback: `activeViewlet`/`view.kernl.panel.visible` plus a focus context key set by the panel's `keyboardFocus` message | M presses Cmd+T |
| VS Code changes its last-command text | Low | The credential check misses | Unmatched text is passed through as today, with a log line; a unit test pins the parser to VS Code 1.142's text | Log |
| Moving command running to the host changes panel behavior | Medium | A command acts differently | The existing webview and VS Code checks stay and must pass unchanged | Suites |
| Frame probe shows frames aren't in the snapshot | Medium | Part 4 grows | Design covers both; the larger path is chosen by the probe, then reported | Probe |
| Cached session reads go stale | Low | An old copy is tagged | Keyed by the agent's `updatedAt` | Unit test |

## Acceptance criteria

- Given Ask kernl, when M types `/new`, then a new chat starts in the shown workspace and nothing is sent.
- Given VS Code's chat, when M types `@kernl /` then the kernl commands are listed, and `@kernl /tab` opens a tab and replies so.
- Given Codex, when M types `/rev`, then the menu shows `/review` with its hint.
- Given two tabs tagging the same Claude Code session, then the session is read once.
- Given a page whose button inside a same-site frame is covered by a banner in that frame, when the agent clicks it, then kernl refuses and names the banner.
- Given `cat .env` run before VS Code started, when the agent reads the terminal, then the output is hidden; given the user selects text from that output, then `terminal_selection` returns the hidden note.
- Given kernl's panel has focus, when M presses Cmd+T, then a tab opens and no editor command runs.

## Rollout and rollback

- No settings, no stored data. Revert the commit to undo. New keybindings apply only when kernl's panel has focus.

## Parts

Parts 2 to 6 are independent of each other. Part 1 and Part 6 both touch `package.json` and `src/controller.ts`, so they run one after the other.

### Part 1: commands everywhere
- [x] Shared module and `commandAvailable`; host `runCommand`; panel posts it; runtime keeps command names; Ask kernl and `@kernl` (`package.json` commands, `request.command`). Done:
  - unit tests: availability from a view; `package.json` commands equal `PANEL_COMMANDS`; `handleKernlRequest` with a command;
  - the existing webview and slash-command VS Code checks pass unchanged;
  - a VS Code check: `sendFromOutside("/new")` starts a new chat and sends nothing.

### Part 2: command hints
- [x] `SkillView.hint`, `acpRunner`, the menu row. Done: a webview test (a row with a hint); an `acpRunner` unit test (the hint is kept).

### Part 3: shared session reads
- [x] `AgentThreadReader`, `RuntimeHost` wiring. Done:
  - unit tests: cache by `updatedAt`, a shared in-flight read, the 20-session limit;
  - a VS Code check: two tabs tag the same fake-agent session and the fake agent logs one load.

### Part 4: frames
- [x] Probe; then the design path it picks. Done: the probe's result written here; a browser VS Code check (a covered button in a frame is refused and named; an uncovered one is clicked).

### Part 5: terminal credentials
- [x] Parser for VS Code's text, the last-command check, `selectionHidden`. Done: unit tests (the parser on VS Code 1.142's text; overlap with recorded credential output; nothing recorded plus VS Code's command).

### Part 6: tab shortcuts
- [x] Commands, keybindings, `kernl.tabClosable`. Done:
  - unit test: `package.json` keybindings have the `when` clauses;
  - a VS Code check: the four commands act on the shown workspace's tabs;
  - must-verify: M presses the keys once in the panel.

### Finish
- [x] Guides (panel, help, terminal and browser), changelog, unit tests, both suites, package, install.

## Standardized review

- **Bottom line:** present as is (0 blocking, 2 must-verify, 1 note).
- **Criteria:**
  - **Goal fidelity:** pass. All six items from M's "small" and "medium" picks.
  - **Current-system accuracy:** pass. Tagged; VS Code internals cited by file.
  - **Scope:** pass. The large group and frames from other sites are excluded.
  - **Architecture:** pass.
    - Commands get one owner each for matching, availability, and running.
    - The session reader is window-level with a per-conversation view.
    - The credential rule stays in `TerminalHistory`.
  - **Sequencing:** pass. Shared files are serialized (Parts 1 and 6).
  - **Completeness:** pass. Docs, changelog, tests per part.
  - **Failure and recovery:** pass. Stale cache, unmatched VS Code text, cross-site frames, the first tab on Cmd+W.
  - **Verification:** violation (finding 1).
  - **Feasibility:** violation (finding 2).
  - **Decision readiness:** pass. D1 to D3.
- **Findings:**
  1. **must-verify:** that `focusedView == kernl.panel` is true while kernl's webview has focus. VS Code's docs describe `focusedView` as the focused view's id, but no test can press a key [unverified: M presses Cmd+T in the panel after install].
  2. **must-verify:** whether elements in same-site frames appear in `browser_snapshot`. This decides Part 4's size [unverified: the Part 4 probe].
  3. **note:** VS Code's last-command text is internal and may change. The parser fails open (the old behavior), with a log line.

## Changes made

- Sign-off: M approved D1 A, D2 all four shortcuts, D3 the selection rule (2026-10-20).
- Part 1:
  - `src/ui/panelCommands.ts` (moved) gains `commandAvailable(command, view, restricted)`;
  - `controller.runCommand` is the one place commands run;
  - the panel posts `{ type: "runCommand" }` (replacing `newChat`, `showConversations`, `showHelp`), and `/mode` comes back as `openModeMenu`, so the panel's own mode menu opens;
  - the runtime keeps `commandNames`, and the host keeps `skillNames`;
  - `sendFromOutside` runs a command first;
  - `@kernl` declares the commands and handles `request.command`.
- Part 2: `SkillView.hint` from ACP `input.hint`; shown muted after an agent row's name.
- Part 3:
  - `src/agentThreads.ts` `AgentThreadCache` (per window; key `<handle>@<updatedAt>`; shared in-flight reads; failures not kept; 20 kept, used longest ago dropped);
  - the runtime's per-tab map is removed, since the version key already gives `read_thread` the same copy the excerpt used.
- Part 4: probe result [verified: test-only probe in a real VS Code 1.142]:
  - a button in a same-site frame was not in the snapshot;
  - `Accessibility.getFullAXTree({ frameId })` returned it;
  - `DOM.getBoxModel` gave top-page coordinates.

  So the larger path was built: `frameTrees()` reads up to 10 frames (a frame from another site comes without a tree and is named as unreadable). `HIT_TEST` walks from the top page into each frame. Click and key arrival checks moved into the element's or the focused frame's window (needed for frame elements to work).
- Part 5: `screenCommand` and `hideScreenCredentials` (VS Code 1.142's fixed heading); `TerminalHistory.selectionHidden`; one owner for the "[output hidden …]" note.
- Part 6:
  - `kernl.newTab`, `kernl.closeTab`, `kernl.nextTab`, `kernl.previousTab`;
  - keybindings with `focusedView == kernl.panel`;
  - `kernl.tabClosable`, set on focus; Cmd+W on the first tab is bound to VS Code's `noop` [verified: VS Code 1.142 registers `noop`].
- Deviations:
  - the per-tab session map was removed rather than kept;
  - no log line for unmatched VS Code text (unmatched is the normal "nothing ran yet" case);
  - existing tests changed where the panel's message shape changed (`runCommand`).

## Open questions

- D1 to D3 above.
