# kernl's own slash commands in the panel

- Date: 2026-10-20 13:10
- Status: done (window check pending)
- Repos: kernl   Folders: `src/webview/`, `src/ui/`, `src/`, `test/`   Files: new `src/webview/panelCommands.ts`, `src/webview/main.ts`, `src/webview/attachments.ts`, `src/ui/protocol.ts`, `src/controller.ts`, `test/unit/panelCommands.test.ts` (new), `test/unit/webview.test.ts`, the VS Code suite, `docs/guides/panel.md`, `CHANGELOG.md`
- Subagents: none
- Research: `docs/research/2026-10-20-1303_panel-slash-commands_research.md`

## Context and problem

The `/` menu in kernl's message box lists only skills (for kernl's agent) or the agent's own commands (for Claude Code, Codex, OpenCode). Panel actions are reachable only by buttons and title-bar icons: new chat, new tab, Conversations, choosing the agent, model, or mode.

Two gaps follow:
- People coming from Claude Code or Codex type `/clear`, `/new`, `/resume`, or `/model`. kernl sends that text to the agent as a message.
- Claude Code over ACP doesn't offer `/clear`, and neither agent offers a new-chat command. So nothing the agent offers can start a new chat [verified: research file, "What is true today"].

## Goals / Non-goals

- **Goal:** the `/` menu also lists kernl's own commands, marked as kernl's, for every agent.
- **Goal:** Enter on a kernl command runs its action at once (even while the agent works), clears the box, and sends nothing to the agent.
- **Goal:** a command the agent offers keeps reaching the agent. On a name clash the agent wins, and kernl's command is reachable as `/kernl:<name>`.
- **Goal:** text that isn't a known command (for example `/usr/bin is missing`) is sent as today.
- **Non-goal:** commands typed into Ask kernl or `@kernl` in VS Code's chat. Those send text as today.
- **Non-goal:** arguments (`/model sonnet`). Each command opens the same picker its button opens.
- **Non-goal:** `/fork` and `/compact`. Fork already has the send menu's "send in a fork" and each reply's Fork button. Compacting is the agent's own command (Claude Code and Codex offer `/compact`).
- **Non-goal:** showing ACP's `input.hint`. It's a separate improvement.

## What is true today

- **The menu:** it opens when the text before the caret is `/` plus letters. Picking a row inserts `/name ` [verified: `src/webview/attachments.ts:20,212-215`]. Its list is kernl's skills or `p.commands` (the agent's commands), chosen by harness (the agent the tab runs) [verified: `src/webview/main.ts:609-613`].
- **Submit:** trims the text, clears the box, and posts `send` [verified: `src/webview/main.ts:569-580`].
- **Actions the panel can already start:**
  - `newTab` and `closeTab` (the host asks before closing a working tab);
  - `pickHarness`;
  - the model chip: `pickModel` for kernl's agent, `pickAgentOption` with the chip's option for a CLI agent;
  - the mode chip's in-panel menu;
  - `showConnections` and `openSettings`

  [verified: `src/ui/protocol.ts:257-326`; `src/webview/main.ts:190-197,649-652`; `src/controller.ts:519-522`].
- **Host-only actions:** New chat (`controller.newChat()`, the shown workspace) and Conversations (`controller.showSessions()`) are reached only through VS Code commands [verified: `src/controller.ts:986,1647-1650`; `package.json:95-148`].
- **New chat while running:** saves the conversation, then stops the turn without asking. Both runners call `stop()` in `newThread()` [verified: `src/workspaceRuntime.ts:588-596`, `src/agent/session.ts:221-222`, `src/acp/acpRunner.ts:233-234`].

```
Enter in the message box
   -> submit(): trim, clear the box, post "send"      <-- every "/..." goes here today
   -> host: run now, or queue while the agent works
   -> the agent gets the text
```

## Options considered

Detailed in the research file. Summary:

| | A: the host checks sent text | B: the panel recognizes kernl commands (recommended) | C: a separate prefix |
| --- | --- | --- | --- |
| How | the host intercepts kernl names in `send` | a webview module lists the commands; submit runs the action instead of sending | kernl commands use `//` or `>` |
| When it fails | a command typed while running is queued; the mode and model menus live in the panel | Ask kernl and `@kernl` don't get commands | habits from Claude Code and Codex go to the agent |
| Completeness | 6/10 | 9/10 | 5/10 |

RECOMMENDATION: B, because the panel already holds both lists and every action's handler, so a command runs at once and never takes the agent's command.

