# Accurate, robust terminal and browser integration

- Date: 2026-10-19 16:25
- Status: done
- Repos: kernl   Folders: `src/terminal/`, `src/browser/`, `src/`, `test/`   Files: new `src/terminal/history.ts`, `src/terminal/readTools.ts`, `src/terminal/coreTools.ts`, `src/browser/snapshot.ts`, `docs/guides/terminal-and-browser.md`; changed `src/terminal/runner.ts`, `src/terminal/tool.ts`, `src/browser/integratedBrowser.ts`, `src/browser/tools.ts`, `src/browser/describe.ts`, `src/workspaceRuntime.ts`, `src/extension.ts`, `package.json`, tests, docs
- Subagents: none (parts are independent; sessions can be offered after sign-off)
- Research: `docs/research/2026-10-19-1620_terminal-browser-integration_research.md`

## Context and problem

M asked Claude Code in kernl to "check the terminal and tell me what is the content in it". It couldn't: kernl's tools only run new commands in kernl's own terminal. The browser works, but its actions rely on CSS selectors the model guesses, synthetic clicks, and typing that some pages ignore. M wants both integrations very accurate and robust.

## Goals / Non-goals

- **Goal:** an agent can list the window's terminals and read the commands run in any of them (the user's own too) with their output, exit code, and folder, since VS Code started.
- **Goal:** an agent can read the active terminal's last command and the user's selection in it, where VS Code allows.
- **Goal:** commands kernl runs finish reliably: with or without shell integration, and a command that waits for input is reported (and can be answered) instead of hanging.
- **Goal:** browser actions hit the right element and behave like a person's: references from an accessibility snapshot, real mouse and keyboard input, waits for the page, console and network errors reported.
- **Non-goal:** reading output from before VS Code started, or from terminals with no shell integration (no stable API can [research]).
- **Non-goal:** proposed VS Code APIs (they don't work in a normally installed VSIX [research]).
- **Non-goal:** typing into the user's own terminals (only kernl's terminals run agent commands).

## What is true today

See the research file's table [verified there]: no read tool; `run_in_terminal` only through shell integration with no fallback and no input-wait detection; kernl not active at startup; browser tools on CSS selectors, `el.click()`, `.value =`, `innerText`.

```
user's terminal ──commands──> (nobody listens)                         <-- nothing to read
agent ──run_in_terminal──> kernl terminal ──shell integration?──no──> "did not run"   <-- no fallback
                                           └─yes─> waits for end ──input prompt──> hangs to 120 s   <-- no input detection
agent ──browser_click "#guess"──> el.click()                           <-- guessed selector, synthetic click
```

## Options considered

### D1: reading what's in the terminals

| | A: record commands as they run (recommended base) | B: A + VS Code's own active-terminal tools (recommended) | C: select all and copy |
| --- | --- | --- | --- |
| How | listen to every terminal's shell executions from startup; keep each terminal's recent commands with output (rendered through a headless terminal emulator so progress bars and colors come out as text) | A, plus `terminal_last_command` and `terminal_selection` from VS Code core through `vscode.lm.invokeTool`, used only when present | run VS Code's select-all and copy commands on the terminal, read the clipboard |
| Reads | every command since startup, in every terminal with shell integration | plus the active terminal's screen-level last command and the user's selection | the whole visible buffer |
| Fails when | no shell integration in that terminal; commands from before startup | core renames its tools (detected at runtime; A still works) | always overwrites the user's clipboard |
| Completeness | 8/10 | 9/10 | 5/10 |

RECOMMENDATION: B because A covers every terminal reliably and the core tools add the screen and selection where they exist, without touching the clipboard.

### D2: starting kernl at VS Code startup

| | A: activate on startup, recorder first (recommended) | B: activate when the panel opens (today) |
| --- | --- | --- |
| Effect | commands are recorded from the start; kernl's other startup work (connections checks) also runs at startup | commands before the panel opened are never seen |
| Completeness | 9/10 | 5/10 |

RECOMMENDATION: A because "what's in my terminal" usually means what ran before you asked.

### D3: reading terminal output: card or not

