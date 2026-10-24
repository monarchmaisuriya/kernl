# Model providers for Deep Agents

| `kernl.provider` | Key | Notes |
| --- | --- | --- |
| `anthropic`, `openai`, `google` | Set API key | Set `kernl.model`. |
| `deepseek` | Set API key | Empty `kernl.model` uses `deepseek-flash`; `deepseek-v4-pro` also works. DeepSeek's thinking mode (on by default) rejects a forced tool choice; Deep Agents never forces one. |
| `openai-compatible` | Optional | One local or self-hosted server at `kernl.baseUrl`. |
| `custom:<id>` | Set API key, or a secret header | Any number of OpenAI- or Anthropic-compatible services (OpenRouter, Groq, LiteLLM, a company gateway). Run **kernl: Add custom provider**, or add `{ "id", "label", "baseUrl", "model" }` to `kernl.customProviders`. The model must support tool calling; if it doesn't, the first tool call fails with the service's error. |

## Custom providers with headers

Each `kernl.customProviders` entry can also set:

- `protocol`: `openai` (default, `/chat/completions`) or `anthropic` (`/v1/messages`; `baseUrl` is the part before `/v1`, e.g. `https://gateway.example.com/anthropic`).
- `headers`: headers sent with every request, e.g. `{ "X-Team": "platform" }`. These are plain settings: don't put secrets here.
- `secretHeaders`: the names of headers whose values are secret, e.g. `["X-Api-Token"]`. Their values live in SecretStorage, never in settings, and are scrubbed from logs. A provider with a secret header needs no API key: without a key, kernl sends no `Authorization` (OpenAI) or `x-api-key` (Anthropic) header at all.

**kernl: Add custom provider** asks for the protocol, then headers one at a time (secret or not), then an optional key. Change a secret header's value later with **kernl: Set API key** (it lists `custom:<id>: <header>`). **Clear stored keys** removes secret header values too. The key check in [Connections](connections.md) and the model list send the same headers.

```json
"kernl.customProviders": [
  { "id": "gateway", "label": "Team gateway", "protocol": "anthropic", "baseUrl": "https://gateway.example.com/anthropic", "model": "claude-sonnet-5-5", "headers": { "X-Team": "platform" }, "secretHeaders": ["X-Api-Token"] }
]
```

## Choosing a model

The model chip lists the provider's own models (its `/models` endpoint, asked with your key and headers; kept for 10 minutes), with **Type a model id...** last. A provider without a list, or one that doesn't answer within 5 s, asks you to type the id.

Keys are never stored in settings, only in SecretStorage. **Clear stored keys** removes all of them, including CLI agent keys, and **Delete conversations** removes kernl's history (your files are not changed). Both are links in kernl's settings (under the provider setting) and in the Command Palette, and both ask first.

Requires VS Code 1.140 or newer. The integrated-browser tools are verified on VS Code 1.142.

## Model options

`kernl.modelOptions` sets `temperature`, `maxOutputTokens`, and `reasoningEffort` (`low` | `medium` | `high`):

- OpenAI-style providers get reasoning effort.
- anthropic gets extended thinking (2048 / 8192 / 24576 tokens), which can't be combined with `temperature`.
- google gets a thinking level.
- deepseek doesn't take `reasoningEffort`.

Anything a provider can't take is named in the panel instead of being silently dropped.

**Per model:** `kernl.modelProfiles` sets the same options for one model (`provider/model`, e.g. `anthropic/claude-opus-5-5` or `custom:gateway/team/model`) or for every model (`*`); the model's own entry wins over `*`, which wins over `kernl.modelOptions`. Profiles also take:

- `contextWindow`: the model's context window in tokens. kernl's agent compacts the conversation at 85% of it. Without one, models the libraries know use their own size, and others compact at 170k tokens.
- `reasoningEffort: "off"`, to turn off an effort a broader entry sets.

The **thinking chip** next to the model chip (not for deepseek) sets `reasoningEffort` for the current model in your user settings; like a model change, the next message starts a new conversation.

```json
"kernl.modelProfiles": {
  "*": { "contextWindow": 200000 },
  "anthropic/claude-opus-5-5": { "reasoningEffort": "high", "contextWindow": 1000000 }
}
```

API keys live only in VS Code SecretStorage and are scrubbed from logs and panel messages. [Connections](connections.md) checks each stored key with the provider's model list (no tokens spent): a refused key shows there and on the agent chip.
LangSmith tracing is forced off for every run, even if `LANGSMITH_TRACING` is set in your environment.
