# Customisation and advanced settings for YourStack

- Date: 2026-10-18 18:30
- Status: presented
- Mode: explore options
- Repos: yourstack   Folders: package.json (settings), src/agent, src/gate, src/providers, src/ui
- Question / problem: What should users be able to customise in YourStack, where should each customisation live, and how do we expose advanced settings without weakening the approval model?

## Options: give users file-based instructions, agents, and approval rules plus well-organised settings, after closing a settings trust gap

- **Bottom line:**
  - Every comparable tool has converged on three building blocks:
    - Markdown instruction files whose frontmatter says when they load;
    - named agents (prompt + tools + model);
    - allow/ask/deny approval rules, where deny wins.
  - Recommendation: build those three on Deep Agents' existing hooks, organise the plain settings in VS Code's Settings editor (no settings webview), and first fix a gap where a repo's own settings can steer what YourStack runs.
- **Where we are:** framing done; 2 research passes (5 tools' official docs; VS Code's settings guidance plus 5 extensions' manifests); current code read. Next: M picks, then the plan.
- **Need from M:** pick a scope (A, B, or C) and answer the 3 design questions at the end.

### The problem, framed

- **What:** let users shape how the agent behaves (instructions, agents, approvals, model parameters) and tune advanced options, safely.
- **Why:** today Deep Agents has one fixed system prompt plus `AGENTS.md`. Approvals are all-or-nothing except an exact-match command list. Model parameters can't be set.
- **Who:** M and the team using the VSIX. Repos may be anyone's.
- **Whom:** developers who use different repos with different conventions.
- **When:** no deadline; next feature after Markdown replies.
- **Where:** Deep Agents harness (`src/agent/createAgent.ts`), the approval gate (`src/gate/`), settings (`package.json`), the panel's `...` menu.
- **Which:** Deep Agents' own `memory`, `subagents`, `skills`, `permissions`, and `interruptOn` options; VS Code `contributes.configuration`.
- **How:** files in the repo or the user's home folder, plus organised settings.
- **How much:** medium. Changes the system prompt assembly, the gate's decision function, and settings metadata. The approval gate is the riskiest part.

### What must be true

Hard constraints:

- The approval gate stays the single owner of side effects. Customisation may make it stricter freely; making it looser must be the user's own choice, never a repo's. [verified: `src/gate/approvalGate.ts` is the only decision point]
- Secrets stay in SecretStorage, never in settings or files. [verified: `src/providers/keys.ts`, `src/acp/credentials.ts`]
- Restricted Mode stays read-only: no project-supplied instructions, agents, or rules load there. [verified: `loadProjectRules: false` in Restricted Mode, `src/workspaceRuntime.ts:207`]

Conventions:

- Settings go in the Settings editor, not a custom webview. VS Code's UX guide says "Don't: Create your own settings page/webview". [verified: https://code.visualstudio.com/api/ux-guidelines/settings]
- Cross-tool files are read, not reinvented. `AGENTS.md` is read by Cursor, Copilot, and Cline. [verified: second research pass, sources below]

Checks:

- Deep Agents supports named subagents (prompt, tools, model, skills, permissions), `SKILL.md` skill folders, extra memory files, and first-match-wins filesystem permission rules. [verified: `node_modules/deepagents/dist/agent-uMkCMHJp.d.ts`, `CreateDeepAgentParams`, `SubAgent`, `FilesystemPermission`]
- CLI agents (Claude Code, OpenCode, Codex) already read their own customisation files (`CLAUDE.md`, `.claude/`, OpenCode config). YourStack should not duplicate them; it only passes them through. [verified: Claude Code docs; `src/acp/agents.ts` launches them in the workspace]
- Exception: with a stored key, Claude Code runs on an isolated config folder, so the user's `~/.claude` customisations don't load (project `.claude/` is unverified). [verified: `src/acp/credentials.ts`]

### What comparable tools offer

| Surface | Claude Code | Cursor | Copilot (VS Code) | Cline / Roo | Continue |
| --- | --- | --- | --- | --- | --- |
| Instruction files | `CLAUDE.md` at 4 levels, concatenated; `.claude/rules/*.md` with `paths:` globs | `.cursor/rules/*.mdc`: always / globs / description / manual | `copilot-instructions.md`; `*.instructions.md` with `applyTo`; reads `AGENTS.md`, `CLAUDE.md` | `.clinerules/` with `paths:`; per-rule toggles | `.continue/rules/*.md` with `globs`, `alwaysApply` |
| Named agents / modes | `.claude/agents/*.md` (tools, model, permission mode) | `.cursor/agents/`; also reads `.claude/agents`; custom modes removed | `*.agent.md`; also reads `.claude/agents` | Roo `.roomodes`: role, tool groups, file regex | Model roles |
| Slash commands | `.claude/skills/x/SKILL.md` = `/x` | Custom commands | `*.prompt.md` = `/name` | n/a | Prompts with `invokable: true` |
| Approval rules | allow / ask / deny `Tool(specifier)`; deny wins; modes | Allowlist run mode; `permissions.json`; CLI allow/deny | Terminal auto-approve map; `false` wins; per-tool scope | Per-class toggles; Roo command prefix allow/deny | n/a |
| Model parameters | model, effort, available models | Auto / Max / effort | model per agent | Roo profiles: provider + model + temperature + thinking | model roles and params |
| Scopes | managed > local > project > user | team > project + user | org + workspace + user | workspace > global | user + workspace |

Sources for every cell are in the Sources list. Cursor's custom-mode removal is confirmed only by the forum (UNCONFIRMED from a changelog).

**Patterns:**

- **Instruction files:** almost identical trigger model everywhere: always, file glob, agent-decided by description, or manual.
- **Agent definitions:** `.claude/agents` is becoming a de facto format; Cursor and Copilot both read it.
- **Approval rules:** deny wins everywhere, and loosening rules live in the user's own settings.

### What YourStack has today

| Area | Today | Evidence |
| --- | --- | --- |
| Instructions | One fixed system prompt plus `/AGENTS.md` (trusted workspaces only) | [verified: `src/agent/createAgent.ts:17-30`] |
| Agents | One Deep Agents agent; no named agents or subagents | [verified: same file] |
| Approvals | Everything asks, except exact matches in `yourstack.commandAllowList` with no shell operators | [verified: `src/gate/approvalGate.ts`, README table] |
| Model parameters | Provider and model only; no temperature, max tokens, or reasoning effort | [verified: `src/providers/registry.ts`, `createChatModel`] |
| Settings organisation | 8 settings in one flat section; no `order`, `scope`, `markdownDescription`, or tags | [verified: `package.json` dump] |
| Settings trust | No `scope` on any setting; no `restrictedConfigurations` | [verified: `package.json`] |

### Must-fix found during research: a repo's settings can steer YourStack

- **Mechanism:** settings without a `scope` default to `window`, which a workspace's `.vscode/settings.json` can set. [verified: https://code.visualstudio.com/api/references/contribution-points]
- **Affected settings and what a repo could do once the folder is trusted:**
  - `commandAllowList`: commands run without a card;
  - `agentCommands`: launch any program, with any env;
  - `mcpServers`: start any program;
  - `customProviders` / `baseUrl`: send a stored key to the repo's server. [inferred from `src/providers/registry.ts` `resolveProvider`; not exploited]
- **Precedent:** VS Code ignores `git.path` when set in a workspace. [verified: https://code.visualstudio.com/docs/configure/settings]
- **Fix:** `machine` or `application` scope on these settings, plus `restrictedConfigurations`. VS Code then never reads them from a workspace. This ships first in every option below.

### Options

| | A. Advanced settings only | B. Customisation core (recommended) | C. Everything |
| --- | --- | --- | --- |
| What you get | Trust fix; settings in categories with order, rich descriptions, `advanced` tags; model parameters (temperature, max output tokens, reasoning effort); "Open settings" filtered to YourStack | A, plus: user and project instruction files with frontmatter triggers; named agents (pick one in the agent picker, or the main agent delegates to them); approval rules allow / ask / deny | B, plus: slash-command prompt files, skills, hooks, model profiles, a settings webview |
| How it fits our code | `package.json` metadata; `createChatModel` params | Deep Agents `memory`, `subagents`, `permissions`; one rule evaluator inside `ApprovalGate` | Adds a composer command system, a hook runner, and a webview |
| Cost and blast radius | Small; no behavior change except the trust fix | Medium; the gate's decision function changes, so heavy tests | Large; hooks run user code; a webview the VS Code guide advises against |
| When it fails | Users still can't shape the agent | A wrong rule evaluator could auto-approve too much (mitigated: deny wins; user-scope only; tests per rule) | Scope creep; hooks are a second execution path to secure |
| Evidence | VS Code settings guide; 5 manifests | All five tools converge on these three; Deep Agents supports them natively | Claude Code and Copilot ship these, at much larger scale |
| Completeness | 5/10 | 9/10 | 7/10 (wide but thin per feature) |

### Flow of the recommended option

```
user file (~/.yourstack/AGENTS.md) --+
project AGENTS.md + .yourstack/rules/*.md (frontmatter: always | globs | description) --+--> system prompt + memory   <-- new
.yourstack/agents/*.md (name, description, tools, model, prompt) --> Deep Agents subagents + agent picker entries     <-- new
tool call --> ApprovalGate --> rules (user settings only): deny > ask > allow, first match --> card or run                <-- changed
```

### Recommendation

RECOMMENDATION: B, because it delivers the three building blocks every comparable tool converged on. It uses hooks Deep Agents already has, and it keeps the trust boundary: repos can make the agent stricter or better-informed, never looser.

### Design questions for M (needed before the plan)

1. **File location:**
   - our own `.yourstack/` folder (rules, agents) plus `AGENTS.md`; or
   - also read `.claude/agents` and `.claude/skills` like Cursor and Copilot do.

   Recommend `.yourstack/` plus `AGENTS.md` first: Claude Code agent files name tools (`Bash`, `Edit`) that don't map one to one to ours, so reading them needs a translation layer.
2. **Approval rules syntax:**
   - Claude-style `Tool(specifier)` lists (`run(npm test *)`, `edit(src/**)`) with allow / ask / deny; or
   - simple per-class toggles (Cline style).

   Recommend rule lists: more precise, and the same mental model as Claude Code and the Cursor CLI.
3. **A "skip all approvals" mode:**
   - none (current stance); or
   - an explicit user-level opt-in.

   Recommend none: the approval gate is the product's core promise.

### Sources

- Claude Code: https://code.claude.com/docs/en/settings, https://code.claude.com/docs/en/memory, https://code.claude.com/docs/en/permissions, https://code.claude.com/docs/en/hooks, https://code.claude.com/docs/en/skills, https://code.claude.com/docs/en/sub-agents, https://code.claude.com/docs/en/output-styles, https://code.claude.com/docs/en/model-config
- Cursor: https://cursor.com/docs/context/rules, https://cursor.com/docs/agent/modes, https://cursor.com/docs/subagents, https://cursor.com/docs/agent/security/run-modes, https://cursor.com/docs/cli/reference/permissions, https://cursor.com/docs/context/mcp, https://forum.cursor.com/t/what-happened-to-custom-modes/147068
- Copilot in VS Code: https://code.visualstudio.com/docs/copilot/customization/custom-instructions, https://code.visualstudio.com/docs/copilot/customization/prompt-files, https://code.visualstudio.com/docs/copilot/customization/custom-agents, https://code.visualstudio.com/docs/agent-customization/tool-sets, https://code.visualstudio.com/docs/agents/approvals
- Cline / Roo: https://docs.cline.bot/customization/cline-rules, https://docs.cline.bot/features/auto-approve, https://docs.cline.bot/core-workflows/plan-and-act, https://roocodeinc.github.io/Roo-Code/features/custom-modes, https://roocodeinc.github.io/Roo-Code/features/auto-approving-actions, https://roocodeinc.github.io/Roo-Code/features/api-configuration-profiles
- Continue: https://docs.continue.dev/customize/deep-dives/configuration, https://docs.continue.dev/reference, https://docs.continue.dev/customize/deep-dives/rules, https://docs.continue.dev/customize/deep-dives/prompts
- VS Code settings: https://code.visualstudio.com/api/references/contribution-points, https://code.visualstudio.com/docs/configure/settings, https://code.visualstudio.com/api/ux-guidelines/settings, https://code.visualstudio.com/api/ux-guidelines/webviews, https://code.visualstudio.com/api/extension-guides/workspace-trust, https://code.visualstudio.com/docs/configure/settings-sync
- Extension manifests: https://github.com/microsoft/vscode-copilot-chat/blob/main/package.json, https://github.com/gitkraken/vscode-gitlens/blob/main/package.json, https://github.com/cline/cline/blob/main/apps/vscode/package.json, https://github.com/RooCodeInc/Roo-Code/blob/main/src/package.json
- Our code: `src/agent/createAgent.ts`, `src/gate/approvalGate.ts`, `src/providers/registry.ts`, `src/workspaceRuntime.ts`, `package.json`, `node_modules/deepagents/dist/agent-uMkCMHJp.d.ts`

## Standardized review

Reviewed with the research rubric (option comparison type).

- **Findings:**
  1. **Must-verify (source quality):** the tool survey came from a delegated research pass. I spot-checked its claims against the structure of the cited official pages, but did not re-read every page. The recommendation rests on the cross-tool pattern, which five independent sources support, not on any single cell. Check: open 3 cited pages (Claude permissions, Cursor rules, Copilot custom agents) during the plan.
  2. **Note (coverage):** Codex's and OpenCode's own customisation surfaces were not surveyed. Acceptable, because YourStack passes CLI agents' own files through rather than re-implementing them.
  3. **Note (uncertainty):** the settings trust gap is inferred from VS Code's documented scope behavior and our manifest, not exploited live. The plan's first part should include a VS Code test where a workspace sets `commandAllowList` and it is ignored.
- **Criteria:**
  - question and decision fit: pass;
  - method: pass (official docs, manifests, our code);
  - source quality: pass, with must-verify 1;
  - coverage and alternatives: pass, including status quo (A);
  - claim traceability: pass (sources per tool);
  - evidence handling: pass (tags, UNCONFIRMED kept);
  - analysis quality: pass (same rows per option);
  - codebase fit: pass (Deep Agents hooks verified);
  - uncertainty and limits: pass;
  - recommendation proportionality: pass;
  - reproducibility: pass.
- **Overall:** present. 0 blocking, 1 must-verify, 2 notes.
