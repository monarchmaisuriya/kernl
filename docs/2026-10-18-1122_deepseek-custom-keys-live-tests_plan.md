# DeepSeek provider, custom API keys, and live tests with installed CLIs

- Date: 2026-10-18 11:22
- Status: done (live Claude Code login scenarios pending M's own run)
- Repos: yourstack   Folders: src/providers, src/acp, src/ui, test   Files: listed per part
- Subagents: none
- Research: `docs/2026-10-18-1122_deepseek-custom-keys-live-tests_research.md` (A + B recommended)

## Context and problem

M wants three things:

1. DeepSeek as a model option, with its own key.
2. "Custom API keys": a key for any OpenAI-compatible service, and keys or endpoints for the CLI agents.
3. Proof that YourStack works end to end with the agent CLIs installed on this machine, not just the fake agent.

## Goals / Non-goals

Goals:

- **DeepSeek provider:** `yourstack.provider: "deepseek"` via `ChatDeepSeek`. Default model `deepseek-flash` (Open question 2). Key stored as `yourstack.apiKey.deepseek`.
- **(A) Custom providers:** setting `yourstack.customProviders`, a list of `{ id, label, baseUrl, model }`. Each one's key is stored in SecretStorage (`yourstack.apiKey.custom.<id>`). Provider id `custom:<id>`. "Set API key" lists them. Keys stay in SecretStorage and redaction, as today.
- **(B) CLI agent keys:** optional per-agent credentials stored in SecretStorage and injected into the agent's launch env only:
  - Claude Code: `ANTHROPIC_API_KEY`, plus optional `ANTHROPIC_BASE_URL`, with a one-click "DeepSeek" preset (`https://api.deepseek.com/anthropic`).
  - Codex: `CODEX_API_KEY`.
  - Without a stored key, behavior is unchanged (your logins).
- **Live suite (opt-in, `npm run test:live`):** inside VS Code, through the real panel and controller, for each available agent:
  - approve → the file is written;
  - reject → nothing is written;
  - Stop mid-run → "stopped";
  - a follow-up turn remembers the first.

  Agents covered: Claude Code (login), OpenCode (free model), Deep Agents + DeepSeek (if `DEEPSEEK_API_KEY` is set), and Claude Code on DeepSeek (same key).

Non-goals:

- Custom keys for OpenCode. It manages providers in its own config; launching with `OPENCODE_CONFIG_CONTENT` provider entries is possible later.
- Codex live tests (not installed).
- Showing provider prices.

## What is true today

| Fact | Evidence |
| --- | --- |
| Providers: anthropic, openai, google, openai-compatible; one key per provider id | [verified: `src/providers/registry.ts:6`, `src/providers/keys.ts`] |
| CLI launches: `resolveLaunch(id, overrides)` builds command, args, env; ask-mode env is forced | [verified: `src/acp/agents.ts`] |
| The rebuild policy covers provider, model, baseUrl, mcpServers (Deep Agents) and agentCommands (CLI) | [verified: `src/agent/rebuildPolicy.ts`] |
| The live check exists only at the `AcpRunner` level (`probe:agents`) | [verified: `test/probeAgents.ts`] |
| `@langchain/deepseek` 1.1.17 is compatible with our `@langchain/core` 1.2.18 | [verified: peer `^1.0.0`] |

## Options considered

Settled by the research: A + B. One design choice remains.

| Option | How custom providers are configured | Tradeoff | Completeness |
| --- | --- | --- | --- |
| C1. Settings list + keys in SecretStorage (recommended) | `yourstack.customProviders` holds non-secret fields; the key is set via "Set API key" | Secrets never in settings.json; editable as JSON | 9/10 |
| C2. Interactive "Add provider" wizard only | QuickPick and InputBox flow stores everything | Friendlier, but the config is hidden and hard to share | 7/10 |

RECOMMENDATION: C1, plus a small "Add custom provider" command that writes the settings entry and asks for the key, so both ways work.

## Decision

- DeepSeek becomes a named provider.
- Custom providers come from settings, with keys in SecretStorage.
- CLI agents get optional per-agent credentials injected only into their own process env.
- The live suite runs opt-in through the real controller.

**Structural reason:** every secret still lives only in SecretStorage and passes through the one redactor. Providers and agents are each extended at their single owning module (`registry.ts`, `agents.ts`).

## Design

- **`src/providers/registry.ts`:**
  - `ProviderId` becomes `"anthropic" | "openai" | "google" | "deepseek" | "openai-compatible" | \`custom:${string}\``.
  - `createChatModel` gains a `deepseek` case (ChatDeepSeek) and a `custom:*` case (ChatOpenAI with the entry's baseUrl).
  - `settingsProblem` validates custom entries (id `[a-z0-9-]+`, http(s) baseUrl, model required).
- **`src/providers/keys.ts`:** key names `yourstack.apiKey.<provider>` (custom: `yourstack.apiKey.custom.<id>`). `clearAll` also clears custom and agent keys.
- **`src/acp/credentials.ts` (new):** reads per-agent credentials from SecretStorage and returns env:
  - Claude Code: `ANTHROPIC_API_KEY`, optional `ANTHROPIC_BASE_URL`;
  - Codex: `CODEX_API_KEY`.

  `resolveLaunch` merges them (ask-forcing env still wins). The key strings are registered with the redactor.
- **Commands:**
  - `YourStack: Set API key` lists the built-in providers, custom providers, and "CLI agent: Claude Code / Codex".
  - `YourStack: Add custom provider`.
  - `YourStack: Use DeepSeek for Claude Code` (stores the base URL plus the key).
- **Rebuild policy:** `yourstack.customProviders` affects Deep Agents. Agent credential changes count as `keys` for CLI workspaces (extend `keys` to carry which kind changed).
- **Live suite:** `test/live/*`, run by `npm run test:live`. It launches VS Code like `test:vscode`, without the fake agent, with real CLIs, and skips agents that aren't installed or keyed. The prompts are tiny fixed tasks in a temp git repo.

## Risks and mitigations

| Risk | Likelihood | Impact | Mitigation | How we'd notice |
| --- | --- | --- | --- | --- |
| Claude Code ignores our injected env | Medium | Medium | A live check asserts DeepSeek was used (its response or model name) | Live test fails |
| A custom provider lacks tool calling | Medium | Medium | A clear error from the first tool call is surfaced; README note | Error card |
| A key leaks via env or logs | Low | High | Keys only in the child env and the redactor; a test checks logs and panel messages | Unit test |
| DeepSeek thinking mode plus a forced tool choice | Low | Low | Not used; documented | n/a |
| Live tests cost tokens | Certain | Low | Opt-in; tiny prompts; OpenCode uses a free model | n/a |

## Acceptance criteria

- **DeepSeek setup:** given provider `deepseek` and a stored key, when settings are checked, then no problem is reported, and `createChatModel` returns `ChatDeepSeek` with model `deepseek-flash`.
- **Custom provider setup:** given a custom provider `{id:"openrouter", baseUrl, model}` and its key, when it is selected, then a ChatOpenAI with that baseUrl is built. A malformed entry names the bad field.
- **Agent credentials:** given a stored Claude Code key and DeepSeek base URL, when the Claude Code agent launches, then its env has `ANTHROPIC_API_KEY` and `ANTHROPIC_BASE_URL`, and the forced ask settings are unchanged.
- **Redaction:** given any stored key, when logs and panel messages are produced, then the key never appears.
- **Live, Claude Code and OpenCode:** given the installed CLIs, when the live suite runs, then approve writes, reject doesn't, Stop stops, and a follow-up turn has context.
- **Live, DeepSeek:** given `DEEPSEEK_API_KEY`, when the live suite runs, then Deep Agents on DeepSeek completes a tool-using task, and Claude Code on DeepSeek completes one.

## Rollout and rollback

- **Additive:** existing settings and keys keep working.
- **Rollback:** reinstall the previous VSIX. New keys can be removed with "Clear stored keys".

## Parts

### Part 1: DeepSeek and custom providers

- [x] Add `@langchain/deepseek@1.1.17`; registry cases; settings schema; validation. Done when unit tests cover both providers and malformed entries.
- [x] Key store and commands (Set API key list, Add custom provider). Done when unit tests cover key names and clearAll.

### Part 2: CLI agent credentials

- [x] `src/acp/credentials.ts`; `resolveLaunch` merge; commands; rebuild on change. Done when unit tests show env injection, forced-env precedence, and redaction.

### Part 3: Live suite with installed CLIs

- [x] `npm run test:live` through the real controller. Done when Claude Code and OpenCode pass all four scenarios on this machine, and the DeepSeek scenarios pass or skip, with the reason printed.

### Part 4: Regression and package

- [x] Unit, VS Code, and live suites; README; VSIX; reinstall. Done when all pass and the installed version matches.

## Standardized review

Reviewed with the plan rubric:

- **Findings:** 0 blocking, 1 must-verify (Claude Code env pass-through; Part 3 has a live assertion for it), 1 note (custom providers without tool calling surface a clear error; README).
- **Criteria passing:** goal fidelity, current-system accuracy, scope, dependency direction, sequencing, verification, and decision readiness (3 open questions).
- **Completeness:** violation until the env pass-through is verified live.

## Changes made

- Part 1: `deepseek` provider (ChatDeepSeek, default `deepseek-flash`) and `custom:<id>` providers from `yourstack.customProviders`; "Add custom provider" command. KeyStore keeps its own index of stored key names, because `SecretStorage.keys()` omitted a just-stored key (1 in 40 in a probe on VS Code 1.142).
- Part 2: `src/acp/credentials.ts`; Claude Code `ANTHROPIC_API_KEY`/`ANTHROPIC_BASE_URL` and Codex `CODEX_API_KEY` injected at launch (ask-forcing env still wins); "Use DeepSeek for Claude Code" command; key changes rebuild only the agents that read them; runner creation is async with an in-flight guard.
- Finding (live, localhost capture server): a logged-in Claude Code 2.1.299 sent its own login-derived `Authorization: Bearer` instead of `ANTHROPIC_API_KEY`, directly and through the adapter. During two earlier live runs such requests went to api.deepseek.com; M rotated the login. Fix: with a stored key, Claude Code launches with `CLAUDE_CONFIG_DIR` in extension storage (an `agentCommands` override can't undo it). Verified: all 14 requests carried only the stored key.
- Part 3: `npm run test:live` (`test/live/liveSuite.ts`; `runVscode` picks the suite via `YOURSTACK_SUITE`). Claude Code and OpenCode: approve plus follow-up, reject, Stop. Claude Code with a stored key against a localhost capture server: only that key is sent, then Stop. DeepSeek checks skip without `DEEPSEEK_API_KEY`. Results here: OpenCode 3/3 and the capture check pass. The Claude Code login scenarios passed in the first live run, then failed after the login rotation ("OAuth session expired"); `claude -p` fails the same way from this session's shell, so they need M's own run.
- Part 4: unit 98/98, VS Code 27/27 (dev and minified bundles), README (providers table, CLI agent keys, isolation note, Codex keys unverified), `yourstack.vsix` packaged and installed (`local.yourstack@0.1.0`; installed bundle matches the VSIX).

## Open questions

1. **"Custom API keys":** both (A) custom OpenAI-compatible providers for Deep Agents and (B) keys/endpoints for CLI agents? Default: both.
2. **DeepSeek default model:** `deepseek-flash` (cheaper) or `deepseek-v4-pro`? Default: `deepseek-flash`.
3. **Live DeepSeek tests:** provide `DEEPSEEK_API_KEY` in the environment when running `npm run test:live`? Default: those scenarios skip without it.