| | A: no card, secrets scrubbed (recommended) | B: ask each time |
| --- | --- | --- |
| How | reading is like reading a file or a page: it doesn't change anything; kernl's known secrets (stored keys, header values) are scrubbed from the output | a card for each read |
| Completeness | 8/10 | 6/10 (a card for every look) |

RECOMMENDATION: A because reading changes nothing, and the same rule applies to reading pages and files today.

### D4: browser accuracy

| | A: accessibility snapshot with element references (recommended) | B: keep CSS selectors, add waits |
| --- | --- | --- |
| How | `browser_snapshot` returns the page as an outline (role, name, value) with a ref per element; actions take a ref (or a selector as a fallback); clicks and typing use real input events at the element's position; actions wait for the page to settle; console errors and failed requests are reported | waits after actions; native value setter for inputs |
| Matches | Playwright MCP and VS Code's own browser tools [research] | |
| Completeness | 9/10 | 6/10 |

RECOMMENDATION: A because references come from what's on the page, so the model never guesses a selector.

## Decision

M approved D1 B, D2 A, D3 A, D4 A on 2026-10-19: record shell executions in every terminal plus VS Code's core active-terminal tools when present; activate at startup; no card for reading, known secrets scrubbed; browser through accessibility-snapshot refs, real input, waits, and console and network capture.

## Design

### Part 1: terminal history and read tools

- `src/terminal/history.ts`: on activation, listens to `onDidStartTerminalShellExecution` for every terminal, calls `read()` in the same tick (so no output is missed [research]), renders the stream through `@xterm/headless` (escape codes, carriage-return progress bars, and redraws become plain text), and keeps per terminal the last 30 commands: command line (and how sure VS Code is of it), folder, start and end time, exit code (or "unknown"), output tail (10,000 characters each). Running commands are included, marked running.
- Tools (kernl's own agent, and CLI agents through kernl's MCP server):
  - `terminal_list`: each terminal's name, shell, folder, whether shell integration is on, whether a command is running, and its last command with exit code.
  - `terminal_read`: a terminal (by name or "active"), the last N commands (default 5) with output.
  - Output is untrusted data (labeled like page text) and passes through kernl's redactor.
- Without shell integration in a terminal, `terminal_list` says so, and `terminal_read` explains why nothing is recorded and how to turn it on.

### Part 2: VS Code's active-terminal tools

- At first use, kernl looks for VS Code's `terminal_last_command` and `terminal_selection` in `vscode.lm.tools`; when present, `terminal_read` with "active" adds the screen-level last command, and a `terminal_selection` tool returns the user's selected text. When absent (renamed, AI features off), these parts say so and Part 1 still works. Live check on 1.142.

### Part 3: robust command runs

- **Input waits:** while a command runs, if output stops for 3 s and its last line looks like a prompt (`?`, `:`, `[y/N]`, `password`, `Press any key`), `run_in_terminal` returns early: "waiting for input: <last line>", with the command still running.
- **`terminal_send_input`** (asks, like a command): types a line (or Ctrl+C) into kernl's terminal for that waiting command; returns the output that follows.
- **Without shell integration:** kernl runs the command through a small wrapper script in kernl's terminal that copies the output to a file and writes the exit code to another (`sh`-compatible shells; PowerShell variant), and reads them; the user still sees it run. Replaces "the command did not run".
- **Stale exit codes:** an exit 130 from kernl's own Ctrl+C is reported as "stopped", not as a failure [research: core does this].

### Part 4: accurate browser

