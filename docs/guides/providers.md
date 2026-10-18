# Model providers for Deep Agents

| `kernl.provider` | Key | Notes |
| --- | --- | --- |
| `anthropic`, `openai`, `google` | Set API key | Set `kernl.model`. |
| `deepseek` | Set API key | Empty `kernl.model` uses `deepseek-flash`; `deepseek-v4-pro` also works. DeepSeek's thinking mode (on by default) rejects a forced tool choice; Deep Agents never forces one. |
| `openai-compatible` | Optional | One local or self-hosted server at `kernl.baseUrl`. |
| `custom:<id>` | Set API key | Any number of OpenAI-compatible services (OpenRouter, Groq, a company gateway). Run **kernl: Add custom provider**, or add `{ "id", "label", "baseUrl", "model" }` to `kernl.customProviders`. The model must support tool calling; if it doesn't, the first tool call fails with the service's error. |

Keys are never stored in settings, only in SecretStorage. **Clear stored keys** removes all of them, including CLI agent keys, and **Delete conversations and checkpoints** removes kernl's history (your files are not changed). Both are links in kernl's settings (under the provider setting) and in the Command Palette, and both ask first.

Requires VS Code 1.140 or newer. The integrated-browser tools are verified on VS Code 1.142.

## Model options

`kernl.modelOptions` sets `temperature`, `maxOutputTokens`, and `reasoningEffort` (`low` | `medium` | `high`):

- OpenAI-style providers get reasoning effort.
- anthropic gets extended thinking (2048 / 8192 / 24576 tokens), which can't be combined with `temperature`.
- google gets a thinking level.
- deepseek doesn't take `reasoningEffort`.

Anything a provider can't take is named in the panel instead of being silently dropped.

API keys live only in VS Code SecretStorage and are scrubbed from logs and panel messages.
LangSmith tracing is forced off for every run, even if `LANGSMITH_TRACING` is set in your environment.
