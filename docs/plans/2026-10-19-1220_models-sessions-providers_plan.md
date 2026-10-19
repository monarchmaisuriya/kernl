# Models, thinking, and context per agent; CLI sessions in kernl; custom providers with headers

- Date: 2026-10-19 12:20
- Status: done
- Repos: kernl   Folders: `src/providers/`, `src/acp/`, `src/sessions.ts`, `src/controller.ts`, `src/workspaceRuntime.ts`, `src/webview/`, `src/ui/protocol.ts`, `test/`, `docs/`
- Files:
  - **Change:** `src/providers/registry.ts`, `src/providers/keys.ts`, `src/keyCommands.ts`, `src/providerManager.ts`, `src/connections/keyCheck.ts`, `src/acp/acpRunner.ts`, `src/workspaceRuntime.ts`, `src/controller.ts`, `src/sessions.ts`, `src/ui/protocol.ts`, `src/webview/main.ts`, `package.json`, docs, `CHANGELOG.md`
  - **New:** `src/providers/modelList.ts`, `src/acp/agentOptions.ts`, `src/acp/agentSessions.ts`, `src/webview/optionChips.ts`, tests
- Research: [2026-10-19-1215_models-sessions-providers_research.md](../research/2026-10-19-1215_models-sessions-providers_research.md)
- Subagents: none

## Context and problem

M wants:
1. to change the model, thinking, and context to suit each model and agent;
2. Claude Code, Codex, and OpenCode sessions (including ones started in a terminal or the Claude app) inside kernl, kept in sync;
3. custom providers with custom headers for kernl's own agent.

Today:
- kernl's model is typed by id, and its thinking and output settings are one global object.
- The CLI agents' model and thinking switches aren't shown.
- kernl only knows CLI conversations it started itself.
- Custom providers can't send headers.

## Goals / Non-goals

**Goals**
- **kernl's agent:**
  - a model picker listing the provider's models (from `GET /models`, typing still allowed);
  - a thinking chip (off, low, medium, high, where the provider supports it);
  - per-model profiles in settings: thinking, max output, temperature, context window (which sets when Deep Agents compacts).
- **CLI agents:** the agent's own model, thinking (effort), and fast-mode options as chips in the composer. They're set on the live session and remembered per workspace, so a new session starts with them. The lists come from the agent (no hard-coded models), including Claude's `[1m]` context models.
- **CLI sessions:**
  - Conversations lists the shown workspace's sessions from the agent itself (`session/list`), next to kernl's own.
  - Opening one loads it with its history shown in the panel.
  - The list refreshes when the CLI's session store changes on disk.
  - Opening a conversation continued elsewhere shows its latest state.
- **Custom providers:**
  - headers, with secret values kept in SecretStorage and redacted;
  - the protocol: OpenAI-compatible or Anthropic-compatible;
  - an API key optional when headers carry the auth;
  - used by kernl's agent, the model list, and the Connections key check.

**Non-goals**
- Two apps driving one live session at the same time (a CLI and kernl both writing). Opening in kernl takes the latest state; a session still running elsewhere is noted.
- The JetBrains-only live session index (it changes many other messages; see research).
- Editing other tools' session files.
- Context-size controls the agents don't offer (Claude's comes from the model choice; there's no compaction option, only `/compact`).

## What is true today

See the research's "What is true today" table (each row tagged with file and line). In short:
- kernl model typed [verified: `src/providerManager.ts`];
- one global `kernl.modelOptions` [verified: `src/providers/registry.ts:46-73`];
- compaction defaults at 85% of the model's `maxInputTokens` or 170k tokens [verified: `deepagents/dist/langsmith-*.js:3497-3553`];
- CLI options used only for the mode [verified: `src/workspaceRuntime.ts:266-281`];
- `session/load` replay discarded [verified: `src/acp/acpRunner.ts:313-330, 478`];
- custom providers without headers [verified: `src/providers/registry.ts:75-98, 164-168`].

```
 composer chips today:   [agent] [model (kernl only, typed id)] ... [mode]
 after:                  [agent] [model ▾ list] [thinking ▾] [fast] ... [mode]
                                   │              │            │
         kernl agent:  provider GET /models   modelProfiles   n/a
         CLI agent:    session config options (model / effort / fast), set live, remembered per workspace
```

## Options considered