- `browser_snapshot`: the page as an outline from CDP's accessibility tree (role, name, value, checked, ref), limited to what's visible plus headings and landmarks; refs stay valid until the next snapshot or navigation.
- Actions take `ref` (or `selector`, kept for compatibility): click (scroll into view, real mouse events at the element's center), type (focus, select existing text, real key input; Enter optional), press a key, scroll, go back. After each action kernl waits for navigation or network quiet (up to the browser timeout) and returns the new URL and title.
- `browser_read_page` keeps text but adds the snapshot's headings; console errors and failed requests since the last action are appended to each result.
- Approval cards and rows describe refs by the element's role and name ("Click button 'Accept All Cookies'").
- Must-verify first: CDP `Accessibility` and `Input` through js-debug's proxy (a 30-minute spike; if it fails, fall back to DOM-based refs with a native value setter and pointer events from page script).

## Risks and mitigations

| Risk | Likelihood | Impact | Mitigation | How we'd notice |
| --- | --- | --- | --- | --- |
| Activating at startup slows VS Code start | Low | A little startup time | The recorder registers first; heavy work stays lazy; measure activation time before and after | Activation time in the log |
| `read()` misses output in a busy window | Low [inferred] | A command's start is cut | Called in the same tick as the start event (as VS Code's own code relies on); a unit test with a fake event source | Test; live check |
| Terminal output contains secrets kernl doesn't know | Medium | Sent to the model provider | Untrusted label; redactor for known secrets; D3 lets M choose cards instead | Review of a recorded read |
| Core terminal tools renamed | Medium | Part 2 silently off | Runtime detection, a log line, Part 1 unaffected | Log |
| CDP accessibility not reachable through js-debug | Medium [unverified] | Part 4 needs the DOM fallback | Spike first; fallback designed | Spike result |
| Prompt detection false positives | Medium | A command returns early as "waiting" while still working | 3 s quiet plus prompt-shaped last line; the command keeps running and `terminal_read` shows its progress | Tests with fake commands |

## Acceptance criteria

- Given `npm test` run by M in their own terminal, when the agent is asked what's in the terminal, then it reads that command, its output, and exit code.
- Given a terminal without shell integration, then `terminal_list` says so, and `run_in_terminal` still runs commands in kernl's terminal through the fallback, with output and exit code.
- Given a command that asks "Continue? [y/N]", then `run_in_terminal` returns within about 3 s saying it's waiting, and `terminal_send_input "y"` continues it.
- Given a page with a cookie banner, when the agent snapshots and clicks the "Accept All Cookies" ref, then the banner closes (real click), and the result shows the page after it settled.
- Given a React form, when the agent types into a field by ref, then the page's state has the text (the form validates it).

## Rollout and rollback

- No settings beyond existing ones; `kernl.terminal.cliAgents` and `kernl.browser.cliAgents` still turn the CLI agents' access off. Each part reverts on its own.

## Parts

### Part 1: terminal history and read tools
- [x] Recorder, headless rendering, `terminal_list`, `terminal_read`, startup activation. Done: unit tests (recording from fake executions, rendering of progress bars and colors, limits, redaction); VS Code check (a command run in a user terminal is read back with its exit code).

