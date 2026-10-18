# Harness-first picker, Claude files, highlighting, attachments, checkpoints, fork

- Date: 2026-10-18 21:30
- Status: done (M accepted all 5 defaults)
- Repos: yourstack   Folders: src/webview, src/ui, src/agent, src/acp, src/workspaces, media, package.json, test
- Subagents: none
- Research: `docs/2026-10-18-2100_harness-picker-attachments-checkpoints_research.md`

## Context and problem

M asked (2026-10-18):

- read `.claude/agents` and `.claude/skills`;
- syntax highlighting in code blocks;
- fork conversation;
- restore checkpoint (undo all changes made);
- readable labels in the `...` menu;
- use Claude Code, Codex, or OpenCode directly, with every other provider in settings, and the settings made more intuitive ("allow using other agent harnesses and also our own harness with API keys and providers");
- an attachment menu like VS Code's (Files & Folders, Sessions, Issue, Pull Request), drag and drop, and `@` autocomplete.

Live checks before planning:

- DeepSeek works end to end, including Claude Code on DeepSeek.
- Codex needs `codex login`.
- The Claude Code login scenarios fail only in this session's sandbox.

## Goals / Non-goals

Goals, by phase:

1. **Quick wins:**
   - plain menu labels (category "YourStack");
   - highlighted code blocks;
   - `.claude/agents/*.md` and `.claude/skills/*/SKILL.md` (project and `~/.claude`) work in the YourStack harness, next to `.yourstack/`.
2. **Harness-first picker:**
   - The composer's agent chip lists harnesses: **YourStack**, Claude Code, Codex, OpenCode, plus named agents under YourStack.
   - A harness that isn't ready (not installed, not logged in, no key) shows why and offers "Set up...".
   - The model chip appears only for YourStack and lists models grouped by provider. Providers without a key show "Add key...".
   - **Manage providers** (QuickPick): every provider with its key status; set, replace, or remove a key; test the connection; add a custom provider.
   - **Agent logins** (QuickPick): each CLI agent's status (installed, logged in, using a stored key) and how to log in.
   - A first-run walkthrough: pick a harness, log in or add a key, start chatting.
   - Settings categories renamed for people: "YourStack agent", "Approvals", "Claude Code, Codex, OpenCode", "Advanced".
3. **Attachments:**
   - `+` in the composer opens "Files & Folders..." (QuickPick of workspace files and folders, searchable).
   - `@` in the composer autocompletes workspace paths.
   - `/` lists skills.
   - Attachments show as removable chips above the input.
   - Explorer right-click "Add to YourStack chat".
   - Drag and drop from the Explorer into the panel, if the manual check confirms VS Code delivers the drop.
   - Delivery: YourStack gets paths in the message; ACP agents get `resource_link` blocks.
4. **Sessions and checkpoints:**
   - Each workspace keeps a list of conversations (Sessions), persisted across restarts.
   - Before each message, a snapshot of the workspace's files.
   - On each of your messages: "Restore files and conversation" and "Restore files only" (CLI agents: files only). It asks once, listing the files it will change, refuses files with unsaved edits, and says that terminal side effects aren't undone.
5. **Fork and more attachments:**
   - "Fork from here" on a message (YourStack) or "Fork session" (Claude Code, whole session); not offered where unsupported.
   - "Sessions..." attaches another conversation's transcript.
   - "Issue..." and "Pull Request..." attach GitHub items via VS Code's GitHub sign-in.

Non-goals:

- Undoing terminal or network side effects (no tool can).
- Settings webview (VS Code guidance).
- Codex model or login management beyond showing status.
- Claude Code `permissionMode`, `hooks`, and `!cmd` in skills (our gate decides; we don't run skill shell commands).

## What is true today

| Fact | Evidence |
| --- | --- |
| Command titles carry "YourStack:"; no `category` | [verified: `package.json`] |
| One conversation per workspace, in memory (`MemorySaver`; ACP session in the agent process) | [verified: `src/agent/createAgent.ts`, `src/agent/session.ts:26`, `src/acp/acpRunner.ts:144`] |
| ACP prompts send one text block | [verified: `src/acp/acpRunner.ts:57`] |
| Agent picker is a `<select>` of built-ins plus named agents | [verified: `src/webview/main.ts`, `src/controller.ts` `harnessList`] |
| Named agents load from `.yourstack/agents` and `~/.yourstack/agents` with a tool guard | [verified: `src/agent/namedAgents.ts`] |
| Markdown renders from `marked` tokens with `createElement` | [verified: `src/webview/markdown.ts`] |
| `git` is already required (worktree workspaces) | [verified: `src/workspaces/git.ts`] |
| Codex: "Not logged in"; Claude Code adapter has no settable model option | [verified: `codex login status`; adapter source] |

## Options considered

The research compared snapshot and session storage (A shadow repo plus JSON, B refs in the user's repo plus SQLite, C per-edit copies). RECOMMENDATION: A, because it covers every harness without touching the user's repo or adding a native module. See the research file.

## Decision (pending M's answers; defaults shown)

- **Phases:** 1 to 5, in that order.
- **Storage:** option A.
- **Restore:** both options; files-only for CLI agents.
- **Our harness is named "YourStack"** in the UI; settings keys stay (`yourstack.harness` value `deepagents`, so nothing breaks).
- **GitHub attachments** via VS Code's GitHub sign-in.

**Structural reason:**

- Each feature lands at its owning layer: manifest (labels), webview renderer (highlighting), agent loader (Claude files), controller and pickers (harness and settings), composer plus runners (attachments).
- One snapshot service is shared by every harness; one session store is shared by fork, restore, and attach-a-session.

## Design

```
Phase 4/5 foundation
  send(text, attachments) --> CheckpointService.snapshot(workspace) --> tree id saved on the user message   <-- new
                           --> SessionStore.append(session, message)                                        <-- new
  Restore(message)  --> confirm(list of files) --> CheckpointService.restore(tree) --> [cut conversation]   <-- new
  Fork(message)     --> SessionStore.copyUpTo(message) --> new session (YourStack: messages seed thread)   <-- new
```

- **Phase 1:**
  - `package.json` commands get `category`.
  - `src/webview/markdown.ts` code blocks get tokens from `lowlight` (pinned, at least 2 weeks old) and build spans with classes; CSS maps classes to theme variables with fallbacks.
  - `src/agent/claudeFormats.ts`: parse `.claude/agents` (tool-name mapping per the research; `model` aliases and `inherit` mean "current model"; unknown fields ignored) into `NamedAgent`. `.yourstack/` wins on the same name.
  - Skills: Deep Agents `skills` sources `/.claude/skills/` and `/.yourstack/skills/` (project, trusted only), plus a read-only backend route for `~/.claude/skills`.
- **Phase 2:**
  - Protocol: `HarnessView` gains `group` ("YourStack" | "Agents"), `ready`, `problem?`.
  - `src/harnesses.ts` (new) computes readiness: CLI found (`resolveCommand`); login status where the CLI reports it (`codex login status`; Claude Code and OpenCode checks [unverified: which commands report status; checked first]); YourStack ready when the current provider has a key.
  - Composer agent chip becomes a button opening a grouped QuickPick (native menu, as with the workspace chip).
  - `src/modelPicker.ts` lists models grouped by provider: the current model, suggested ids per provider, custom providers' models, and "Enter a model id...".
  - `src/providerManager.ts` (new) implements Manage providers and Agent logins.
  - Walkthrough `contributes.walkthroughs` with 3 steps and completion events.
- **Phase 3:**
  - Panel messages `searchFiles {query}` -> host `fileMatches`, `pickAttachments`; `send` gains `attachments: {uri, kind}[]`.
  - Composer chips; `@` and `/` popovers built with `createElement`.
  - Explorer menu command `yourstack.attachToChat` (`explorer/context`).
  - Webview `drop` handler reading `text/uri-list` (only if the manual check passes).
  - `AcpRunner.send` adds `resource_link` blocks; `AgentSession.send` appends an "Attached:" list.
- **Phase 4:**
  - `src/checkpoints.ts`: shadow repo under `globalStorage/checkpoints/<hash of root>`; `snapshot()` returns a tree id; `diff(tree)` lists files; `restore(tree)` via `read-tree -u --reset` with a temp index. Refuses files with unsaved editor buffers.
  - `src/sessions.ts`: per workspace, JSON in `workspaceStorage` (transcript events plus serialized LangChain messages).
  - Panel: Sessions list (history button), message hover actions.
  - YourStack resumes a stored session by seeding a new thread with its messages; Claude Code via ACP `session/load` [verified: adapter advertises `loadSession`]; others read-only after restart.
- **Phase 5:**
  - Fork: YourStack copies messages up to the chosen message into a new session; Claude Code uses `unstable_forkSession` (whole session).
  - Attach session: the transcript as a text attachment.
  - GitHub: `vscode.authentication.getSession("github", ["repo"])` plus REST for issues and PRs of the repo's `origin`.

## Risks and mitigations

| Risk | Likelihood | Impact | Mitigation | How we'd notice |
| --- | --- | --- | --- | --- |
| Snapshots slow on large repos | Medium | Medium | Measure on ~10k files first; respect `.gitignore`; skip with a notice above a limit | Perf check in Phase 4 |
| Restore overwrites work the user did by hand after the snapshot | Medium | High | Confirm with the file list; refuse unsaved buffers; take a snapshot right before restoring, so restore itself can be undone | VS Code check |
| `.claude` agent tool names drift | Medium | Low | Unknown tools ignored and listed in a notice; mapping table in one place | Unit tests |
| Drag and drop doesn't reach webviews | Medium | Low | Manual check first; Explorer menu works regardless | Manual check |
| GitHub sign-in prompts unexpectedly | Low | Low | Only when the user opens Issue or PR | n/a |
| Harness readiness checks are slow (spawning CLIs) | Medium | Low | Cache per window; refresh on focus of the picker | VS Code check |
| Persisted transcripts contain secrets | Low | High | Stored transcripts pass through the redactor; stored in VS Code's workspace storage only | Unit test |
| Unstable ACP fork changes | Medium | Low | Feature-detect the capability; hide when absent | VS Code check with the fake agent |

## Acceptance criteria

- **Labels:** the `...` menu shows "Set API key" (no prefix); the Command Palette shows "YourStack: Set API key".
- **Highlighting:** a `ts` code block renders keyword and string spans with classes; no HTML parsing; screenshots in three themes.
- **Claude agents:** given `.claude/agents/reviewer.md` with `tools: Read, Bash`, then "YourStack: reviewer" is pickable and has run but not edit; with `model: sonnet`, then the current model is used.
- **Skills:** given `.claude/skills/x/SKILL.md`, then the YourStack agent's prompt lists the skill.
- **Picker:** given Codex not logged in, then Codex shows "Not logged in: run codex login" and can't start a run; given no key for the current provider, then YourStack shows "Add key...".
- **Providers:** Manage providers shows each provider's key status and can test a key.
- **Attachments:** given `@src/app` typed, then matching paths are suggested; a chosen file is sent as a path (YourStack) or a `resource_link` (ACP).
- **Checkpoints:** given two messages that changed files, when "Restore files and conversation" on the first, then files match the snapshot before it and later messages are gone; a file created after is removed; unsaved buffers block with a message.
- **Fork:** given a YourStack conversation, when "Fork from here" on message 2, then a new session has messages 1-2 and the original is unchanged.
- **Sessions:** after a window reload, the previous conversation is listed and can continue (YourStack).

## Rollout and rollback

- Each phase ships as its own VSIX; phases are independent until 4 and 5.
- Rollback: reinstall the previous VSIX. Shadow snapshot repos and session files live in extension storage and can be deleted by "Clear checkpoints and sessions" (new command in Phase 4).

## Parts

### Phase 1: Quick wins

- [x] Command `category`; plain titles. Done when the VS Code check reads the menu labels.
- [x] Highlighting with `lowlight` (about 20 languages), theme-variable CSS. Done when unit tests check token spans and HTML safety, and screenshots are shown.
- [x] `.claude/agents` and `.claude/skills` loading. Done when unit tests cover the mapping, precedence, and skills listing, and a VS Code check picks a `.claude` agent.

### Phase 2: Harness-first picker and settings

- [x] Readiness checks (verify the status commands first); grouped agent QuickPick; model picker by provider; Manage providers; Agent logins; walkthrough; settings categories. Done when VS Code checks drive each menu and a not-ready harness can't start.

### Phase 3: Attachments

- [x] Manual drag-and-drop check (M or screenshots). `@` and `/` autocomplete, `+` Files & Folders, chips, Explorer menu, delivery to both harness kinds. Done when jsdom and VS Code checks pass and the fake ACP agent receives `resource_link` blocks.

### Phase 4: Sessions and checkpoints

- [x] Measure snapshot time on ~10k files; `checkpoints.ts`; `sessions.ts`; Sessions list; Restore actions. Done when VS Code checks restore files (including deletions) and the conversation, block unsaved buffers, and resume after reload.

### Phase 5: Fork and remaining attachments

- [x] Fork (YourStack from a message; Claude Code whole session via feature detection); Sessions, Issue, and PR attachments. Done when VS Code checks fork and attach, with GitHub calls tested against a stub.

## Standardized review

Reviewed with the plan rubric against the research, `package.json`, `src/webview/main.ts`, `src/webview/markdown.ts`, `src/agent/*`, `src/acp/acpRunner.ts`, and the ACP SDK types.

- **Findings, fixed in this file before presenting:**
  1. **Blocking, fixed (failure and recovery):** Restore could overwrite manual edits made after the snapshot. Added: a snapshot right before restoring (so restore is undoable), a confirmation listing the files, and a refusal on unsaved buffers.
  2. **Must-verify, marked (feasibility):** how Claude Code and OpenCode report login status is unknown. Phase 2 checks it first; fallback: "installed" only, with the agent's own error surfaced on first run (as today).
  3. **Must-verify, marked (feasibility):** snapshot speed. Phase 4 measures first.
  4. **Note, fixed (data safety):** persisted transcripts pass through the redactor.
  5. **Note (sequencing):** Phases 4 and 5 depend on each other's storage; Phases 1-3 are independent and can each ship alone.
- **Criteria:**
  - goal fidelity: pass (all 7 asks mapped);
  - current-system accuracy: pass (tagged);
  - scope: pass (non-goals explicit);
  - dependency direction: pass;
  - sequencing: pass;
  - completeness: pass;
  - failure and recovery: pass after finding 1;
  - verification: pass (per phase);
  - feasibility: pass with 2 marked checks;
  - decision readiness: 5 decisions surfaced with defaults.
- **Overall:** 1 blocking (fixed), 2 must-verify (checked first in their phases), 2 notes.

## Changes made

- Phase 1: command `category`; `lowlight` 3.3.0 + `highlight.js` 11.11.2 (22 languages, spans from a token tree, theme-variable colors; webview 172 KB minified); `.claude/agents` translation and Agent Skills from four folders (user ones mounted read-only). Unit 140, VS Code 36.
- Phase 2: harness readiness (`claude auth status` JSON, `codex login status` on stderr, OpenCode = installed; a check that can't run never blocks); agent chip menu grouped YourStack / Agents; send refused with the fix when an agent definitely can't start; model chip provider-first with key status; Manage providers (set, replace, remove, test); Agent logins (terminal login, API key, DeepSeek, remove); walkthrough; settings in 3 categories; our harness named "YourStack". Unit 143, VS Code 39.
- Phase 3: `+` menu, `@` path search, `/` skills, chips, drop handler, Explorer "Add to YourStack chat"; YourStack gets paths in the message, ACP agents `resource_link` blocks. Unit 149, VS Code 40. Drag from the Explorer into the panel is not verified (needs a manual check).
- Phase 4: shadow-repo snapshots (first 4.5 s for 10k files, taken in the background; then about 60 ms), Restore (files and conversation, or files only; confirm with file list; refuses unsaved buffers; Undo), persisted conversations with a history list, YourStack history re-seeded with LangGraph `updateState`, CLI agents reloaded with ACP `session/load` (replay dropped). Unit 159, VS Code 42.
- Phase 5: Fork (YourStack from any message; Claude Code whole session via `unstable_forkSession`), Conversations, Issue, and Pull Request attachments (VS Code GitHub sign-in; untrusted, capped at 20,000 characters). Unit 166, VS Code 44.
- Found along the way: Codex is logged in now, but its adapter didn't confirm Read-only mode, so YourStack refuses to run it (fail-closed, as designed).

- Before planning (M's direct asks):
  - git initialized (`main`, `.gitignore`; nothing committed);
  - real-key DeepSeek checks passed (direct call with model options; live: Deep Agents and Claude Code on DeepSeek);
  - Codex probed: needs `codex login`.

## Open questions

The 5 decisions in the research file (defaults above).