From the research: A2 (chips from each agent's own options, 9/10) over A1 (settings only, 4/10); B2 (ACP list and load, files watched as signals, 8/10) over B1 (parse files, 6/10) and B3 (JetBrains extension, 9/10 with real risk); C2 (secret header values in SecretStorage, protocol choice, 9/10) over C1 (plaintext headers, 6/10).

RECOMMENDATION: A2, B2, C2, because each uses what the agent or provider reports, keeps secrets out of settings, and avoids private file formats.

## Decision

A2, B2, C2, in four independent parts.

## Design

### Part 1: custom providers with headers (`registry.ts`, `keys.ts`, `keyCommands.ts`)

- `kernl.customProviders` entries gain:
  - `protocol`: `"openai"` (default) or `"anthropic"`;
  - `headers`: non-secret headers;
  - `secretHeaders`: the names of headers whose values are in SecretStorage.
- **Add custom provider** asks for the protocol, then headers one by one, each marked secret or not. Secret values go to SecretStorage (`kernl.header.<provider>.<name>`) and are registered with the redactor; nothing secret is written to settings.
- `keyRequired` is false when the provider has a secret header (header auth); otherwise the key is required as today.
- **Building the model:**
  - `openai`: `ChatOpenAI` with `configuration: { baseURL, defaultHeaders }`;
  - `anthropic`: `ChatAnthropic` with `anthropicApiUrl: baseUrl` and `clientOptions: { defaultHeaders }`.
- The key check (`GET /models`) and the model list send the same headers.

### Part 2: kernl's model list, thinking chip, and per-model profiles

- **`modelList.ts`:** `GET /models` per provider (headers as above), cached for 10 min, never blocking. The model picker shows the list with "Type a model id…" as the last item. A provider without a list falls back to typing.
- **`kernl.modelProfiles`:** keyed by `provider/model` (and `*` for every model):

  ```json
  {
    "anthropic/claude-opus-5-5": { "reasoningEffort": "high", "maxOutputTokens": 32000, "contextWindow": 1000000 },
    "*": { "contextWindow": 200000 }
  }
  ```

  `kernl.modelOptions` stays as the base (backward compatible); a profile overrides it per model. `contextWindow` becomes the model's `maxInputTokens`, so Deep Agents compacts at 85% of it (`compactAt` was dropped: Deep Agents' compaction point isn't configurable).
- **The thinking chip** in the composer (kernl only, providers with thinking): off, low, medium, high. It writes the profile of the current model (user settings) and rebuilds at the next message, as a model change does today.

### Part 3: CLI agents' model, thinking, and fast mode (`agentOptions.ts`, `acpRunner.ts`)

- kernl declares `session.configOptions.boolean` so fast mode is offered.
- The runner reports the session's config options:
  - from `session/new`, `load`, and `resume`;
  - from each `setSessionConfigOption` reply;
  - from `config_option_update`.

  It reports `{ id, name, category, type, currentValue, options[] }` for `model`, effort (`thought_level`), and fast (`model_config`). Mode stays as today.
- **The panel's chips:**
  - **Model:** the agent's own list; Claude's `[1m]` rows are labeled "1M context".
  - **Thinking:** the agent's effort levels.
  - **Fast:** a toggle, where offered.

  Picking one calls `setSessionConfigOption` on the live session. The reply's options replace the list (a model change rebuilds effort and fast).
- **Before the first message** (no session yet): the chips show the options from this agent's last session in this workspace (cached), and kernl applies the remembered choices right after `session/new`, before the prompt, as it already does for the mode (decision D1).
- **Remembered per workspace and agent** (`workspaceState`), so a new chat keeps your choice.

### Part 4: CLI sessions in Conversations (`agentSessions.ts`, `sessions.ts`, `controller.ts`)

- **Conversations** (title bar clock) lists:
  - kernl's own conversations;
  - "Claude Code sessions in this folder", "Codex sessions", "OpenCode sessions", from each installed agent's `session/list` (cwd = the workspace folder; pages followed, Codex's short pages included).

  Each row shows its title and when it was last updated; sessions already linked to a kernl conversation appear once.
- **Opening a CLI session:**
  - the workspace switches to that agent and starts a new kernl conversation linked to the session id;
  - kernl calls `session/load` and shows the replayed history as the transcript (messages, tool rows, plans; previews where present), instead of discarding it;
  - from then on, it works like any kernl conversation with that agent.
- **Kept in sync:**
  - opening any linked conversation loads it from the agent again, so turns added in a terminal or the Claude app show up;
  - the list refreshes when Conversations opens and when the agent's store changes on disk, used only as a signal: `~/.claude/projects/<folder>/`, `~/.codex/state_5.sqlite`, `~/.local/share/opencode/opencode.db-wal`;
  - titles follow `session_info_update`.
- **A session another process is using right now:** for Claude, a live process in `~/.claude/sessions/<pid>.json` with that session id. kernl opens it read-only, with a notice "This session is open in another app: send here to continue it in kernl." (decision D3).
- Restore checkpoints and Fork work as for any CLI conversation (fork only from the last message, as today).

### Contracts touched

- **Settings:**
  - `kernl.customProviders[]` gains `protocol`, `headers`, `secretHeaders`;
  - new `kernl.modelProfiles`;
  - new `kernl.sessions.importFromAgents` (default true).
