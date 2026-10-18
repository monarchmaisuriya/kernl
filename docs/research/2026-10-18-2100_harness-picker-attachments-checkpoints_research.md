# Harness-first picker, Claude files, highlighting, attachments, checkpoints, fork

- Date: 2026-10-18 21:00
- Status: presented
- Mode: explore options
- Repos: yourstack   Folders: src/webview, src/ui, src/agent, src/acp, src/workspaces, package.json
- Question / problem: How should YourStack let users pick an agent harness (its own or Claude Code / Codex / OpenCode) with intuitive provider settings, read `.claude/agents` and `.claude/skills`, highlight code, attach files and folders, restore checkpoints, and fork conversations?

## Options: harness first, model second; one snapshot mechanism for every agent; persisted sessions as the base for fork

- **Bottom line:** seven requests; four are independent and well understood, three share one foundation.
  - **Independent:**
    - readable labels (`category` field);
    - highlighting (`highlight.js` via `lowlight`);
    - reading `.claude/agents` and `.claude/skills` (Agent Skills standard; Deep Agents supports it);
    - attachments (`+` menu, `@` autocomplete, drag and drop, Explorer menu).
  - **Shared foundation:** checkpoints, fork, and "attach a session" all need conversations that are kept per workspace and survive a restart. Today they live in memory only.
  - **Harness-first redesign:** follows the pattern Copilot, Zed, and JetBrains converged on: pick the harness, then a model only when the harness is ours; keys in a providers screen, logins with each agent.
- **Where we are:** 3 research passes (24 primary sources) plus code and SDK reads, plus live checks. Next: M picks phase order and 5 design choices, then the plan.
- **Need from M:** the 5 decisions at the end.

### Live checks done before planning

| Check | Result | Evidence |
| --- | --- | --- |
| DeepSeek via YourStack's `createChatModel`, temperature 0.2, 64 max tokens | Replied "ok" in 1.7 s; streaming works; thinking on by default (10 reasoning tokens) | [verified: scratch run against api.deepseek.com] |
| Live suite with `DEEPSEEK_API_KEY` | Deep Agents on DeepSeek PASS; Claude Code on DeepSeek PASS; OpenCode 3/3; key capture PASS; Claude Code on the user's login 3 FAIL ("Authentication required", the known sandbox OAuth refresh issue) | [verified: live run log] |
| Codex 0.163.0 through YourStack's launch | Adapter starts; "Authentication required"; `codex login status` says "Not logged in"; no permission asked, nothing written | [verified: probe run] |
| Menu labels | Every command title hardcodes "YourStack: ..."; no `category` | [verified: `package.json`] |

### The problem, framed

- **What:** make YourStack a clear front door to several agent harnesses plus its own, and add the chat conveniences users expect: readable menus, highlighting, attachments, checkpoints, and fork.
- **Why:** the current agent dropdown mixes "Deep Agents (BYOK)" with CLI agents, provider settings are scattered, and the `...` menu reads "YourStack: ..." five times.
- **Who:** M and the team.
- **Where:** panel (composer, footer, messages), host (controller, runtimes, ACP runner), settings and manifest.
- **How much:** large; phased below.

### What must be true