## Decisions for M

- **D1, approach:** B (above).
- **D2, the command set:** the nine commands below. Each is an existing button or title-bar action.
- **D3, `/new` while the agent works:**

  | | Ask first (recommended) | Same as today's title-bar button |
  | --- | --- | --- |
  | How | `controller.newChat` asks "Stop the agent and start a new chat?" when the workspace is running. This covers the title bar, the kernl menu, and `/new` | stops the turn without asking |
  | Why | matches Close tab, which already asks; a typo can't stop a long run | no new prompt |
  | Changes the title bar | yes (it asks too) | no |
  | Completeness | 9/10 | 7/10 |

  RECOMMENDATION: ask first, because New chat and Close tab both end a running turn and should behave alike. The question belongs in the host, which every entry point shares.
- **D4, name clashes:** the agent's command wins. kernl's shows in the menu as `/kernl:<name>`, and typing `/kernl:<name>` always runs kernl's.

## Design

### The commands (D2)

| Command | Aliases | Does | Shown when |
| --- | --- | --- | --- |
| `/new` | `/clear` | New chat in this tab (D3) | always |
| `/tab` | | New tab | always |
| `/close` | | Close this tab (asks when working, as today) | not the first tab |
| `/conversations` | `/resume` | Open the Conversations view | always |
| `/agent` | | Choose agent (the agent chip) | always |
| `/model` | | Choose model (the model chip) | the model chip is shown |
| `/mode` | | Permission mode menu (the mode chip) | the mode chip is choosable |
| `/connections` | | Show connections | always |
| `/settings` | | kernl settings | always |

### Panel (`src/webview/panelCommands.ts`, new)

- **List:** `PANEL_COMMANDS: { name, aliases, description }[]` holds the table above. It's the one place the names live.
- **Matching:** `commandFor(text, agentNames)` is pure. It returns the kernl command a message names, a refusal, or nothing:
  - `/kernl:<name or alias>` -> that command;
  - `/<name or alias>` that isn't in `agentNames` -> that command;
  - a kernl name followed by more text -> a refusal: "`/new` takes nothing after it". The text stays in the box;
  - anything else -> nothing, and the text is sent as today.
- **Menu rows:** `menuRows(query, agentNames)` returns kernl's rows filtered by name or alias prefix. Each row's detail ends with "kernl". A name the agent also offers is shown as `/kernl:<name>`.
- `agentNames` is the tab's agent commands, or kernl's skill names for kernl's agent.

### Wiring (`src/webview/main.ts`, `src/webview/attachments.ts`)

- **Menu:** the `/` menu shows kernl's available rows first, then the agent's commands or skills, as today. The popover takes the combined list. The menu always has kernl rows, so it opens for every agent.
- **Submit:** before clearing the box, call `commandFor`.
  - On a command, run it, clear the box, and save the draft.
  - On a refusal, show it as a note in the transcript and keep the text.
  - Otherwise, send as today.
- **Running a command** reuses the existing handlers:
  - `newTab`, `closeTab`, `pickHarness`, `showConnections`, and `openSettings` post their messages;
  - `/model` and `/mode` do what a click on the chip does;
  - `/new` and `/conversations` post the two new messages.
- **Unavailable commands** are left out of the menu. Typing one in full gives a note ("This agent has no model choice here"), and the text stays.

### Protocol and host

- `PanelToHost` gains `{ type: "newChat"; workspace: string }` and `{ type: "showConversations" }`, both added to `PANEL_MESSAGE_TYPES`.
- `controller.newChat(id = this.active)` acts on the given workspace. With D3 it asks when that workspace is running.
- `"showConversations"` calls `showSessions()`.

### Changed flow

```
Enter in the message box
   -> commandFor(text, the agent's names)                          <-- new
        kernl command -> run the action, clear the box             <-- new
        refusal       -> note, keep the text                       <-- new
        nothing       -> submit as today (send / queue)
```

## Risks and mitigations

| Risk | Likelihood | Impact | Mitigation | How we'd notice |
| --- | --- | --- | --- | --- |
| A kernl name hides an agent command added later | Medium | The agent's command is unreachable | The agent wins on every clash, checked against the live list | Unit test |
| The agent's list arrives after the user typed `/model` | Low | kernl's picker opens instead of the agent's command | kernl starts the shown tab's agent session when the panel is visible, and the adapter sends its list after the session starts [inferred: `src/controller.ts` `prepareShown`; claude-agent-acp `sendAvailableCommandsUpdate`]; `/kernl:` makes intent explicit | Webview test |
| A message starting with a path is taken as a command | Low | The message isn't sent | Only exact names and aliases match | Unit test |
| `/new` asking first annoys title-bar users | Low | One more click | It asks only while the agent works | User |

