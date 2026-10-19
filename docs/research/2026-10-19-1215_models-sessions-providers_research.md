# Models, thinking, and context per agent; importing CLI sessions; custom providers with headers

- Date: 2026-10-19 12:15
- Status: presented
- Mode: explore options
- Repos: kernl   Folders: `src/providers/`, `src/acp/`, `src/sessions.ts`, `src/controller.ts`, `src/webview/`
- Question / problem: how should kernl let M change the model, thinking, and context per model and per agent (kernl, Claude Code, Codex, OpenCode); import Claude Code, Codex, and OpenCode sessions and keep them in sync; and add custom providers with custom headers for kernl's own agent?

Sources were read on this machine: the ACP SDK and adapters' code, each CLI's session store (structure only, no contents), and kernl's code. Detailed notes, with file:line references, are in the session scratchpad files `acp-options-sessions.md` and `cli-sessions.md`, summarized here.

## Options: use what each agent already offers over ACP, and kernl's own model profiles

- **Bottom line:**
  - **CLI agents:** their own model, effort, and fast-mode switches become kernl chips, using ACP session config options, which all three already expose.
  - **kernl's agent:** gets per-model profiles (thinking, output, context window), and a model list fetched from the provider.
  - **Importing CLI sessions:** through ACP's stable `session/list` and `session/load`, with each CLI's session files watched only as a "something changed" signal.
  - **Custom providers:** gain headers (secret values in SecretStorage) and an OpenAI or Anthropic protocol.
- **Where we are:** framing done; 3 adapters, the ACP SDK, 3 session stores, and kernl's code read; next is the plan.
- **Need from M:** pick per decision (in the plan).

### The problem, framed

- **What:** a control per model and agent for model, thinking, and context; the CLIs' existing sessions inside kernl, kept current; and header-authenticated custom providers for kernl's agent.
- **Why:** M switches agents and models often; conversations started in a terminal or the Claude app should continue in kernl; a company gateway (for example LiteLLM) needs headers.
- **Who:** M; anyone using kernl with gateways or several agents.
- **Where:** the composer's chips, Conversations, Settings, and "kernl: Add custom provider".
- **How much:** four parts, each independent.

### What is true today (kernl)

| Area | Today | Evidence |
| --- | --- | --- |
| kernl's model | Typed by id; no list | `src/providerManager.ts` (model input box) |
| kernl's thinking and output | One global `kernl.modelOptions` (temperature, maxOutputTokens, reasoningEffort low/medium/high); not per model; no panel control | `src/providers/registry.ts:46-73` |
| kernl's context | Deep Agents compacts at 85% of the model profile's `maxInputTokens`, else at 170k tokens; kernl sets neither | `deepagents/dist/langsmith-*.js:3497-3553` |
| CLI agents' model and effort | Not shown; config changes are used only to follow the permission mode | `src/workspaceRuntime.ts:266-281` |
| CLI sessions | kernl stores `{sessionId}` for its own conversations and loads them with `session/load`, discarding the replayed history | `src/acp/acpRunner.ts:313-330, 478` |
| Custom providers | `{id, label, baseUrl, model}`, OpenAI-compatible only, key required, no headers | `src/providers/registry.ts:75-98, 164-168` |

### What the agents offer (verified in installed versions)

| | Claude Code (claude-agent-acp 0.93.0) | Codex (codex-acp 2.2.2) | OpenCode 2.0.32 |
| --- | --- | --- | --- |
| Model | config option `model`; context size is part of the model id (e.g. `opus[1m]`) | `model` | `model` (`provider/model`) |
| Thinking | `effort`: default, low…max (per model) | `reasoning_effort` | `effort` (model variants) |
| Fast mode | `fast` (boolean, models that support it) | `fast-mode` | none |
| Changing it | `setSessionConfigOption`; a model change rebuilds effort and fast | same | same; sends `config_option_update` when changed in its own TUI |
| Context use | `usage_update {used, size, cost}` | `{used, size}` | `{used, size, cost}` |
| Compaction control | `/compact` command only | `/compact` | `/compact` |
| `session/list` (stable in SDK 1.9.0) | yes (1000 per page) | yes (cwd filtered after the page: pages can be short) | yes (100 per page) |
| `session/load` replays history | yes | yes | yes (inferred) |
| `session/resume` (no replay) | yes | yes | yes |
| Title updates | `session_info_update {title, updatedAt}` | `{title}` | none |
| Live "a session changed elsewhere" | only via a JetBrains-specific extension (`_meta.jetbrains.air`) that also changes many other payloads | same | none |
| Loads a session started outside kernl | yes (searches every project folder by id) | yes (via its threads index) | yes (shared database; inferred) |

