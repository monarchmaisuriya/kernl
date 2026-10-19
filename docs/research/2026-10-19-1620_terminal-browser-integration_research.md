# Terminal and browser integration: reading what's there, running robustly, acting accurately

- Date: 2026-10-19 16:20
- Status: presented
- Mode: explore options
- Repos: kernl   Folders: `src/terminal/`, `src/browser/`, `src/workspaceRuntime.ts`, `package.json`
- Question / problem: an agent asked to "check the terminal and tell me what's in it" couldn't, because kernl's tools only run new commands; how can kernl make terminal and browser integration accurate and robust with what VS Code allows?

## Options: what kernl can do today, and what it can't

- **Bottom line:** no stable VS Code API reads a terminal's existing screen, scrollback, or selection. kernl can record every command and its output in every terminal from VS Code startup (shell integration), which answers "what's in my terminal" for anything run since; VS Code's own Copilot tools can read the active terminal's last command and selection and may be callable. Command runs need a fallback without shell integration and input-wait detection; browser actions need element references from an accessibility snapshot instead of guessed CSS selectors.
- **Where we are:** kernl's code read; VS Code source and docs read by a research agent (graded, below).
- **Need from M:** decisions in the plan.

### kernl today [verified]

| Area | Today | Evidence |
| --- | --- | --- |
| Reading terminals | none: no tool reads an existing terminal | `src/terminal/tool.ts` (only `run_in_terminal`), the agent's answer in M's screenshot |
| Running commands | kernl's own terminal, shell integration `executeCommand` + `read()`; no shell integration means the command isn't run; a command waiting for input hangs until the 120 s timeout; output tail 30,000 characters | `src/terminal/runner.ts:64-118` |
| Activation | not at startup (`activationEvents: []`), so commands run before the panel opened aren't seen | `package.json:22` |
| Browser actions | CSS selectors the model guesses; click by `el.click()` (synthetic); type by setting `.value` (controlled inputs often ignore it); read = `innerText` cut at 20,000 characters; no waits after actions, no console or network errors, no keys, scroll, back, or tabs | `src/browser/tools.ts`, `src/browser/integratedBrowser.ts` |


## Research findings (research agent, graded; VS Code main after 1.142)

### Terminal and browser access for kernl agents: research

Date: 2026-10-19. Time-boxed (about 25 min). Read-only; no kernl files changed.

Sources were pulled from `microsoft/vscode` `main` on 2026-10-19 (after 1.142, released 2026-10-14). Local copies sit in `scratchpad/src/`. Where `main` could differ from 1.140-1.142, this file says so.

Grades: **verified** (read or ran it, source given), **inferred** (follows from verified facts, reasoning given), **unverified** (not checked, check named).

#### Bottom line

- **No stable API reads a terminal's existing buffer, scrollback, or selection.** [verified: `src/vscode-dts/vscode.d.ts` `interface Terminal` has `name, processId, creationOptions, exitStatus, state, shellIntegration, sendText, show, hide, dispose` only. `selection` exists only in `vscode.proposed.terminalSelection.d.ts`.]
- **The stable way to read the user's own terminals is to record shell integration executions from the moment kernl activates.** `onDidStartTerminalShellExecution` fires for every command in every terminal that has shell integration, not only commands kernl started. You get the command line, cwd, exit code, and raw output. Anything that ran before kernl activated is lost. [verified: `vscode.d.ts` ~L7947-8160 and `extHostTerminalShellIntegration.ts`]
- **VS Code's own Copilot terminal tools are core workbench tools, not Copilot-extension tools.** They appear in `vscode.lm.tools` and an extension can call them with `vscode.lm.invokeTool`. `terminal_last_command` and `terminal_selection` return the active terminal's last command plus its output (read from the xterm buffer) and its selection. This is the only route found to the xterm buffer in stable VS Code. Its weak points: the tool names are internal and not a stable contract, and it reads only the **active** terminal. [verified from code; inferred that it works at runtime, unverified until called in 1.142]
- **The integrated browser has no stable extension API.** A proposed `browser` API (`window.openBrowserTab`, `BrowserTab.startCDPSession`) exists, but proposed APIs work only in Insiders and cannot be published. [verified]