### Part 2: VS Code's active-terminal tools
- [x] Detection and use of `terminal_last_command` / `terminal_selection`. Done: unit test with a fake tool registry; live check on 1.142 (M's OK).

### Part 3: robust command runs
- [x] Input-wait detection, `terminal_send_input`, fallback runner, stale exit codes. Done: VS Code checks (a prompting command returns as waiting and continues after input; a terminal without shell integration runs through the fallback with an exit code).

### Part 4: accurate browser
- [x] Spike CDP accessibility and input; snapshot, refs, real input, waits, console and network; describer for refs. Done: VS Code checks on a local test page (cookie banner, React-like controlled input, a link that navigates, a console error).

### Finish
- [x] Docs (terminal and browser guide), changelog, suites, package, install, window check.

## Standardized review

- **Bottom line:** executable after four decisions; no blocking findings.
- **Criteria:** goal fidelity pass (the reported failure, plus robustness M asked for); current-system accuracy pass (tagged); scope pass (stable APIs only); architecture pass (recording in `src/terminal`, browser mechanism stays inside `integratedBrowser.ts`); sequencing pass (independent parts; Part 4 starts with its spike); completeness pass; failure handling pass (no shell integration, renamed core tools, CDP fallback, prompt false positives); verification pass (unit, VS Code checks on local fixtures, live checks with OK); feasibility pass (two must-verifies with spikes); decision readiness: D1-D4.
- **Findings:**
  1. **must-verify:** `vscode.lm.invokeTool` for core terminal tools on 1.142.
  2. **must-verify:** CDP accessibility and input through js-debug's proxy (spike at the start of Part 4).
  3. **note:** history starts when VS Code starts; earlier output can't be read.

## Changes made

- Part 1: `TerminalHistory` records every terminal's shell executions from startup (`onStartupFinished`); `terminal_list` and `terminal_read` (allow, untrusted label, redactor). Unit tests plus a VS Code check reading a command run in a user terminal.
- Part 2: `CoreTerminalTools` calls VS Code's `terminal_last_command` and `terminal_selection` through `vscode.lm.invokeTool` when listed; `terminal_selection` tool; `terminal_read` adds the screen view when nothing is recorded. Spike: both tools answer with no prompt on 1.142.
- Part 3: input-wait detection (3 s quiet plus a prompt-like last line), `terminal_send_input` (asks), the script fallback without shell integration (POSIX), and kernl's own Ctrl+C reported as stopped. VS Code checks for the waiting command and the fallback.
- Part 4: `browser_snapshot` (accessibility tree outline with refs), ref-based `browser_click` and `browser_type` with real input and a verified fallback, `browser_press_key`, `browser_scroll`, `browser_back`, settle and console and network reporting after each action; approval cards name the element the ref really is on the page (`gatedTool` `shownArgs`). Unit tests for the outline and wording; VS Code checks on local pages (cookie banner, React-like controlled field, navigating link with Back, console and network errors).
- Docs: `docs/guides/terminal-and-browser.md`, CLI agents guide, README, changelog.
- Finish: installed and checked in M's window. Code review fixes: refs stable per element and never reused (an approved ref can't come to mean another element); a hit test before each real click (a covered element isn't clicked, the cover is named); the fallback runner removes its files when a command is stopped; `terminal_read` hides output of commands naming credential-like files (`isSensitivePath`).

### Deviations from the design

- **No `@xterm/headless`:** output is cleaned with the existing `cleanTerminalOutput` (escape codes, carriage-return redraws), which the runner already used and tests cover. A headless emulator can be added later if redraw-heavy output reads badly.
- **No separate `fallbackRunner.ts`:** the fallback lives in `runner.ts` next to the shell-integration path, since both share the watch loop. No PowerShell variant: on Windows without shell integration the command still doesn't run, with the old message.
- **`browser_read_page` unchanged** (no headings added): `browser_snapshot` covers structure.
- **Real input is checked, with show-and-retry (approved by M as A1):** in the suite, kernl's tab stopped taking real input after other kernl browsers reconnected and stopped (old code); showing it brought input back. A newer live browser tab, a leftover tab, or a file in front did not cut it off, so the exact trigger is unknown. Each click, key, and text entry is checked to reach the page; if not, kernl shows its tab (the tab object VS Code reported opening for kernl's session, which VS Code keeps while the tab is open; shown with `openEditorAtIndex`), retries, and puts keyboard focus back in the user's text editor or the kernl panel (the panel reports its focus), then falls back to the page's script, saying so.
- **Events need `JsDebug.subscribe`:** js-debug's CDP proxy forwards events only to subscribed clients; kernl subscribes on connect and drops the connection if it can't.
- **One tab:** a dropped connection reconnects to the same session's tab; `dispose` sends `Page.close` (ending the debug session leaves the tab open) and treats an already ended session as stopped. When the user closes the tab, VS Code ends the session but js-debug keeps kernl's WebSocket open, so kernl closes it when the session ends and the next call opens a new tab.

### Spike findings

- CDP `Accessibility.getFullAXTree`, `DOM.getBoxModel`, `DOM.focus`, `Input.insertText`, `Input.dispatchMouseEvent`, and `Input.dispatchKeyEvent` all work through js-debug's `requestCDPProxy` on 1.142. Enter needs `text: "\r"` to activate a default button.
- VS Code 1.142 also ships its own browser tools (`open_browser_page`, `read_page`, `click_element`, `type_in_page`, ...) in `vscode.lm.tools`: a possible alternative backend if kernl's CDP path ever breaks.

## Open questions

None.
