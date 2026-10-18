# Panel redesign: a sleek, native-feeling YourStack panel

- Date: 2026-10-18 15:30
- Status: done
- Repos: yourstack   Folders: src/webview, src/ui, media, test   Files: `src/webview/main.ts`, `src/webview/icons.ts` (new), `media/panel.css`, `src/ui/protocol.ts`, `src/controller.ts`, `src/workspaces/commands.ts`, `src/modelPicker.ts` (new), `src/extension.ts`, `package.json`, `test/unit/webview.test.ts`, `test/unit/webviewSafety.test.ts`, `test/vscode/suite.ts`, `test/live/liveSuite.ts`, `README.md`
- Subagents: none

## Context and problem

The panel works but looks like a debug form. It stacks a status line, a tab row, a header with a dropdown and three buttons, the transcript, a token line, a plain textarea, and three grey buttons. M wants it modern and sleek, modeled on VS Code's own Chat view (screenshot, 2026-10-18):

- an empty state;
- one rounded composer with its controls inside;
- small chips in the footer;
- icon actions in the view's title bar.

M chose (2026-10-18):

1. New chat and New workspace become native title-bar icons.
2. Workspaces move to a picker chip in the footer.
3. The model chip is clickable and switches provider and model.
4. Icons are inline SVG.

## Goals / Non-goals

Goals:

- **Title bar:** VS Code's native view title bar shows New chat (`+`) and New workspace (branch icon). A `...` menu holds Set API key, Add custom provider, Use DeepSeek for Claude Code, Clear stored keys, and Open settings.
- **Empty state:** an icon, "Build with YourStack", and the active agent's disclosure (for example "Claude Code runs approved actions itself, in Manual mode: every edit and command asks first"). It shows until the active workspace has a message. The disclosure also stays as the mode chip's tooltip, so it is never only in a tooltip.
- **Composer:** one rounded box (focus ring on focus) with the placeholder "Describe what to build". Inside its toolbar:
  - the agent picker (a chip-styled `<select>`);
  - the model chip (Deep Agents only), which opens a provider and model picker;
  - one icon button that is Send when idle and Stop while running.