#### 1. Terminal extension API (stable)

### 1.1 Shell integration

- **Availability:** became available in **1.93** ("The terminal shell integration API is now available to use"). [verified: https://code.visualstudio.com/updates/v1_93] kernl requires ^1.140, so all of this is available.
- **`Terminal.shellIntegration`:** "always be `undefined` immediately after the terminal is created". Listen to `onDidChangeTerminalShellIntegration`. It "may remain undefined if shell integration never activates (Command Prompt, conflicting user setup)". [verified: vscode.d.ts `Terminal.shellIntegration` doc]
- **`TerminalShellIntegration.cwd`:** a `Uri | undefined`. It may point to another machine (ssh), and it needs the shell to report cwd. [verified: vscode.d.ts]
- **`executeCommand(commandLine)` / `executeCommand(executable, args)`:** "sending ^C as necessary to interrupt any running command". It throws on terminals that do not support it, such as task terminals. The args overload escapes args only for whitespace and is "not intended to be a security measure" (`$(...)` still runs). [verified: vscode.d.ts]
- **`TerminalShellExecution.read()`:** returns raw data **including escape sequences**. It "will only include data that was written after `read` was called for the first time ... you must call `read` immediately after ... executeCommand or onDidStartTerminalShellExecution". [verified: vscode.d.ts]
  - Implementation detail: emitters register only when `read()` is called. Data that arrives earlier is dropped. If you call `read()` after the execution ended, you get `AsyncIterableObject.EMPTY`. [verified: `src/vs/workbench/api/common/extHostTerminalShellIntegration.ts` `_createDataStream`, `emitData`, `ShellExecutionDataStream`]
  - Data reaches the extension host over IPC, batched every 50 ms (`Event.accumulate(e.instance.onData, 50, ...)`). The iterator's emitter registers on a microtask (`queueMicrotask` in `AsyncIterableObject`'s constructor). [verified: `mainThreadTerminalShellIntegration.ts` L86, `base/common/async.ts` `AsyncIterableObject`]
  - So calling `read()` synchronously inside the start-event handler (before any `await`) captures everything. An `await` on other async work before `read()` can lose the first chunks. [inferred from the two facts above]
  - Is output written before the start event included? No: the main-thread data listener is created inside the command-start handler. [verified: `mainThreadTerminalShellIntegration.ts` L70-90]
- **`commandLine.confidence`:** values are Low=0, Medium=1, High=2. High means the shell script sent the command line explicitly or it came from `executeCommand`. Low and Medium mean it was scraped from the buffer using markers. [verified: vscode.d.ts enum doc]
- **`commandLine.isTrusted`:** true only when the confidence is High and a nonce was verified. It matters only if you plan to re-execute the command. [verified]
- **`TerminalShellExecution.cwd`:** the cwd the shell reported at execution time. [verified]
- **`onDidEndTerminalShellExecution(e).exitCode`:** can be undefined. This happens when the script did not report one, a sub-shell opened, the user pressed Ctrl+C, or the user pressed Enter on an empty line. The doc says "it may be best to treat this as a failure". [verified: vscode.d.ts]
  - `TerminalShellExecution` has no `exitCode` property in stable. The `executeCommand(executable,args)` doc still mentions `TerminalShellExecution.exitCode`, which looks stale. [verified: vscode.d.ts]

### 1.2 Limits of shell integration