- **SecretStorage:** `kernl.header.<provider>.<name>`; "Clear stored keys" clears them too.
- **Panel protocol:**
  - `agentOptions {workspace, options[]}`, `setAgentOption {workspace, id, value}`;
  - `thinkingOptions` for kernl;
  - Conversations items gain `{ source: "kernl" | agent id, updatedAt }`.
- **`SessionRecord`:** gains `importedFrom?: { agent, sessionId }`.
- **ACP client capabilities:** add `session.configOptions.boolean`.

## Risks and mitigations

| Risk | Likelihood | Impact | Mitigation | How we'd notice |
| --- | --- | --- | --- | --- |
| An account gets different models or effort levels than expected | high | wrong assumptions | chips come only from the live session's options; nothing hard-coded | chips match `/model` in the CLI |
| `session/list` needs the agent's adapter started (npx, a second) | certain | Conversations opens a little slower | list per agent in parallel, cached; kernl's own list shows at once | timing in the log |
| Loading a long session (the largest here is 88 MB) | medium | slow, heavy panel | load replays in chunks into the transcript; cap shown history (older turns behind "Show earlier") | VS Code check with a large fixture |
| Two apps continue one session at once | low | interleaved history | read-only notice while another process holds it (Claude); for the others, kernl loads fresh on open | notice |
| Secret header leaks into logs or settings | low | credential exposure | values only in SecretStorage, registered with the redactor; settings hold names | unit test that settings never contain the value |
| Anthropic-protocol gateways differ on `/models` | medium | no model list | fallback to typing; key check treats a 404 as "can't tell" | "Type a model id" shown |

## Acceptance criteria

- Given a custom provider with a secret `Authorization` header and no key, when kernl's agent runs, then the gateway receives the header, settings.json contains only the header's name, and logs show it redacted.
- Given an Anthropic-protocol custom provider, then kernl's agent talks to its base URL with the Anthropic API.
- Given kernl's agent on a provider with a model list, when M opens the model chip, then the provider's models are listed, and typing an id still works.
- Given a profile with `contextWindow: 200000`, then kernl's agent compacts around 170k tokens (85%).
- Given Claude Code in a workspace, when the session starts, then the model chip lists Claude's own models (with `[1m]` rows labeled), the thinking chip its effort levels, and fast mode where offered; picking one changes the live session and is kept for the next chat.
- Given a session started with `claude` in a terminal in this folder, when M opens Conversations, then it's listed under Claude Code sessions; opening it shows its history in the panel, and sending continues it.
- Given a session continued in the terminal after kernl opened it, when M opens it again in kernl, then the new turns are there.
- Given a Claude session open in another app, then kernl opens it read-only with a notice.

## Rollout and rollback

- Each part is independent and ships when done.
- Importing can be turned off (`kernl.sessions.importFromAgents`).
- Existing settings keep working: `kernl.modelOptions` stays the base, and old custom providers are OpenAI protocol with no headers.
- **Rollback:** revert the part. Imported conversations are ordinary kernl conversations with a link; deleting them never touches the CLI's files.

## Parts

### Part 1: custom providers with headers and a protocol
- [x] Settings shape, the Add custom provider flow (headers, secret or not), SecretStorage and redaction, building the model for both protocols, the key check and model list with headers. Done: unit tests (secret values never in settings; headers sent; Anthropic protocol uses its base URL; old entries still valid); a local test server sees the headers.

### Part 2: kernl's model list, thinking chip, model profiles
- [x] `modelList.ts` with caching and fallback; the model picker list; the thinking chip; `kernl.modelProfiles` merged over `kernl.modelOptions`; `contextWindow` passed to Deep Agents (`compactAt` dropped). Done: unit tests for the merge and for compaction trigger values; webview tests for the chips; VS Code check of the picker against a local `/models` server.