- **Footer row:**
  - the workspace chip (label, branch icon on worktrees, a dot when another workspace is running or waiting on a card), which opens a workspace menu;
  - the mode chip (shield icon, "Asks first", or "Read-only" in Restricted Mode; the tooltip is the agent's disclosure);
  - the token count, right-aligned.
- **Workspace menu** (a native QuickPick): switch workspace (with running and waiting state), New workspace, and on a worktree, Review, Merge, Discard.
- **Model menu** (native QuickPick): built-in and custom providers, then a model id (pre-filled). Writes `yourstack.provider` and `yourstack.model` at the level where they are currently set (workspace if set there, else user).
- **Transcript polish:** user messages as soft bubbles, tool rows as compact collapsible lines, approval cards as clear bordered cards with a primary Approve, and the setup problem as a banner above the composer with its two buttons. The banner shows only on Deep Agents workspaces, because the problem (provider, key) concerns Deep Agents only; today it shows for every agent.
- **Accessibility:** every icon-only button has `aria-label` and `title`; chips are real `<button>`/`<select>` elements reachable by keyboard.
- **Themes:** light, dark, and high contrast through VS Code theme variables only. Works down to a 300 px panel.

Non-goals:

- Mic, attachments, or slash commands (no use case yet).
- Markdown rendering of replies (separate decision; text stays text).
- A custom dropdown component inside the webview (native QuickPicks instead).

## What is true today

| Fact | Evidence |
| --- | --- |
| The panel builds every element with `createElement` + `textContent`; nothing is parsed as HTML | [verified: `src/webview/main.ts:1-15`; `test/unit/webviewSafety.test.ts`] |
| Layout: status, tabs, header (agent select, branch, Review/Merge/Discard, disclosure), logs, usage, composer (textarea, Send, Stop, New chat) | [verified: `src/webview/main.ts:25-41`] |
| Styles: 36 lines, VS Code theme variables only | [verified: `media/panel.css`] |
| CSP: `style-src ${cspSource}`, scripts by nonce, `img-src ${cspSource} data:` | [verified: `src/ui/panel.ts:52-54`] |
| No title-bar actions: `contributes.menus` is empty | [verified: `package.json`] |
| The New chat command clears Main only; the panel's New chat clears the active workspace | [verified: `src/controller.ts:249` `this.workspace(MAIN)?.newThread()`] |
| Review, Merge, Discard, and newWorkspace arrive as panel messages | [verified: `src/controller.ts:176-182`, `src/ui/protocol.ts:59-63`] |
| Tests: 12 jsdom click tests drive the real bundle; the VS Code suite drives the controller with `testing.receive` and `usePrompts` | [verified: `test/unit/webview.test.ts`, `test/vscode/suite.ts:326-330`] |

```
today:   webview buttons --newChat/review/merge/discard/newWorkspace--> controller
         command "New chat" -------------------------------------------> controller (Main only)

after:   title-bar icons / "..." menu -----> commands ----------------> controller (active workspace)
         workspace chip --pickWorkspace---> controller QuickPick ------> switch / new / review / merge / discard
         model chip -------pickModel------> controller QuickPick ------> settings
         panel --focus(workspace)---------> controller remembers the workspace the panel shows   <-- new
```

## Options considered

M settled the four layout options (see Context). One design choice remains: who owns "the active workspace".

| Option | How it works | Tradeoff | Completeness |
| --- | --- | --- | --- |
| A. The panel reports what it shows (recommended) | The panel sends `focus` whenever its displayed workspace changes; commands act on that | One source of truth: what the user sees. A new message type | 9/10 |
| B. The host decides and the panel follows | The host tracks selection; the panel never switches by itself | A card for another workspace could not bring its tab forward without a round trip | 7/10 |

RECOMMENDATION: A, because the title-bar commands must act on the workspace the user is looking at, and only the panel knows that.

## Decision

- Restyle the webview and move workspace and model actions to native QuickPicks and title-bar commands.
- The panel reports its displayed workspace (`focus`).

**Structural reason:** each action lives where VS Code already provides the native control, and "active workspace" has one owner, the panel. The protocol shrinks: `newChat`, `newWorkspace`, `review`, `merge`, and `discard` leave the panel protocol. They become commands or QuickPick items. `focus`, `pickWorkspace`, and `pickModel` join.

## Design

- **`package.json`:**
  - The `newChat` and `newWorkspace` commands get icons (`$(add)`, `$(git-branch)`).
  - Add an `openSettings` command.
  - Add `menus.view/title`: `newChat` and `newWorkspace` in `navigation`; the key and settings commands in the overflow groups. All use `when: view == yourstack.panel`.
- **`src/ui/protocol.ts`:**
  - PanelToHost loses `newChat`, `newWorkspace`, `review`, `merge`, `discard`.
  - It gains `{ type: "focus"; workspace }`, `{ type: "pickWorkspace" }`, `{ type: "pickModel" }`.
  - HostToPanel `workspaces` items gain `waiting: number` (open cards per workspace), so the chip can show a dot. `isPanelToHost` updates.
- **`src/controller.ts`:**
  - Store `active` from `focus`. `newChat()` and the command act on it.
  - `pickWorkspace()`: QuickPick of workspaces (running and waiting shown), "New workspace...", and for a worktree, "Review changes", "Merge into <base>", "Discard...". It reuses the existing `review`/`merge`/`discard` methods and posts `workspaces` with `focus`.
  - `pickModel()` delegates to `src/modelPicker.ts`.
- **`src/modelPicker.ts` (new):** QuickPick of `BUILT_IN_PROVIDERS` plus custom providers (current one marked), then an InputBox for the model id (pre-filled with the current or default). Writes the settings at the level where `yourstack.provider` is set. Uses the `Prompts` seam so the VS Code suite can drive it.
- **`src/webview/icons.ts` (new):** about 8 constant SVG path strings (send, stop, chevron, branch, shield, sparkle, plus, warning). They are built with `createElementNS` and `setAttribute` from constants only, never from host data.
- **`src/webview/main.ts`:** new layout (below); same message handling. Each pane keeps its own log; the empty state shows when the active log is empty.
- **`media/panel.css`:** rewritten around theme variables (`--vscode-input-background`, `--vscode-input-border`, `--vscode-focusBorder`, `--vscode-widget-border`, `--vscode-contrastBorder`, `--vscode-descriptionForeground`, `--vscode-badge-*`, `--vscode-button-*`). Radius 6 to 8 px, 8 px spacing scale.

```
 YOURSTACK: AGENT                (+) (branch) (...)     <- native title bar
 ------------------------------------------------------
 [warning] No API key stored for deepseek.  [Set API key] [Open settings]   <- only when there is a problem
                  [sparkle]
             Build with YourStack                       <- empty state
   Every edit and command asks you first.

   ...transcript (user bubble, assistant text, tool rows, cards)...
 .----------------------------------------------------.
 | Describe what to build                             |
 | (Claude Code v)  (deepseek · deepseek-flash v)  [^]|  <- send / stop
 '----------------------------------------------------'
  (Main v *)  (shield Asks first)            1.2k tokens
```

## Risks and mitigations

| Risk | Likelihood | Impact | Mitigation | How we'd notice |
| --- | --- | --- | --- | --- |
| Native QuickPicks hide that another workspace needs attention | Medium | Medium | Dot and count on the workspace chip; a card still brings its workspace forward | Click test: the chip shows a waiting count |
| Theme variables missing in some themes (high contrast) | Low | Low | Fallbacks in `var(..., fallback)`; `contrastBorder` outlines | Visual check in the light, dark, and high-contrast previews |
| Removing protocol messages breaks a caller | Low | Medium | `tsc` across src and test; VS Code suite drives the new commands | Typecheck and suite fail |
| SVG becomes an injection path | Low | High | Paths are constants in `icons.ts`; `webviewSafety` test extended to forbid `innerHTML` there too | Unit test |
| Settings written at an unexpected level by the model picker | Medium | Low | Write where `yourstack.provider` is already set; documented | VS Code check |

## Acceptance criteria

- **Title bar:** given the panel is open, when M clicks `+`, then the active workspace's chat clears. The `...` menu lists the five key and settings actions.
- **Empty state:** given a workspace with no messages, then the empty state shows. After the first message, it does not.
- **Composer:** given idle, the icon button sends (Enter too; Shift+Enter makes a newline). Given running, the same button stops, and the agent select is disabled.
- **Workspace chip:** given two workspaces with one waiting on a card, the chip shows a waiting dot. Clicking it opens a QuickPick to switch, create, review, merge, or discard, and each item does what today's buttons do.
- **Model chip:** given Deep Agents, clicking it lets M pick a provider and model, and the settings change. Given a CLI agent, the chip is hidden.
- **Safety:** model, file, and page text still never becomes HTML (the existing test plus the new elements).
- **Looks:** screenshots in dark, light, and high-contrast previews, at 300 px and 500 px wide, match the layout above.

## Rollout and rollback

- Ships in the next VSIX. No settings or data change.
- Rollback: reinstall the previous VSIX.

## Parts

Parts 1 and 2 keep the build green on their own: Part 1 only adds protocol messages, and Part 2 removes the old ones once the webview stops sending them.

### Part 1: Host side: protocol, active workspace, commands, QuickPicks

- [x] Add `focus`, `pickWorkspace`, `pickModel`, and `waiting` (old messages stay for now); New chat on the active workspace; title-bar and overflow menus; `pickWorkspace`; `pickModel` (`src/modelPicker.ts`). Done when `tsc` passes and VS Code checks drive New chat, switch, new, review, merge, discard, and model picking through commands and prompts.

### Part 2: Webview layout and styles

- [x] `icons.ts`, new layout in `main.ts`, rewritten `panel.css`; remove `newChat`, `newWorkspace`, `review`, `merge`, `discard` from the panel protocol and move the VS Code and live suites to the commands and QuickPicks. Done when the jsdom click tests cover the empty state, composer send/stop, agent select, model chip, workspace chip (including the waiting dot), problem banner, cards, and HTML safety.

### Part 3: Visual check, regression, package

- [x] Preview the real bundle in the browser pane with a fake host in dark, light, and high contrast at 300 px and 500 px; screenshots to M. Unit, VS Code (dev and minified), VSIX, reinstall, README. Done when all pass and M has seen the screenshots.

## Standardized review

Reviewed with the plan rubric against the current code (`src/webview/main.ts`, `src/ui/protocol.ts`, `src/controller.ts`, `package.json`, the three test suites).

- **Findings, all fixed in this file before presenting:**
  1. **Must-verify, fixed (current-system accuracy):** the live suite also sends `newChat` (`test/live/liveSuite.ts:77,104,116`), so it is now in the file list and in Part 2.
  2. **Blocking, fixed (failure and recovery):** moving the agent disclosure into a tooltip would hide a safety statement (CLI agents act on their own after approval). It now shows in the empty state and stays in the tooltip.
  3. **Must-verify, fixed (sequencing):** removing protocol messages in Part 1 would break the webview build until Part 2. Part 1 is now additive; Part 2 removes.
  4. **Note, fixed (scope):** the setup-problem banner concerns Deep Agents only; it now shows only there (a small, stated behavior change).
  5. **Note, fixed (completeness):** accessibility (labels, keyboard) added to Goals.
- **Criteria:** goal fidelity pass (matches M's four choices); current-system accuracy pass (claims tagged); scope pass (mic, attachments, markdown excluded); dependency direction pass (native controls in the host, display in the webview); sequencing pass after fix 3; completeness pass (docs, tests, rollback); failure and recovery pass (no data change; rollback by VSIX); verification pass (click tests, VS Code checks, screenshots); feasibility pass (all files exist or are marked new); decision readiness pass (no open questions).
- **Unverified, checked in Part 3:** how the native title-bar icons look next to the webview (seen only in a real VS Code window; M's visual check).

## Changes made

- Part 1: panel messages `focus`, `pickWorkspace`, `pickModel`; `waiting` and an always-present `disclosure` on each workspace; New chat acts on the workspace the panel shows; title-bar icons and a `...` menu; workspace QuickPick (switch, new, review, merge, discard); `src/modelPicker.ts`; `testingApi().activeWorkspace` so tests can wait for the real panel's focus report.
- Part 2: `src/webview/icons.ts`; new layout in `src/webview/main.ts` (empty state with disclosure, banner on Deep Agents only, composer with agent picker, model chip, send/stop button, footer chips); `media/panel.css` rewritten on theme variables; `newChat`, `newWorkspace`, `review`, `merge`, `discard` removed from the panel protocol; the HTML-safety test now covers every webview file. Polish after the first screenshots: the agent picker got a chevron, and the model chip shows the model name with the provider in its tooltip.
- Part 3: real bundle previewed with a fake host in Dark Modern, Light Modern, and High Contrast colors at 300 and 500 px (screenshots sent to M). Unit 99/99; VS Code 30/30 on dev and minified bundles; README "The panel" section; `yourstack.vsix` packaged and installed (installed panel files match the VSIX). The live suite was edited (New chat via the command) but not rerun here, because Claude Code can't sign in from this session's shell; M runs it from a terminal.

## Open questions

None. The four layout choices were decided by M on 2026-10-18.
