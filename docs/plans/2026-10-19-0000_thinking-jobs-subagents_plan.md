# Sequential thinking, background jobs, and subagents for the YourStack agent

- Date: 2026-10-19 00:00
- Status: done
- Repos: yourstack
- Files:
  - New: `src/agent/thinking.ts`, `src/agent/backgroundJobs.ts`, `src/agent/builtInAgents.ts`, `test/unit/thinking.test.ts`, `test/unit/backgroundJobs.test.ts`, `test/unit/subagents.test.ts`
  - Changed: `src/agent/session.ts`, `src/agent/createAgent.ts`, `src/workspaceRuntime.ts`, `src/controller.ts`, `src/ui/protocol.ts`, `src/webview/main.ts`, `media/panel.css`, `package.json`, `README.md`, tests
- Subagents: none

## Context and problem

M asked (2026-10-19):

1. Add Model Context Protocol's sequential-thinking server as a default layer, built in (no MCP).
2. Background jobs for the YourStack agent.
3. Subagents for the YourStack agent.

## Research findings (find out)

| Finding | Evidence |
| --- | --- |
| Sequential thinking is one tool: `thought`, `thoughtNumber`, `totalThoughts`, `nextThoughtNeeded`, plus optional `isRevision`, `revisesThought`, `branchFromThought`, `branchId`, `needsMoreThoughts`. It raises `totalThoughts` when exceeded, records history and branches, and returns `{thoughtNumber, totalThoughts, nextThoughtNeeded, branches, thoughtHistoryLength}`. MIT licensed. | [verified: `src/sequentialthinking/lib.ts`, `index.ts`, README "MIT License" (fetched 2026-10-19)] |
| Deep Agents already gives the agent a `task` tool with a general-purpose subagent, plus our named agents | [verified: `GENERAL_PURPOSE_SUBAGENT` in the deepagents types; `src/agent/namedAgents.ts`] |
| Deep Agents' async (background) subagents run on a LangGraph server (`graphId`, `url`), so they don't fit a local extension | [verified: `AsyncSubAgent` type] |
| **Defect found:** a subagent's text streams into the main transcript as if the main agent wrote it, and the `task` result never reaches the panel. Subagent messages are identifiable: their stream namespace starts with `tools:`. | [verified: scratch run: texts `["SUBAGENT-TEXT","MAIN-FINAL"]`, results `[]`; metadata `langgraph_checkpoint_ns` `tools:...\|model_request:...`] |
| Commands today run in the visible terminal and the agent waits for them | [verified: `src/terminal/runner.ts`] |

## Goals / Non-goals

Goals:

- **Sequential thinking:**
  - A built-in `sequential_thinking` tool for the YourStack agent, on by default (setting `yourstack.sequentialThinking`, default true), with the same parameters, rules, and response as the server.
  - History and branches per conversation.
  - Thoughts show in the transcript as numbered thought rows (revision and branch labeled).
  - No side effects, so no approval.
- **Background jobs:**
  - Tools: `start_background_job(command, name?)` (asks like any command; approval rules apply), `check_background_job(id, tail?)`, `stop_background_job(id)`, `list_background_jobs()`.
  - Each job runs in its own visible VS Code terminal named "YourStack job: <name>". Closing it stops the job.
  - Output is kept (last 200 KB) for the agent to read.
  - Jobs survive between messages and Stop. They end when the workspace closes or the window reloads.
  - The footer shows a jobs chip whose menu shows or stops each job.
- **Subagents:**
  - Built-in delegates besides general-purpose: `explorer` (reads and searches only; answers with file paths) and `reviewer` (reads and runs checks such as tests; never edits). Named agents still override by name.
  - Fix the stream defect: subagent text goes into its `task` row ("Subagent: explorer: <description>"), streaming. Its own tool calls show prefixed with the subagent's name.
  - Every action still goes through the approval gate.

Non-goals:

- Async subagents that keep working while the main agent continues (need a LangGraph server).
- Jobs for CLI agents (they have their own).

## Options considered

| | A. Built-in tools on our gate (recommended) | B. Run the sequential-thinking MCP server and an MCP job runner |
| --- | --- | --- |
| How it works | Small modules, wrapped with `gatedTool` | Spawn servers over MCP |
| Fits "don't use MCP" | Yes | No |
| Completeness | 9/10 | 5/10 |

RECOMMENDATION: A, as M asked.

## Design

