# Customisation and advanced settings (option B)

- Date: 2026-10-18 19:00
- Status: done
- Repos: yourstack   Folders: src/gate, src/agent, src/providers, src/ui, src/webview, package.json, test
- Files:
  - New: `src/gate/rules.ts`, `src/agent/instructions.ts`, `src/agent/namedAgents.ts`, `test/unit/rules.test.ts`, `test/unit/instructions.test.ts`, `test/unit/namedAgents.test.ts`
  - Changed: `package.json`, `src/gate/approvalGate.ts`, `src/agent/createAgent.ts`, `src/workspaceRuntime.ts`, `src/controller.ts`, `src/providers/registry.ts`, `src/agent/rebuildPolicy.ts`, `README.md`, `test/vscode/suite.ts`
- Subagents: none
- Research: `docs/research/2026-10-18-1830_customisation-advanced-settings_research.md`

## Context and problem

M wants YourStack to be customisable, and its advanced settings to be usable. Today:

- Deep Agents runs on one fixed prompt plus `AGENTS.md`.
- Approvals are all-or-nothing, except an exact-match command list.
- Model parameters can't be set.
- The 8 settings sit in one flat, unordered list.

Research also found a trust gap: a repo's own `.vscode/settings.json` can set the settings that decide what YourStack runs and where keys go.

M chose (2026-10-18):

- **Scope:** option B.
- **Files:** `.yourstack/` files plus `AGENTS.md`.
- **Approvals:** allow/ask/deny rule lists in user settings.
- **No skip-all-approvals mode.**
- **Order:** trust fix first.

## Goals / Non-goals

Goals:

1. **Trust fix:** settings that run programs, skip approvals, or choose endpoints can only come from the user, never from a workspace, and are restricted in untrusted workspaces.
2. **Organised settings:** categories with order, Markdown descriptions, `advanced` tags. The `...` menu's Open settings shows only YourStack's settings.
3. **Approval rules** (`yourstack.approvals.allow`, `.ask`, `.deny`; user settings only):
   - **Syntax:** `run(npm test *)`, `edit(src/**)`, `delete(tmp/**)`, `read(.env*)`, `tool(browser_*)`.
   - **Precedence:** deny, then ask, then allow; the first match wins. No match: ask, as today.
   - **Deny:** a denied action is refused without a card, and the transcript says which rule refused it.