### Part 3: CLI agents' model, thinking, fast mode
- [x] Runner reports config options and applies remembered ones after `session/new`; the boolean capability; panel chips; remembered per workspace and agent. Done: fake-agent scenarios with model, effort, and fast options (a model change rebuilds effort); webview tests; live check with Claude Code (M's OK: it starts a session).

### Part 4: CLI sessions in Conversations
- [x] `agentSessions.ts` (list per agent and folder, pages, cache), Conversations rows, opening with `session/load` and the replay shown, re-load on open, store watchers, the read-only notice for a Claude session in use. Done: fake-agent `list` and `load` with replay; VS Code check that a listed session opens with history; live check with one of M's Claude sessions (read-only until M sends).

### Finish
- [ ] Docs (providers, CLI agents, panel), changelog; suites, package, install, check in M's window.

## Standardized review

- **Bottom line:** executable after four decisions; no blocking findings.
- **Criteria:**
  - **Goal fidelity:** pass. All three asks are covered, and the non-goals say what isn't.
  - **Current-system accuracy:** pass. Every "today" claim is tagged in the research.
  - **Scope:** pass.
  - **Architecture:** pass. Options and sessions come from the agents over ACP; kernl doesn't parse private formats.
  - **Sequencing:** pass. The parts are independent; 1 and 2 touch kernl's agent, 3 and 4 the CLI agents.
  - **Completeness:** pass. Settings, secrets, protocol, docs, and tests are covered.
  - **Failure handling:** pass. Fallbacks and caps are listed.
  - **Verification:** pass. A test or live check per part; live checks need M's OK where they start an agent.
  - **Feasibility:** pass. The APIs are verified in installed versions.
  - **Decision readiness:** four decisions below.
- **Findings:**
  1. **must-verify:** each account's actual model, effort, and fast options (live `session/new`, Part 3).
  2. **must-verify:** Claude resuming a session when kernl's folder differs from the session's original folder (Part 4 live check).
  3. **note:** Part 4's large sessions need the capped replay to keep the panel responsive.

## Changes made

- Part 1: `kernl.customProviders` entries take `protocol`, `headers`, and `secretHeaders` (values in SecretStorage as `kernl.header.<provider>.<name>`, redacted, cleared with the keys); a secret header replaces the key; Add custom provider asks for the protocol and headers; "Set API key" lists secret headers; the key check sends the headers. Deviation: LangChain drops null headers for OpenAI, so the OpenAI client gets a fetch that removes only the placeholder bearer (M chose this). Verified: unit tests (a local server sees the headers and no placeholder key, both protocols) and the single-folder VS Code suite (63/63).
- Part 2: `modelList.ts` (the models endpoint with the provider's key and headers, 10 min cache, typing fallback) feeds the model picker; `kernl.modelProfiles` (`*` and `provider/model`) over `kernl.modelOptions`, with `reasoningEffort: "off"` and `contextWindow` (sets the model's `maxInputTokens`); the thinking chip writes the current model's profile. Deviation: `compactAt` dropped (Deep Agents' compaction point isn't configurable; it stays at 85%), M chose this. Verified: unit tests (merge, errors, context window, list parsing and cache), panel test for the chip, single-folder VS Code suite (64/64) with a local `/models` server.
- Part 3: kernl declares boolean config options; `agentOptions.ts` turns an agent's options into model, thinking, and fast chips (1M rows labeled); the runner reports them from new, load, fork, set replies, and `config_option_update`, and applies remembered choices after `session/new` (model first, before the mode); the workspace remembers choices per folder and agent (workspaceState) and shows the last session's chips before the first message. Verified: unit tests (option mapping, order, runner with the fake "options" agent), panel test, single-folder VS Code suite (65/65). Not yet run: the live Claude Code check (needs M's OK).
- Part 4: the runner lists sessions (`session/list`, pages followed) and loads one now with its replay shown (user messages included); Conversations lists each ready agent's sessions for the folder once (cached, invalidated by store watchers and launch changes, 10 s limit per agent); opening switches to the agent, shows the replay as the transcript (capped to the latest turns), and continues it; an imported conversation loads from the agent again on each open; Claude sessions open in another app get a notice; `kernl.sessions.importFromAgents`. Deviation: kernl's own CLI conversations still show kernl's transcript on open (not re-loaded from the agent), so their Restore points stay. Verified: unit tests (listing, replay, transcript cap, stores, in-use check), single-folder (67/67) and multi-root (6/6) VS Code suites. Not yet run: the live check with one of M's Claude sessions (needs M's OK).

## Open questions

1. **D1: CLI options before the first message.** A (recommended): show this agent's options from its last session here, and apply your choices right after the session starts (as the mode is today). B: start the agent's session as soon as you pick the agent, to show its live options. RECOMMENDATION: A because it starts nothing until you send. Completeness: A 8/10, B 9/10.
2. **D2: how sessions stay in sync.** A (recommended): ACP `session/list` when Conversations opens and when the agent's store changes on disk (B2). B: also turn on the JetBrains-only live index (B3). RECOMMENDATION: A because B makes the adapters treat kernl as a JetBrains client everywhere. Completeness: A 8/10, B 9/10.
3. **D3: a session another app is using right now.** A (recommended): open it read-only with a notice; sending continues it in kernl. B: open it normally. RECOMMENDATION: A because two apps writing one session interleave its history. Completeness: A 8/10, B 6/10.
4. **D4: custom header secrets.** A (recommended): header names in settings, secret values in SecretStorage (C2). B: everything in settings (C1). RECOMMENDATION: A because settings.json syncs and gets shared; secrets never belong there. Completeness: A 9/10, B 6/10.