```
model --> sequential_thinking (gatedTool allow) --> ThinkingLog per thread --> JSON reply; panel renders a thought row   <-- new
model --> start_background_job --> gate (execute rules) --> BackgroundJobs.start: spawn shell, pty terminal, ring buffer <-- new
model --> task(explorer|reviewer|named) --> subagent; stream ns "tools:" --> subagentText into the task row             <-- fixed
```

- **`thinking.ts`:** `ThinkingLog.process(input)`, with the server's semantics; `thinkingTool(log)` (zod schema accepts number strings and "true"/"false" like the server).
- **`backgroundJobs.ts`:**
  - Jobs per workspace. `spawn($SHELL -lc command, cwd)` in its own process group; stop kills the group.
  - Output goes to a VS Code `Pseudoterminal` and a 200 KB tail buffer.
- **`builtInAgents.ts`:** the explorer and reviewer `NamedAgent`s, merged under user and project agents by name.
- **`session.ts`:**
  - Messages whose namespace starts with `tools:` are subagent output: text goes to `subagentText(taskId, delta)` and tool calls are labeled `<subagent> > name`.
  - `task` calls record the subagent type.
- **Protocol:**
  - HostToPanel `subagentText {workspace, id, delta}` and `jobs {workspace, items}`.
  - PanelToHost `pickJob`.

## Risks and mitigations

| Risk | Likelihood | Impact | Mitigation | How we'd notice |
| --- | --- | --- | --- | --- |
| A forgotten job keeps running (ports, CPU) | Medium | Medium | Visible terminal, footer chip with count, stopped on workspace close or reload | Jobs chip |
| A job's command bypasses approvals | Low | High | It goes through the gate as `execute`; same rules | Unit test |
| Parallel subagents' text interleaves | Medium | Low | Text goes to the latest `task` row; documented | Manual |
| Thought rows clutter the transcript | Medium | Low | Compact collapsible rows | Screenshot |

## Acceptance criteria

- **Sequential thinking:** a call returns the server's JSON; `thoughtNumber > totalThoughts` raises the total; branch ids are listed; history resets per conversation; the panel shows "Thought 2/5".
- **Jobs approval:** `start_background_job` asks; on approval it runs in a visible terminal and returns an id; `check` returns status and tail; `stop` ends it; a rejected start runs nothing.
- **Subagents:** delegating to `explorer` puts its text in the task row, not the main reply; explorer can't edit or run; reviewer can run but not edit.

## Parts

- [x] Sequential thinking tool, setting, panel thought rows.
- [x] Background jobs: tools, terminals, chip and menu, cleanup.
- [x] Subagents: built-ins, stream fix, panel subagent rows.
- [x] Tests (unit, panel, VS Code), screenshots, README, package.

## Standardized review

Reviewed with the plan rubric against `src/agent/session.ts`, `src/agent/createAgent.ts`, `src/agent/namedAgents.ts`, `src/terminal/runner.ts`, `src/gate/*`, and the fetched server source.

- **Findings, fixed in this file:**
  1. **Blocking, fixed (current-system accuracy):** the subagent stream defect affects shipped delegation; it's now part of this plan with a test.
  2. **Must-verify, fixed (failure):** jobs must not outlive the window: stopped on workspace dispose and extension deactivate; process groups killed.
  3. **Note:** M's wording "background jobs" is read as long-running commands (dev servers, watchers); async subagents need a server and are a non-goal, stated.
- **Criteria:** all pass after fixes.
- **Overall:** 1 blocking (fixed), 1 must-verify (fixed), 1 note.

## Changes made

- `src/agent/thinking.ts`: built-in sequential thinking with the reference server's semantics (adapted, attributed), string-tolerant inputs, schema kept free of transforms (zod transforms can't become JSON Schema), setting `yourstack.sequentialThinking`; thought rows in the panel.
- `src/agent/backgroundJobs.ts` and `src/terminal/jobTerminal.ts`: jobs in their own process groups, 200 KB output tail, visible pseudoterminals (closing one stops the job), footer jobs chip and menu, stopped on dispose.
- `src/agent/builtInAgents.ts`: explorer (no edit, run, browser, or MCP) and reviewer (run, no edit).
- Stream fixes in `src/agent/session.ts`:
  - subagent text goes to its task row (namespace `tools:`);
  - tool calls are reported once their streamed argument pieces are complete (before this, a streaming provider showed partial arguments in every tool row and an unknown subagent name);
  - token counting, briefly lost in the edit, is restored and now pinned by a test.
- Live check on DeepSeek: 2 thoughts, delegation to explorer (`explorer > ls`, `grep`, `glob`, `read_file`), correct answer in 12 s.
- Tests: unit 181, VS Code 47.

## Open questions

None.