Boolean options (fast mode) are sent only if the client declares `session.configOptions.boolean`; kernl doesn't [verified: research notes, `acpRunner.ts:288`].

### Where the CLIs keep sessions (structure only)

| | Claude Code | Codex | OpenCode |
| --- | --- | --- | --- |
| Store | `~/.claude/projects/<encoded cwd>/<id>.jsonl` (desktop app sessions too) | `~/.codex/sessions/YYYY/MM/DD/rollout-*.jsonl`, indexed in `~/.codex/state_5.sqlite` (`threads`) | `~/.local/share/opencode/opencode.db` (`session_v2`, `session_message`) |
| Folder of a session | the `cwd` field in the records (the folder name's encoding loses information) | `cwd` in `session_meta` and `threads` | `session_v2.directory` |
| Changes | append-only files | rollout files (append-only, inferred) and the index | database (watch `-wal`) |
| On this machine | 145 sessions | (index present) | 40 sessions |

### Options

**A. Per model and agent controls**

| | A1: settings only | A2: chips from each agent's own options (recommended) |
| --- | --- | --- |
| How | `kernl.modelProfiles` and per-agent settings | kernl: model list from the provider, a thinking chip, and per-model context and output in settings. CLI agents: the agent's own `model`, effort, and fast options as chips, set with `setSessionConfigOption`, remembered per workspace |
| Fits | kernl only | every agent, using what each one reports (no hard-coded model lists) |
| Completeness | 4/10 | 9/10 |

**B. Importing and syncing CLI sessions**

| | B1: parse each CLI's files | B2: ACP `session/list` and `session/load`, files watched as change signals (recommended) | B3: B2 plus the JetBrains extension for live changes |
| --- | --- | --- | --- |
| How | read JSONL and SQLite directly | ask the agent for its list per workspace; open with `session/load` and show the replay as the transcript; refresh when the store changes | the adapters push list changes |
| Couples kernl to | three private formats | ACP only (the adapters own their formats) | ACP plus JetBrains-only behavior that changes other messages |
| When it fails | a CLI changes its format | an adapter without `list` (none today) | the adapters treat kernl as another client |
| Completeness | 6/10 | 8/10 | 9/10, at real risk |

**C. Custom providers with headers**

| | C1: headers in settings | C2: header names in settings, secret values in SecretStorage, OpenAI or Anthropic protocol (recommended) |
| --- | --- | --- |
| Secrets | plaintext in settings.json (and settings sync) | never in settings; redacted from logs |
| Completeness | 6/10 | 9/10 |

### Recommendation

RECOMMENDATION: A2, B2, and C2. Each uses what the agent or provider itself reports (ACP options, ACP sessions, the provider's model list), keeps secrets in SecretStorage, and avoids private file formats and the JetBrains-only extension.

### Sources

- ACP SDK 1.9.0 `dist/schema/types.gen.d.ts` (config options, `listSessions`, `resumeSession`), `dist/acp.d.ts`
- claude-agent-acp 0.93.0 `dist/acp-agent.js` (config options 7890-8020; session list and AIR index), `session-index/`
- codex-acp 2.2.2 `dist/index.js` (options, `thread/list`, `thread/resume`, AIR index)
- OpenCode 2.0.32 binary; `opencode.db` schema (read-only)
- Claude Code store `~/.claude/projects`; Codex `~/.codex/sessions`, `state_5.sqlite`
- Deep Agents `computeSummarizationDefaults` (`langsmith-*.js:3497-3553`)
- https://code.claude.com/docs (resume searches all projects)

## Standardized review

- **Bottom line:** usable for the decisions; no blocking findings.
- **Criteria:** question fit pass; method pass (installed code and stores read); sources primary; coverage pass (three options per area); traceability pass; uncertainty stated; recommendation proportionate.
- **Findings:**
  1. **must-verify:** which model rows (including `[1m]`), effort levels, and fast mode each account actually gets. Needs one live `session/new` per agent (in the build, with M's OK, since it starts the agent).
  2. **must-verify:** that Claude resumes a session in kernl when kernl's folder differs from the session's original folder.
  3. **note:** OpenCode sends no title updates, so its titles in kernl come from `session/list` refreshes.
