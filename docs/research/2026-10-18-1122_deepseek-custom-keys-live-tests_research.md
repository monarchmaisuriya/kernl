# DeepSeek provider, custom API keys, and live tests with installed CLIs

- Date: 2026-10-18 11:22
- Status: presented
- Mode: explore options
- Repos: yourstack   Folders: src/providers, src/acp, test
- Question / problem: How do we add DeepSeek and user-supplied ("custom") API keys to YourStack, and test the product end to end with the agent CLIs installed on this machine?

## Options: Add DeepSeek and custom keys through the existing provider and agent layers, proven by an opt-in live suite

- **Bottom line:**
  - **DeepSeek:** add it as a first-class Deep Agents provider via `@langchain/deepseek`.
  - **"Custom keys":** two plausible meanings. Recommend both: (A) named custom OpenAI-compatible providers for Deep Agents, and (B) optional API keys and endpoints for the CLI agents, starting with Claude Code (its own key, or DeepSeek's Anthropic-compatible endpoint).
  - **Live tests:** a new opt-in suite drives the real panel in VS Code with the real `claude` and `opencode` CLIs, plus DeepSeek when a key is present.
- **Where we are:** sources read (DeepSeek docs and API reference, the LangChain package, CLI help, current code).
- **Need from M:** confirm what "custom API keys" means (A, B, or both); pick DeepSeek's default model.

### What I found

**DeepSeek API**

- **Endpoints:** OpenAI-compatible base URL `https://api.deepseek.com`; Anthropic-compatible `https://api.deepseek.com/anthropic`. [verified: [DeepSeek API docs](https://api-docs.deepseek.com/)]
- **Models:** `deepseek-flash` (served by DeepSeek-V4.1-Flash-1017) and `deepseek-v4-pro`. Older `deepseek-v4-flash*` names are retired aliases. `deepseek-chat` and `deepseek-reasoner` are not listed anymore. [verified: same page and [Create Chat Completion](https://api-docs.deepseek.com/api/create-chat-completion)]
- **Tool calling (OpenAI format):** `tools` (functions only) and `tool_choice` `none`/`auto`/`required`/named are accepted. In thinking mode, which is on by default, `required` and named choices return 400; `auto` works. [verified: Create Chat Completion reference] Deep Agents uses `auto`. [inferred: the LangChain agent loop doesn't force a tool choice]
- **Anthropic-compatible endpoint:** supports streaming, tools, and thinking. `claude-opus*` maps to `deepseek-v4-pro`; `claude-sonnet*`, `claude-haiku*`, and other `claude*` names map to `deepseek-flash`. Prompt caching (`cache_control`) is ignored. [verified: [Anthropic API guide](https://api-docs.deepseek.com/guides/anthropic_api)]
- **LangChain:** `@langchain/deepseek` 1.1.17 (MIT, peer `@langchain/core ^1.0.0`; we pin 1.2.18). `ChatDeepSeek` takes `apiKey` and `model`, supports `bindTools`, and documents `reasoning_content` handling. [verified: `npm view`; `dist/chat_models.d.ts`] The generic `ChatOpenAI` would not round-trip `reasoning_content`. [inferred: it isn't part of the OpenAI schema]

**Custom keys: two meanings**

- **(A) Deep Agents providers:** today there is one `openai-compatible` provider with one base URL and one key. [verified: `src/providers/registry.ts:6`, `:42`] A list of named custom providers (OpenRouter, Groq, Together, Mistral, a company gateway) would each need its own base URL, model, and key.
- **(B) CLI agents:** today Claude Code uses your subscription login, and OpenCode its own config. Claude Code also accepts `ANTHROPIC_API_KEY` and `ANTHROPIC_BASE_URL`, which DeepSeek's guide documents for the Anthropic SDK and Claude Code. [verified: DeepSeek Anthropic guide] Claude Code's CLI help also mentions `apiKeyHelper` via `--settings`. [verified: `claude --help`]
  - **Env reaching the CLI:** whether env vars injected into the `claude-agent-acp` launch reach the spawned Claude Code is [unverified]. Check: a live run with `ANTHROPIC_BASE_URL` set to DeepSeek.
- **Codex:** reads `CODEX_API_KEY`. [verified: [Codex non-interactive docs](https://learn.chatgpt.com/docs/non-interactive-mode)] It isn't installed here, so it can't be tested.

**Live tests with installed CLIs**

- **Installed:** `claude` 2.1.299 (logged in) and `opencode` 2.0.27 (free models available). `codex` is not installed. [verified: earlier probes; `opencode models` lists 21]
- **What exists:** `npm run probe:agents` covers only "reject means nothing written" through `AcpRunner`, not through the panel and controller. [verified: `test/probeAgents.ts`]

### Options

| | A only: custom providers for Deep Agents | B only: keys for CLI agents | A + B (recommended) |
| --- | --- | --- | --- |
| What you get | DeepSeek plus any OpenAI-compatible service, each with its own key, in the Deep Agents harness | Claude Code on your API key or on DeepSeek's endpoint; Codex on an API key | Both |
| Code fit | Extends `providers/registry.ts` and `keys.ts` | Extends `acp/agents.ts` launch env from SecretStorage | Both, one key store |
| Risk | Low | Medium: env must reach the CLI (verify live); keys pass through the env of a subprocess we spawn | Medium |
| Completeness | 6/10 | 6/10 | 9/10 |

### Recommendation

RECOMMENDATION: A + B, because "custom keys" plausibly means either, and both reuse the same SecretStorage key store and redaction. B starts with Claude Code, the only key-capable CLI that's installed here and testable.

### Sources

- [DeepSeek API docs](https://api-docs.deepseek.com/), [Create Chat Completion](https://api-docs.deepseek.com/api/create-chat-completion), [Anthropic API guide](https://api-docs.deepseek.com/guides/anthropic_api)
- `@langchain/deepseek` 1.1.17 (npm, type definitions)
- [Codex non-interactive mode](https://learn.chatgpt.com/docs/non-interactive-mode)
- `claude --help`, `opencode models`, current `src/providers/registry.ts`, `src/acp/agents.ts`, `test/probeAgents.ts`

## Standardized review

## Review: research (option comparison): DeepSeek, custom keys, live tests

### At a glance

- **Bottom line:** present as is
- **Where we are:** reviewed against the cited docs, the package, and current code; complete; waiting on M
- **Need from M:** 2 decisions (what custom keys means; the DeepSeek default model)
- **Why:** The facts are primary-sourced. The one load-bearing unknown (env reaching Claude Code) is named with a live check.
- **Intended outcome:** M can choose the scope for DeepSeek and custom keys.
- **Findings:** 0 blocking, 1 must-verify, 1 note

### Findings

### 1. MUST-VERIFY — Claude Code on a custom key or endpoint depends on env passing through the adapter

- **Why it matters:** if `claude-agent-acp` doesn't forward our env to Claude Code, option B silently keeps using the subscription login.
- **Recommendation:** the plan's first B task is a live check that asserts the request really went to the custom endpoint.
- **Need from M:** a DeepSeek key for that check (or accept it as unverified).

#### What is wrong

- **Criterion:** Source quality
- **Where:** "Custom keys", (B)
- **Problem:** unverified pass-through.
- **Fix:** Plan, live test with an observable effect (a model name or error that only DeepSeek would return).

#### Evidence

- [unverified] Env pass-through in `claude-agent-acp` 0.93.0.

### 2. NOTE — DeepSeek thinking mode and tool choice

- **Why it matters:** a future "force a tool" call would 400 in thinking mode.
- **Recommendation:** document it; Deep Agents uses `auto` today.
- **Need from M:** Nothing.

#### What is wrong

- **Criterion:** Uncertainty and limits
- **Where:** "DeepSeek API", tool calling
- **Problem:** a provider constraint.
- **Fix:** README note.

#### Evidence

- [verified] The API reference says thinking mode rejects `required` and named tool choices.

### Criterion coverage

- **Question and decision fit — pass.** Three asks, mapped to options. Fix: None.
- **Method — pass.** Docs, package source, CLI help, code. Fix: None.
- **Source quality — violation.** Env pass-through is unverified. Fix: Finding 1.
- **Coverage and alternatives — pass.** A, B, and A + B compared. Fix: None.
- **Claim traceability — pass.** Each claim has its source inline. Fix: None.
- **Evidence handling — pass.** Tags applied. Fix: None.
- **Analysis quality — pass.** Same rows for every option. Fix: None.
- **Codebase and system fit — pass.** Names the files each option touches. Fix: None.
- **Uncertainty and limits — violation.** The thinking-mode limit needs to be documented. Fix: Finding 2.
- **Recommendation proportionality — pass.** It follows from the ambiguity. Fix: None.
- **Reproducibility — pass.** Sources listed. Fix: None.

### In plain terms

DeepSeek fits cleanly as a new provider. "Custom keys" could mean two things, and doing both is cheap because they share one key store. The only open question is whether Claude Code honors a custom endpoint when we launch it, and one live run with a DeepSeek key settles that.