- **Shells with automatic injection:** bash, fish, pwsh, and zsh on Linux and macOS; Git Bash and pwsh on Windows. cmd is not supported. [verified: https://code.visualstudio.com/docs/terminal/shell-integration]
- **Where it breaks:** sub-shells and plain `ssh` sessions, "complex shell setups", unsupported `$PROMPT_COMMAND` formats, plugins that unset `$VSCODE_SHELL_INTEGRATION`, old fish, and the Windows pwsh execution policy. Users can add manual install lines to their rc files. [verified: same page]
- **tmux and powerlevel10k / oh-my-zsh:** the docs page does not mention them. [verified absence]
  - tmux: likely breaks the OSC 633 markers because tmux swallows unknown OSC sequences unless passthrough is enabled. [unverified: test in tmux with `allow-passthrough on/off`]
  - p10k "instant prompt": may print the prompt before integration hooks load, which gives Low or Medium confidence. [unverified]
- **Two levels of integration:** VS Code core separates "rich" integration (sequences `633;A,B,E,C,D` in exact order) from "basic" integration (`133;C` may not happen, `633;E` command line likely missing, and overlapping `executeCommand` calls can attribute end events to the wrong command). [verified: `chatAgentTools/browser/executeStrategy/basicExecuteStrategy.ts` L44-63 header comment]

### 1.3 Terminal state

- **Stable `Terminal` fields:** `name`, `processId: Thenable<number|undefined>`, `creationOptions`, `exitStatus` (undefined while alive), `state: { isInteractedWith, shell }`, `shellIntegration`. [verified: vscode.d.ts L7672-7840]
- **`state.shell` values:** 'bash','cmd','csh','fish','gitbash','julia','ksh','node','nu','pwsh','python','sh','wsl','xonsh','zsh'. It updates for sub-shells. [verified]
  - Landing version: not checked; it exists in stable `main` and was present by 1.99 per a third-party mirror. [unverified: check `vscode.d.ts` at tag 1.140.0]
- **`window.onDidChangeTerminalState`:** fires with the `Terminal`. [verified: vscode.d.ts L11193]
- **Listing terminals:** `window.terminals` and `window.activeTerminal` are stable. [verified: these are long-standing members of `window` in vscode.d.ts; not re-grepped this session, so treat as inferred]

### 1.4 Proposed APIs (cannot ship)

| Proposal | What it gives | Status |
| --- | --- | --- |
| `terminalSelection` | `Terminal.selection: string \| undefined` | proposed [verified: `vscode.proposed.terminalSelection.d.ts`, issue #188173] |
| `terminalDataWriteEvent` | `window.onDidWriteTerminalData` raw stream of all terminals | proposed; header says "we don't intend on promoting it to stable due to problems around performance" [verified] |
| `terminalExecuteCommandEvent` | `onDidExecuteTerminalCommand` with `output` as plain buffer text | `@deprecated Use window.onDidStartTerminalShellExecution` [verified] |
| `browser` | `window.browserTabs`, `openBrowserTab`, `BrowserTab.startCDPSession` | proposed, issue #300319 open in Backlog [verified: `vscode.proposed.browser.d.ts`, https://github.com/microsoft/vscode/issues/300319] |

**Rules for proposed APIs:** they are "only available in Insiders distribution", you "should not publish extensions using the proposed API on the Marketplace", and a sideloaded VSIX needs `code-insiders --enable-proposed-api=<id>` or `enable-proposed-api` in `argv.json`. [verified: https://code.visualstudio.com/api/advanced-topics/using-proposed-api]

So none of the proposals above are usable in kernl on Stable 1.142. [inferred]

#### 2. How VS Code's built-in agent reads terminals

These tools live in **VS Code core** (`src/vs/workbench/contrib/terminalContrib/chatAgentTools/browser/tools/`), not in the Copilot extension. They are registered by `ChatAgentToolsContribution` at `WorkbenchPhase.AfterRestored`. [verified: `terminal.chatAgentTools.contribution.ts` L83-125, L185]

| Tool id | Reads | Source |
| --- | --- | --- |
| `terminal_last_command` | active terminal's `CommandDetection` capability. If a command is executing: its command line and cwd. Otherwise the last command's command line, cwd, exitCode, and `getOutput()` (xterm buffer between markers) | [verified: `getTerminalLastCommandTool.ts`] |
| `terminal_selection` | `activeInstance.selection` (xterm selection) | [verified: `getTerminalSelectionTool.ts`] |
| `get_terminal_output` | only executions started by `run_in_terminal` (looked up by UUID). Returns a tail capped at 8000 chars, or deltas since the last poll | [verified: `getTerminalOutputTool.ts` `_tailCharBudget = 8000`] |
| `run_in_terminal`, `send_to_terminal`, `kill_terminal` | own terminals | [verified: `chat/common/tools/terminalToolIds.ts`] |

- **Output extraction:** reads `instance.xterm.raw.buffer.active` line by line and unwraps wrapped lines. This is rendered screen text, not the raw stream. [verified: `chatAgentTools/browser/outputHelpers.ts` L46-96]

### Can other extensions call these tools?

- **`vscode.lm.tools` lists every tool in core's tools service, including Internal ones.** `mainThreadLanguageModelTools.getToolDtos()` maps `getAllToolsIncludingDisabled()`. The ext host filters out only the edit tools, fetch-webpage, and extension-search unless the caller has `chatParticipantPrivate`. [verified: `api/browser/mainThreadLanguageModelTools.ts` L42-61, `api/common/extHostLanguageModelTools.ts` `getTools` L165-180]
- **`invokeTool` without a `toolInvocationToken` is allowed:** "or globally by any extension in any custom flow". [verified: vscode.d.ts `lm.invokeTool` doc]
  - In core, a call with no context skips the chat UI. If the tool has confirmation messages, a modal `dialogService.confirm` appears; otherwise the tool just runs. [verified: `contrib/chat/browser/tools/languageModelToolsService.ts` L708-724]
  - `terminal_last_command` and `terminal_selection` define no confirmation messages. [verified: their `prepareToolInvocation` returns only invocation/past-tense messages]
- **So `await vscode.lm.invokeTool('terminal_last_command', { input: {} })` should return the active terminal's last command and its buffer output in Stable.** [inferred from the above; unverified at runtime: run it in 1.142 from kernl's test harness]
- **Caveats:**
  - The ids are internal and have already been renamed once (`legacyToolReferenceFullNames: ['runCommands/terminalLastCommand']`). [verified]
  - Only the **active** terminal is read, so you must call `terminal.show(true)` first to target another one. [inferred]
  - The tools may be absent when chat or AI features are disabled. [unverified: test with `chat.disableAIFeatures: true`]
  - Contents of `getAllToolsIncludingDisabled` in forks (Cursor, Windsurf) are unknown. [unverified]

### Other built-in commands (stable command ids, act on the active terminal)

- **Command ids:** `workbench.action.terminal.copyLastCommandOutput` (precondition `terminalAvailable`), `copyLastCommand`, `selectAll`, `copySelection` (needs text selected). [verified: `contrib/terminal/common/terminal.ts` L419-425, `terminalContrib/clipboard/browser/terminal.clipboard.contribution.ts` L206-253]
- **Possible use:** chain them with `vscode.env.clipboard.readText()` to read the screen, but this clobbers the user's clipboard. [inferred; unverified at runtime] This is a fallback only.

#### 3. Robust command execution (how core does it)

core `run_in_terminal` picks one of three strategies. [verified: `executeStrategy/*.ts`]

- **Rich** (full 633 sequences): trusts execution events.
  - Before running, it records the marker of any command already executing. Its own Ctrl+C would otherwise produce a "finished, exit 130" event that gets mistaken for the new command's result.
  - It checks for an already-exited pty, which would otherwise hang. [verified: `richExecuteStrategy.ts` L77-122]
- **Basic** (integration present, not rich): does not trust execution events.
  - It listens to the terminal's data stream rather than the execution's stream and polls for idle (`IdlePollInterval`, default 1000 ms).
  - It accepts that output may include prompts and lets the LLM sort it out. [verified: `basicExecuteStrategy.ts` L44-63, L119]
- **None** (no integration):
  1. Wait for idle.
  2. Send Ctrl+U, not Ctrl+C, to clear the prompt. Ctrl+C at an idle prompt caused spurious exit-130 results.
  3. Run the command with `sendText` (not `runCommand`), because early Ctrl+C breaks PSReadLine (issue #258989).
  4. Wait for the cursor to leave the command line (1 s cap), then wait for idle with prompt heuristics (cap at 10x the poll interval).
  5. No exit code is available. [verified: `noneExecuteStrategy.ts` L21-160]
- **Waiting for input:** an `OutputMonitor` polls for idle, then classifies the last line. It fires `onDidDetectInputNeeded` or `onDidDetectSensitiveInputNeeded` (password, passphrase, token, OTP) and has a Timeout state that can extend polling. [verified: `tools/monitoring/outputMonitor.ts` L18-30, L62-220]
- **Output size:** `get_terminal_output` keeps the last 8000 chars and tells the model to redirect output to a file if it needs the rest. A `largeOutputFileWriter.ts` exists. [verified: file list + `getTerminalOutputTool.ts`]
- **Background vs foreground:** commands can go async (`get_terminal_output` by UUID), and core has a `commandLineBackgroundDetachRewriter`. 1.142 added "Stop background shells" for attached shells. [verified: file list; https://code.visualstudio.com/updates/v1_142]

### kernl today

- `src/terminal/runner.ts` uses `executeCommand` and calls `read()` synchronously inside an IIFE right after it, which is correct. [verified: runner.ts L76-91]
- It treats missing integration as an error after 10 s, with no `sendText` fallback. [verified: L67-73]
- It interrupts on timeout with `\x03`. [verified: L99]
- It does not detect input prompts and does not handle basic-only integration. [verified: no such code in runner.ts]

#### 4. Browser accuracy

### Playwright MCP

- Acts on the accessibility tree, "not pixel-based input". `browser_snapshot` returns the tree with element refs. [verified: https://github.com/microsoft/playwright-mcp]
- Actions take `target` ("Exact target element reference from the page snapshot, or a unique element selector") plus an optional human-readable `element`. The parameter was `ref` in older versions. [verified current README]
- Other tools: `browser_wait_for` (text appears or disappears, or time up to 30 s), `browser_console_messages`, `browser_network_requests` / `browser_network_request`, `browser_tabs` (list, new, close, select), `browser_navigate`. It can attach to an existing browser with `--cdp-endpoint`. It is "not a security boundary". [verified: same]

### VS Code's own browser tools (core, 1.110+)

- **Tools:** `read_page` ("snapshot ... better than screenshot"), `click_element` with `ref` mapped to Playwright selector `aria-ref=<ref>` or a raw `selector`, `run_playwright_code`, `open_browser_page`, and others. [verified: `contrib/browserView/electron-browser/tools/readBrowserTool.ts`, `clickBrowserTool.ts` L17-117]
- **Under the hood:** a Playwright `page.ariaSnapshot()` with a `_track` option, console capture via `page.on('console')`, and `waitForLoadState('load', {timeout: 10000})`. [verified: `platform/browserView/node/playwrightTab.ts` L15-270]
- **Registration:** these tools register only when browser sharing is available. Otherwise only a non-agentic open tool registers. [verified: `browserTools.contribution.ts` `_updateToolRegistrations`]
- **Calling them from an extension:** with no chat context they fall back to session `'<default>'` (`getSessionId`). So `lm.invokeTool('read_page' | 'click_element' ...)` from kernl is plausible. [inferred from `browserToolHelpers.ts` L28-32; unverified at runtime]
- **History:** experimental agent browser tools in 1.110, sharing tabs with agents in 1.119, on by default in 1.127. [unverified: secondary source, visualstudiomagazine.com articles; check the official release notes]

### Public browser API for extensions in 1.140-1.142

- Stable `vscode.d.ts` (main) has **no** browser tab or CDP API. [verified: grep `browserTab|BrowserCDP|openBrowser` = 0 hits]
- Only the proposed `browser` API exists. [verified]
- The 1.142 notes list no API changes. [verified: https://code.visualstudio.com/updates/v1_142]
- kernl drives the integrated browser through an `editor-browser` debug session plus js-debug's undocumented `requestCDPProxy`. [verified: `src/browser/integratedBrowser.ts` L5-60]
- It uses raw `Runtime.evaluate`, `Page.navigate`, and `Page.captureScreenshot`, with no accessibility snapshot or refs. [verified: L100-119]

#### 5. Recommendations (stable APIs only)

**(a) List terminals.**
- Use `window.terminals`, `activeTerminal`, `name`, `await processId`, `state.shell`, `state.isInteractedWith`, `exitStatus`, `!!shellIntegration`, `shellIntegration?.cwd`, and whether kernl created the terminal. [inferred from verified API]
- Give each terminal a stable id inside kernl (a WeakMap from Terminal to id), because the API exposes none. [inferred]

**(b) Read recent commands and output in any terminal.**
- Add a `TerminalHistory` service that subscribes to `onDidStartTerminalShellExecution` and calls `e.execution.read()` **synchronously**.
- Keep a per-terminal ring buffer of `{commandLine.value, confidence, cwd, startedAt, exitCode, output}`, capped by both count and bytes.
- Render output through `@xterm/headless` (plus the serialize addon) rather than regex ANSI stripping, so `\r` progress bars and cursor moves come out as the user saw them.
  - [inferred: raw stream includes VT sequences, verified; headless rendering is what core gets for free from xterm]
- Activate on `onStartupFinished` so the history starts early; `activationEvents` is `[]` today. [verified: kernl package.json L22]
- Tell the agent plainly when history is empty because integration is off or the command ran before activation.

**(c) Read the visible screen or selection.**
- No stable API exists. Two options:
  1. Call core's `terminal_last_command` / `terminal_selection` through `vscode.lm.invokeTool`, behind a capability check on `vscode.lm.tools` and a runtime test.
  2. A clipboard fallback, which needs M's decision because it overwrites the clipboard.
- [inferred; unverified at runtime]

**(d) Run commands robustly.**
- Copy core's three-tier approach:
  - Rich: `executeCommand` with `read()`.
  - Basic: idle polling over the stream, and treat the exit code as advisory.
  - None: `sendText` with Ctrl+U, then idle plus prompt heuristics, with no exit code.
- Detect input-waiting by idle time plus last-line patterns, and never auto-answer password prompts.
- Keep the tail and offer a "redirect to file" hint.
- Serialize commands per terminal. kernl already does this. [verified as core behavior; inferred as a fit for kernl]

**(e) Drive the browser accurately.**
- Move kernl's CDP layer to accessibility refs: `Accessibility.getFullAXTree` (CDP) giving a ref-to-`backendDOMNodeId` map, then click or type through `DOM.getBoxModel` plus `Input.dispatchMouseEvent`, or `DOM.resolveNode` plus `Runtime.callFunctionOn`.
- Also wait for `Page.loadEventFired` and network idle (`Network.*` in-flight count), enable `Runtime.consoleAPICalled`, `Log.entryAdded`, and `Network.*` capture, and track `Target.*` for tabs.
  - [inferred design; CDP method names are standard, unverified against the js-debug proxy]
- Alternative: call core's `read_page` and `click_element` through `lm.invokeTool`. [unverified at runtime]

#### Open checks

1. Call `vscode.lm.invokeTool('terminal_last_command', {input:{}})` in VS Code 1.142 from kernl's test harness and confirm the result.
2. Check the same for `read_page`, and whether browser sharing needs to be enabled first.
3. Confirm whether these tools exist when AI features are disabled.
4. Find the exact version `TerminalState.shell` landed in, from `vscode.d.ts` at tag `1.140.0`.
5. Measure shell integration behavior under tmux and under p10k instant prompt.

## Recommendation

RECOMMENDATION: record shell executions in every terminal from startup and give agents `terminal_list` and `terminal_read`; use VS Code's own active-terminal tools as an extra when present; make command runs robust (fallback without shell integration, input-wait detection, send input); move browser actions to accessibility-snapshot references with real input events, waits, and console and network capture. Plan: `docs/plans/2026-10-19-1625_terminal-browser-integration_plan.md`.

## Standardized review

- **Bottom line:** decision-grade; no blocking findings.
- **Criteria:** question fit pass; method pass (kernl code read; VS Code source and docs as primary sources); coverage pass (stable, proposed, core tools, clipboard); traceability pass; uncertainty stated (invokeTool on Stable, CDP accessibility through js-debug, tmux and themed prompts); recommendation proportionate.
- **Findings:**
  1. **must-verify:** `vscode.lm.invokeTool` for VS Code's `terminal_last_command` / `terminal_selection` on 1.142 (and with AI features off).
  2. **must-verify:** CDP `Accessibility.getFullAXTree` and `Input.*` through js-debug's CDP proxy.
  3. **note:** output from before VS Code started, or from terminals without shell integration, can't be read by any stable API.