- **Approval gate unchanged.** Attachments, checkpoints, and forks never bypass it. Restore writes files; that is the user's own action on their own snapshot, so it asks once with a list of the files it will change. [design constraint]
- **No HTML in the webview.** Highlighting must give tokens, not HTML. [verified: `test/unit/webviewSafety.test.ts`]
- **CLI agents write files themselves** (not through our editor path), so per-edit "before" copies would miss their changes and their shell side effects. A whole-workspace snapshot per message covers every harness. [verified: README "CLI agents perform approved actions themselves"; research]
- **Conversations are in memory:** Deep Agents uses `MemorySaver`; ACP sessions live in the agent process. [verified: `src/agent/createAgent.ts`; LangGraph docs say MemorySaver loses everything on restart]
- **ACP fork is unstable and whole-session only;** the Claude Code adapter implements it, OpenCode and Codex are unconfirmed. [verified: SDK `ForkSessionRequest`; adapter `unstable_forkSession`; https://agentclientprotocol.com/rfds/session-fork]
- **ACP attachments:** `resource_link` (URI + name) is accepted by every agent; embedded file contents only if the agent advertises `embeddedContext`. [verified: SDK `ContentBlock`, `PromptCapabilities`]
- **Explorer to webview drag and drop:** unconfirmed. One report says it needs Shift, otherwise VS Code opens the file. [unverified: https://claudeissues.com/issue/19222-feature-request-drag-and-drop-files-from-vs-code-explorer; check: manual drop in the real panel]

### Findings per feature

**1. Readable labels.**

- Commands get `"category": "YourStack"` and plain titles ("Set API key").
- The Command Palette still shows "YourStack: Set API key"; menus show the plain title. [verified: https://code.visualstudio.com/api/references/contribution-points]

**2. Harness-first picker and settings** (Copilot "Session Target", Zed, JetBrains).

- **Pick the harness first:** YourStack (ours), Claude Code, Codex, OpenCode. Only ready harnesses are selectable; others show "Set up ...". [verified: https://code.visualstudio.com/docs/copilot/agents/third-party-agents]
- **Model second,** only for our harness, grouped by provider. External agents own their model and login. [verified: https://zed.dev/docs/ai/external-agents]
  - The Claude Code adapter exposes no settable model option. [verified: adapter source]
- **Keys in a providers screen; agent logins shown per agent with status.** [verified: https://www.jetbrains.com/help/ai-assistant/activate-agents.html]
- **First run:** a walkthrough (`contributes.walkthroughs`), not a settings webview. [verified: https://code.visualstudio.com/api/ux-guidelines/walkthroughs]

**3. `.claude/agents` and `.claude/skills`.**

- **Agents:** frontmatter `name`, `description`, `tools`/`disallowedTools` (comma string or list), `model` (aliases or `inherit`), and more. Unknown fields are ignored. [verified: https://code.claude.com/docs/en/sub-agents]
  - Tool names map to our groups: `Read`/`Grep`/`Glob` = read (always allowed); `Edit`/`Write`/`NotebookEdit` = edit; `Bash` = run; `WebFetch`/`WebSearch` = browser; `mcp__*` = mcp; `Agent`/`Task` and the rest are ignored.
- **Skills:** `SKILL.md` folders follow the Agent Skills standard, which Deep Agents also follows. [verified: https://code.claude.com/docs/en/skills; https://docs.langchain.com/oss/javascript/deepagents/skills; https://agentskills.io/specification]
  - Deep Agents loads skills from backend paths; user skills in `~/.claude/skills` sit outside the workspace, so they need a read-only route. [inferred: `createDeepAgent` `skills` takes backend paths]

**4. Syntax highlighting.**

- `lowlight` (highlight.js core, about 20 languages): about 108 KB minified, synchronous, returns a token tree, no WASM, styled with CSS classes. [verified: measured bundle; lowlight 3.3.0 pins highlight.js 11.11.x]
- **Shiki:** about 2.4 MB. **starry-night:** needs WASM, which our CSP blocks.
- **Theme colors:** VS Code doesn't expose the editor's syntax colors to webviews. Map token classes to general theme variables with fallbacks. [unverified: no official doc found]

**5. Attachments.**

- **`+` menu:** "Files & Folders..." (VS Code QuickPick over workspace files, or the OS file dialog), "Sessions..." (needs persisted sessions), "Issue..." and "Pull Request..." (GitHub).
- **`@` autocomplete:** in the composer, the host searches `workspace.findFiles` and the panel shows suggestions.
- **Drag and drop:** see the must-verify above. **Fallback:** an Explorer context-menu command "Add to YourStack chat".
- **Delivery:**
  - Deep Agents gets workspace paths in the message; it reads them with its own tools, and sensitive files still ask.
  - ACP agents get `resource_link` blocks.

**6. Checkpoints and restore.** Every tool snapshots at user-turn boundaries and none undoes terminal side effects. [verified: https://code.claude.com/docs/en/checkpointing; https://code.visualstudio.com/docs/copilot/chat/chat-checkpoints; https://roocodeinc.github.io/Roo-Code/features/checkpoints]

- **Copilot:** restores files and cuts the conversation (Redo available).
- **Cursor:** files only.
- **Claude Code and Cline:** both, as options.
- **Cline and Roo:** a shadow git repository; they respect `.gitignore`; large repos are slow.

**7. Fork.**

- Copilot's "Fork Conversation" creates an independent session with history up to that request. [verified: same Copilot page]
- **For Deep Agents:** LangGraph keeps per-checkpoint state, and `updateState` branches from a checkpoint. [verified: https://docs.langchain.com/oss/javascript/langgraph/use-time-travel]
- **For ACP:** `session/fork` copies the whole session only (Claude Code), so "fork from here" isn't possible for CLI agents. [verified: ACP RFD]

### Options for the shared foundation (checkpoints and sessions)

| | A. Shadow git repo per workspace plus JSON session store (recommended) | B. Hidden refs in the user's own repo plus SQLite checkpointer | C. Per-edit before-copies plus in-memory sessions |
| --- | --- | --- | --- |
| How it works | Before each message: `git add -A` + `write-tree` into a repo in extension storage, with `GIT_WORK_TREE` = the workspace (`.gitignore` respected). Sessions: transcript + messages as JSON in workspace storage; Deep Agents rebuilt from stored messages; Claude Code via ACP `session/load` | Snapshots as `refs/yourstack/*` in the user's repo; LangGraph `SqliteSaver` | Copy each file before our edit; nothing persisted |
| Covers CLI agents and shell changes to files | Yes | Yes | No |
| Works in a non-git folder | Yes | No | Yes |
| Touches the user's repo | No | Adds hidden refs and objects | No |
| New dependencies | None (uses `git`, already required for worktrees) | `better-sqlite3` native module (packaging per platform) | None |
| Cost | Snapshot time on large repos (measure) | Same, plus a native build | Low, but incomplete |
| Completeness | 9/10 | 7/10 | 4/10 |

RECOMMENDATION: A, because it covers every harness, doesn't touch the user's repo, and needs no native module.

### Recommended phase order

1. **Quick wins:** readable labels, syntax highlighting, `.claude/agents` and `.claude/skills`. Independent; small.
2. **Harness-first picker and settings:** the redesign M described.
3. **Attachments:** Files & Folders, `@` autocomplete, `/` for skills, drag and drop (verified first), Explorer menu.
4. **Sessions and checkpoints:** persisted sessions (history list), snapshots per message, Restore.
5. **Fork and the remaining attachments:** fork from a message (Deep Agents) or whole session (Claude Code); "Sessions...", "Issue...", "Pull Request..." attachments.

### Decisions for M

1. **Phase order:** as above (recommended), or a different order.
2. **Snapshot and session storage:** option A (recommended), B, or C.
3. **Restore behavior:**
   - "Restore files and conversation" plus "Restore files only" (recommended; Claude Code and Cline offer both); or
   - files and conversation only (Copilot).

   For CLI agents only "files" is possible; the conversation can't be cut over ACP.
4. **Our harness's name in the picker:**
   - "YourStack" (recommended: it's the product; "Deep Agents" is the library); or
   - keep "Deep Agents".
5. **Issue and pull request attachments:**
   - VS Code's GitHub sign-in API (recommended: no extra CLI); or
   - the `gh` CLI; or
   - leave them out.

### Sources

- Checkpoints and fork: https://code.claude.com/docs/en/checkpointing, https://code.claude.com/docs/en/sessions, https://cursor.com/docs/agent/chat/checkpoints, https://cursor.com/help/ai-features/agent, https://code.visualstudio.com/docs/copilot/chat/chat-checkpoints, https://docs.cline.bot/features/checkpoints, https://roocodeinc.github.io/Roo-Code/features/checkpoints, https://agentclientprotocol.com/protocol/session-setup, https://agentclientprotocol.com/rfds/session-fork, https://agentclientprotocol.com/rfds/v2/required-session-methods, https://docs.langchain.com/oss/javascript/langgraph/checkpointers, https://docs.langchain.com/oss/javascript/langgraph/use-time-travel, https://docs.langchain.com/oss/javascript/langgraph/persistence
- Harness and settings UX: https://code.visualstudio.com/docs/agents/concepts/agent-harnesses, https://code.visualstudio.com/docs/copilot/agents/third-party-agents, https://code.visualstudio.com/docs/copilot/customization/language-models, https://zed.dev/docs/ai/external-agents, https://zed.dev/docs/ai/use-api-access, https://www.jetbrains.com/help/ai-assistant/activate-agents.html, https://docs.cline.bot/getting-started/selecting-your-model, https://roocodeinc.github.io/Roo-Code/features/api-configuration-profiles, https://code.visualstudio.com/api/references/contribution-points, https://code.visualstudio.com/api/ux-guidelines/views, https://code.visualstudio.com/api/ux-guidelines/walkthroughs
- Highlighting and Claude formats: https://highlightjs.readthedocs.io/en/latest/api.html, https://shiki.style/guide/regex-engines, https://github.com/wooorm/starry-night, https://lezer.codemirror.net/docs/ref/, https://code.claude.com/docs/en/sub-agents, https://code.claude.com/docs/en/tools-reference, https://code.claude.com/docs/en/skills, https://agentskills.io/specification, https://docs.langchain.com/oss/javascript/deepagents/skills
- Drag and drop (secondary): https://claudeissues.com/issue/19222-feature-request-drag-and-drop-files-from-vs-code-explorer, https://claudeissues.com/issue/73853-vscode-drag-and-drop-file-reference-inserts-absolute-path-instead-of-workspace-r
- Our code and SDKs: `package.json`, `src/agent/createAgent.ts`, `src/agent/session.ts`, `src/acp/acpRunner.ts`, `node_modules/@agentclientprotocol/sdk/dist/schema/types.gen.d.ts`, the claude-agent-acp 0.93.0 source

## Standardized review

Reviewed with the research rubric (option comparison).

- **Findings:**
  1. **Must-verify (source quality):** Explorer-to-webview drag and drop rests on one third-party report. The plan makes a manual drop check the first task of the attachments phase, with the Explorer menu as a fallback that doesn't depend on it.
  2. **Must-verify (feasibility):** snapshot time on large repositories is unmeasured. The plan measures it on a repository with about 10,000 files before wiring snapshots into every message.
  3. **Note (coverage):** OpenCode's and Codex's support for `session/load` and fork wasn't checked. Their sessions will show history read-only after a restart until it is.
  4. **Note (uncertainty):** mapping highlight colors to general theme variables is inferred; screenshots in three themes will show whether it reads well.
- **Criteria:**
  - question fit: pass;
  - method: pass (3 parallel source passes, code and SDK reads, live runs);
  - source quality: pass, with finding 1;
  - coverage: pass, including the status quo (C);
  - traceability: pass;
  - evidence handling: pass;
  - analysis: pass (same rows per option);
  - codebase fit: pass;
  - uncertainty: pass, with findings 2-4;
  - proportionality: pass;
  - reproducibility: pass.
- **Overall:** present. 0 blocking, 2 must-verify, 2 notes.