4. **Instructions:**
   - User file `~/.yourstack/AGENTS.md`, always loaded, including in Restricted Mode, since it's the user's own.
   - Project `AGENTS.md`, as today.
   - Project rules `.yourstack/rules/*.md`, whose frontmatter is `description`, `globs`, `alwaysApply`:
     - `alwaysApply: true`: the rule text goes into the prompt;
     - otherwise: the rule is listed in the prompt with its description and globs, and the agent reads the file when relevant (reads don't ask).
   - No project files load in Restricted Mode.
5. **Named agents:** `.yourstack/agents/*.md` (project) and `~/.yourstack/agents/*.md` (user; project wins on the same name). Frontmatter: `name`, `description`, optional `tools` (subset of `edit`, `run`, `browser`, `mcp`; reading files is always allowed), optional `model` (a model id on the current Deep Agents provider, so no second key is needed). The body is the agent's prompt.
   - Each agent is available two ways:
     - as a delegate the main Deep Agents agent can hand work to (Deep Agents `subagents`);
     - as an entry in the agent picker (`Deep Agents: <name>`).
   - Every action still goes through the gate.
6. **Model parameters** (`yourstack.modelOptions`): `temperature`, `maxOutputTokens`, `reasoningEffort` (`low` | `medium` | `high`, mapped per provider). A parameter a provider can't take is named in the setup banner, not silently dropped.
7. **Changes apply without a restart:**
   - Approval rules are read live by the gate on every request (as `commandAllowList` is today), so they need no rebuild.
   - Editing instruction or agent files rebuilds Deep Agents workspaces at their next idle moment (existing rebuild policy).
   - A workspace whose named agent's file was deleted falls back to plain Deep Agents, with a notice.

Non-goals:

- Reading `.claude/agents` or `.claude/skills` (M chose `.yourstack/` first; a translation layer can come later).
- Slash commands, skills, hooks, model profiles, or a settings webview (option C).
- Rules for CLI agents (Claude Code, OpenCode, Codex). They keep their own config and ask through ACP as today; the README says so.
- Project-level approval rules (rules live in user settings only).
- Any mode that skips approvals.

## What is true today

| Fact | Evidence |
| --- | --- |
| The gate's whole decision: an execute request that exactly matches `commandAllowList` with no shell operators runs; everything else asks | [verified: `src/gate/approvalGate.ts:41-51`] |
| Gate requests carry the agent's workspace-rooted path (e.g. `/src/a.ts`) for read, write, edit, delete; `tool` requests carry the tool name | [verified: `src/backend/gatedBackend.ts:31,82,96,105,120`; `src/gate/gatedTool.ts:16`] |
| Read requests reach the gate only for sensitive files (`.env*`, `*.pem`, `*.key`, `id_*`) | [verified: `src/backend/gatedBackend.ts:31`] |
| System prompt is a constant; memory is `["/AGENTS.md"]` in trusted workspaces | [verified: `src/agent/createAgent.ts:17-30`] |
| Deep Agents accepts `subagents` (`name`, `description`, `systemPrompt`, `tools`, `model`) | [verified: `node_modules/deepagents/dist/agent-uMkCMHJp.d.ts`, `SubAgent`] |
| No setting declares `scope`; no `restrictedConfigurations` | [verified: `package.json`] |
| Settings without `scope` default to `window`, settable by a workspace; `machine`/`application` are not | [verified: https://code.visualstudio.com/api/references/contribution-points] |
| Claude Code evaluates deny, then ask, then allow; deny/ask "isn't a security boundary" (other command forms bypass it) | [verified: https://code.claude.com/docs/en/permissions] |
| `yaml@2.9.1` is installed (via deepagents) | [verified: `npm ls yaml`] |

```
today:  request --> execute && exact allow-list match && no shell operators? --yes--> run
                                       |no
                                       v
                                      card

after:  request --> rules (user settings only): deny? --yes--> refuse, note in transcript   <-- new
                                       |no
                                    ask? --yes--> card
                                       |no
                                   allow? (run: never with shell operators) --yes--> run    <-- changed
                                       |no
                                      card
```

## Options considered

The research settled scope and file locations. One design choice remains: how rules handle compound commands.

| | A. Allow never matches a command with shell operators (recommended) | B. Split compound commands and match each part (Claude Code's approach) |
| --- | --- | --- |
| How it works | Keep today's check: any `; & \| \` $( > <` or newline means an allow rule can't match | Parse `&&`, `\|\|`, `;`, `\|`; each part must be allowed |
| Safety | Simple and auditable; a missed deny falls back to a card, never to running | A shell parser is security-critical code we'd own |
| Convenience | `npm test && npm run lint` asks | Fewer cards |
| Completeness | 8/10 | 9/10 (but more risk) |

RECOMMENDATION: A, because the only way to skip a card stays one simple, tested check. Splitting can come later if cards get annoying.

## Decision

- Ship the trust fix and settings organisation first.
- Then a pure rule evaluator inside the gate.
- Then instruction assembly, named agents, and model parameters, each a small module feeding `buildAgent`.

**Structural reason:**

- The gate stays the single owner of allow and deny. Rules are data it reads, and only the user's settings can supply an allow.
- Customisation files can only add knowledge (prompts, agents). They never add permissions.

## Design

- **`package.json`:**
  - `contributes.configuration` becomes an array of categories: Models, Approvals, Agents and MCP, Advanced.
  - Each setting gets `order` and `markdownDescription`; advanced ones get `tags: ["advanced"]`.
  - Scopes:
    - `application`: `approvals.*`, `commandAllowList` (deprecated, still honored as exact `run(...)` allows), `customProviders`, `baseUrl`;
    - `machine`: `agentCommands`, `mcpServers`;
    - `window` (unchanged): `provider`, `model`, `modelOptions`, `harness`.
  - `capabilities.untrustedWorkspaces.restrictedConfigurations` lists the `application` and `machine` ones.
  - `openSettings` uses the query `@ext:local.yourstack`.
- **`src/gate/rules.ts`:** `parseRules(lists) -> { rules, problems }` and `decide(request, rules, root) -> { verdict: "allow" | "ask" | "deny", rule? }`.
  - **Run:** `*` matches any text; whole-command match.
  - **Paths:** globs relative to the workspace root, with `**` and `*`.
  - **Tools:** name globs.
  - **Allow never fires** for a `run` with shell operators.
  - **Invalid rules** are skipped and listed as a warning in the panel banner. Skipping is safe: it can only lead to a card, never to running.
- **`src/gate/approvalGate.ts`:** `request()` calls `decide()`. On `deny`, it returns false and calls `prompter.denied(request, rule)`, so the runtime posts a transcript notice. `GatePolicy` becomes `rules()`.
- **`src/agent/instructions.ts`:** `assembleInstructions({ userFile, projectRoot, trusted }) -> { systemPromptAddition, memoryPaths }`.
  - Reads `~/.yourstack/AGENTS.md` (host side; outside the workspace).
  - Lists `.yourstack/rules/*.md` and parses frontmatter with `yaml` (pinned as a direct dependency). A bad frontmatter names the file and the field.
- **`src/agent/namedAgents.ts`:** `loadNamedAgents(dirs) -> { agents, problems }`, validates fields, and maps `tools` to our tool groups:
  - `run` keeps the execute tool;
  - `edit` keeps write/edit/delete (otherwise a Deep Agents `permissions` rule denies writes);
  - `browser` and `mcp` keep those custom tools.
  - [unverified: that a Deep Agents subagent can drop the built-in execute tool; checked first in Part 4, with a fallback of denying `run` through the gate for that agent]
- **`src/workspaceRuntime.ts`:**
  - `buildDeepAgent` passes `subagents` and the assembled instructions.
  - A picker entry `deepagents:<name>` builds the same agent with that prompt and tool subset as the main agent.
  - `HARNESSES` becomes the built-ins plus the named agents found for the window.
- **`src/agent/rebuildPolicy.ts`:** new change kind `customisation` (instruction and agent files), affecting Deep Agents workspaces.
  - A `FileSystemWatcher` on `.yourstack/**` and `AGENTS.md` in the workspace triggers it, plus one on `~/.yourstack/**`. [unverified: watching a folder outside the workspace with a `RelativePattern`; checked first in Part 3, with a fallback of re-reading the user files at each rebuild and on the Reload command]
- **`src/providers/registry.ts`:**
  - `createChatModel` applies `modelOptions` per provider: temperature and max tokens for all.
  - `reasoningEffort` maps to OpenAI reasoning effort and Anthropic thinking budget. [unverified: exact field names per LangChain class; checked against their types in Part 5]
  - Unsupported combinations become a `settingsProblem` naming the parameter.

## Risks and mitigations

| Risk | Likelihood | Impact | Mitigation | How we'd notice |
| --- | --- | --- | --- | --- |
| A rule auto-approves more than intended | Medium | High | Allow can't match shell operators; deny and ask beat allow; per-rule unit tests; README warns that deny isn't a security boundary | Unit tests |
| Users lose workspace-level values for the now user-only settings | Medium | Low | README migration note; VS Code shows these settings as user-only | User reports |
| Project rules and agents act as prompt injection | Medium | Medium | Same trust as `AGENTS.md` today: never loaded in Restricted Mode; they can't add permissions | Restricted Mode test |
| Named agent's `model` needs another provider's key | Low | Low | Validated at load; a problem names the agent and the missing key | Unit test |
| File watchers cause rebuild storms | Low | Low | Existing rebuild policy defers to idle and coalesces | VS Code check |
| `reasoningEffort` field names differ per LangChain class | Medium | Low | Verified against installed types in Part 5 before use | Typecheck plus unit tests |

## Acceptance criteria

- **Trust fix:**
  - Given a workspace `.vscode/settings.json` with `yourstack.commandAllowList: ["rm -rf /"]`, then YourStack reads only the user's value.
  - Given Restricted Mode, then none of the restricted settings come from the workspace.
- **Rules:**
  - Given deny `run(rm *)`, then `rm -rf x` is refused without a card, and the transcript names the rule.
  - Given allow `run(npm test *)`, then `npm test -- --watch` runs without a card and `npm test && rm x` asks.
  - Given ask `edit(src/**)` and allow `edit(**)`, then an edit in `src/` asks.
- **Instructions:**
  - Given an `alwaysApply` rule, then its text is in the system prompt.
  - Given a description-only rule, then it is listed with its path and description.
  - Given Restricted Mode, then only the user file loads.
- **Named agents:**
  - Given `.yourstack/agents/reviewer.md`, then "Deep Agents: reviewer" is in the agent picker, the main agent can delegate to it, and its actions still ask.
  - Given a malformed file, then a problem names the file and field.
- **Model options:** given `temperature: 0.2`, then the built model has temperature 0.2; given an unsupported option, then the banner names it.
- **Live changes:** given an idle Deep Agents workspace, when a rule file changes, then the next message uses it (rebuild notice shown).

## Rollout and rollback

- **Ships in the next VSIX.** Users who set any of the now user-only settings in a workspace must move them to user settings (README note; the values are ignored, not lost).
- **Rollback:** reinstall the previous VSIX. Files in `.yourstack/` are inert without the new version.

## Parts

### Part 1: Trust fix and organised settings

- [x] Scopes, `restrictedConfigurations`, categories, order, Markdown descriptions, tags; Open settings filtered. Done when a unit test checks each sensitive setting's scope and restricted listing, and a VS Code check proves a workspace `commandAllowList` is ignored.

### Part 2: Approval rules

- [x] `rules.ts`, gate integration, deny notice, settings, `commandAllowList` compatibility. Done when unit tests cover precedence, globs, shell operators, invalid rules, and deny-without-card, and a VS Code check runs an allowed command without a card.

### Part 3: Instructions

- [x] `instructions.ts`, user file, project rules index, Restricted Mode behavior, watcher. Done when unit tests cover each frontmatter kind and malformed files, and a VS Code check shows a rule file change reaching the next run.

### Part 4: Named agents

- [x] `namedAgents.ts`, subagents, picker entries. Done when unit tests cover parsing and validation, and a VS Code check runs a named agent whose write still asks.

### Part 5: Model parameters

- [x] `modelOptions` per provider. Done when unit tests show each parameter on the built model and unsupported combinations are reported.

### Part 6: Regression and package

- [x] Unit, VS Code (dev and minified), README (rules syntax, files, migration note, deny isn't a security boundary), VSIX, reinstall. Done when all pass and the installed files match.

## Standardized review

Reviewed with the plan rubric against `src/gate/approvalGate.ts`, `src/gate/gatedTool.ts`, `src/backend/gatedBackend.ts`, `src/agent/createAgent.ts`, `src/workspaceRuntime.ts`, `package.json`, the Deep Agents types, and three re-checked sources (Claude Code permissions, Cursor rules, Copilot custom agents).

- **Findings, all fixed in this file before presenting:**
  1. **Must-verify, fixed (current-system accuracy):** rules first went through the rebuild policy, but the gate reads its policy live today (`commandAllowList` "needs no rebuild"). Rules are now read live; only file changes rebuild.
  2. **Must-verify, fixed (feasibility):** a named agent's `model` on another provider would need a second key and validation path. Scoped to a model id on the current provider.
  3. **Must-verify, marked (feasibility):** dropping the execute tool from a Deep Agents subagent isn't confirmed in the types. Part 4 checks it first; the fallback denies `run` for that agent through the gate, which is already the single decision point.
  4. **Must-verify, marked (feasibility):** watching `~/.yourstack` from the extension isn't confirmed. Part 3 checks it first; the fallback re-reads user files at each rebuild.
  5. **Note, fixed (failure and recovery):** a workspace pinned to a named agent whose file is deleted now falls back to plain Deep Agents with a notice.
- **Criteria:**
  - goal fidelity: pass (B with M's three choices; trust fix first);
  - current-system accuracy: pass after fix 1;
  - scope and cohesion: pass (option C items and CLI-agent rules excluded);
  - architecture and dependency direction: pass (the gate stays the single owner; files add knowledge, never permissions);
  - sequencing: pass (trust fix, then rules, then instructions and agents; each part testable alone);
  - completeness: pass (settings, code, tests, README, migration, rollback);
  - failure and recovery: pass after fix 5 (invalid rules can only lead to a card);
  - verification: pass (each part has unit and VS Code checks);
  - feasibility and precision: pass, with 2 unverified items each checked first and each with a fallback;
  - decision readiness: pass (one remaining choice, compound commands, presented with a recommendation).
- **Overall:** 0 blocking, 4 must-verify (2 fixed, 2 checked first in their parts), 1 note.

## Changes made

- Part 1: settings in 3 ordered categories with Markdown descriptions. `application` scope on `customProviders`, `baseUrl`, `commandAllowList`, and `approvals.*`; `machine` on `mcpServers` and `agentCommands`. All of these are in `restrictedConfigurations`. Open settings filters to `@ext:local.yourstack`. Verified: a workspace `.vscode/settings.json` setting `commandAllowList` and `agentCommands` is ignored, while an ordinary setting in the same file is read.
- Part 2: `src/gate/rules.ts` (deny > ask > allow; allow never matches shell operators; a trailing ` *` also matches the bare command, added during build so `run(npm test *)` covers `npm test`); the gate refuses denies without a card and posts a notice naming the rule; `commandAllowList` deprecated but honored as exact matches; malformed rules are skipped with a warning. Verified in VS Code with real user settings.
- Part 3: `src/agent/instructions.ts` (user `~/.yourstack/AGENTS.md` everywhere; project rules in trusted workspaces; `alwaysApply` inlined, others listed); `yaml@2.9.1` pinned; watchers on `.yourstack/**`, `AGENTS.md`, and the user folder (watching outside the workspace verified); `YOURSTACK_USER_DIR` redirects the user folder for tests.
- Part 4: `src/agent/namedAgents.ts`. Surprise: Deep Agents subagents can't drop the built-in `execute` tool. The fix is a per-agent LangChain `wrapToolCall` middleware (`toolGuard`) that refuses missing tools before the gate, for picked agents and delegates alike, so the gate fallback wasn't needed. The agent picker lists `Deep Agents: <name>`; `yourstack.harness` accepts `deepagents:<name>`; a deleted agent falls back with a notice.
- Part 5: `yourstack.modelOptions` (temperature, maxOutputTokens, reasoningEffort) mapped per provider from the installed type definitions (OpenAI `reasoning.effort`, Anthropic `thinking` budget 2048/8192/24576 with max tokens above it, Google `thinkingLevel`). Unsupported combinations become a setup problem.
- Part 6: README (rules, user-only settings and migration, customisation files, model options). Unit 132/132; VS Code 35/35 on dev and minified bundles; VSIX packaged and installed (installed bundle matches; installed package.json differs only by VS Code's `__metadata` block). The Markdown speed test was made robust with M's approval (99th percentile under 16 ms, slowest under 50 ms).

## Open questions

None. M's choices are recorded under Context.