## Acceptance criteria

- Given any agent, when M types `/`, then kernl's commands are listed with "kernl", followed by the agent's commands or skills.
- Given Claude Code is working, when M types `/new` and presses Enter, then kernl asks "Stop the agent and start a new chat?". Confirming saves the conversation and opens an empty one. Nothing is sent to Claude Code.
- Given an agent that offers `/model`, when M types `/model` and Enter, then the text goes to the agent. The menu shows kernl's as `/kernl:model`, which opens kernl's picker.
- Given `/new fix the bug`, when M presses Enter, then a note says `/new` takes nothing after it, and the text stays in the box.
- Given `/usr/bin is missing`, when M presses Enter, then it's sent to the agent as today.
- Given the first tab, when M types `/clo`, then `/close` isn't listed.

## Rollout and rollback

- No settings or stored data. Revert the commit to undo. The panel and the host ship in the same build, so no older side ever receives the two new messages.

## Parts

### Part 1: command list and matching
- [x] `src/webview/panelCommands.ts` with `PANEL_COMMANDS`, `commandFor`, `menuRows`. Done: unit tests for exact names, aliases, `/kernl:`, an agent clash, trailing text, a path, and an unknown name.

### Part 2: panel and host wiring
- [x] The menu shows kernl rows; submit runs commands; unavailable commands are hidden; the two new messages; `newChat(id)` asks when running (D3). Done: webview test (menu rows, Enter on `/new` posts `newChat` and clears the box, `/mode` opens the mode menu, a clash sends text, a refusal keeps the text). A VS Code check: `/new` through the panel starts an empty conversation; `/conversations` opens the view.

### Finish
- [x] Guide (`docs/guides/panel.md`), changelog, unit tests, both suites, package, install.

## Standardized review

- **Bottom line:** present as is (0 blocking, 1 must-verify, 1 note).
- **Criteria:**
  - **Goal fidelity:** pass. Built-in commands for kernl's panel, as M asked.
  - **Current-system accuracy:** pass. Every claim tagged with a file and line.
  - **Scope and cohesion:** pass. Only existing actions; arguments, fork, compact, and outside entry points are excluded with reasons.
  - **Architecture:** pass.
    - The panel owns the composer and holds both lists.
    - The host owns New chat's question, which every entry point shares.
    - The names live in one module.
  - **Sequencing:** pass. Part 2 depends on Part 1's pure functions.
  - **Completeness:** pass. Docs, changelog, tests.
  - **Failure and recovery:** pass. Clashes, a late list, trailing text, paths, unavailable commands, a running agent.
  - **Verification:** pass. Each part has a test that fails if the behavior is wrong.
  - **Feasibility:** violation (finding 1).
  - **Decision readiness:** pass. D1 to D4 surfaced.
- **Findings:**
  1. **must-verify:** whether Claude Code over ACP offers `/model` or `/resume`. If it does, those reach Claude Code and kernl's show as `/kernl:model` and `/kernl:conversations`. That is the intended rule, but it changes what M sees in a Claude Code tab [unverified: type `/` in a Claude Code tab in M's window].
  2. **note:** D3 changes the title bar's New chat (it will ask while the agent works). This is the reason it's a decision for M.

## Changes made

- Sign-off: M approved D1 B, D2 the nine commands, D3 New chat asks first while the agent works, D4 the agent wins a clash (2026-10-20).
- Part 1: `src/webview/panelCommands.ts` (`PANEL_COMMANDS`, `commandFor`, `menuRows`); unit tests (6).
- Part 2: the `/` menu takes rows from the panel (`setSlashRows`; `/` plus `:` for `/kernl:`); submit runs a kernl command or shows why not; `newChat` and `showConversations` messages; `controller.newChat(id)` asks while running. Webview test and a VS Code check.
- Deviations from the design:
  - choosing a kernl command in the menu runs it at once (it takes no text, so one Enter);
  - an exact name match is listed first (typing `/mode` listed `/model` first);
  - an alias the agent offers doesn't match kernl's row, so Enter on `/res` picks the agent's `/resume`;
  - `/agent` is unavailable while the agent works (its chip is disabled then);
  - `webviewSafety`'s file list gained `panelCommands.ts`.

## Open questions

- D1 to D4 above.
