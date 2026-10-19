import { type AnthropicInput, ChatAnthropic } from "@langchain/anthropic";
import type { BaseChatModel } from "@langchain/core/language_models/chat_models";
import { ChatDeepSeek } from "@langchain/deepseek";
import { ChatGoogleGenerativeAI } from "@langchain/google-genai";
import { ChatOpenAI } from "@langchain/openai";

export const BUILT_IN_PROVIDERS = ["anthropic", "openai", "google", "deepseek", "openai-compatible"] as const;
type BuiltInProvider = (typeof BUILT_IN_PROVIDERS)[number];
/** A built-in provider, or `custom:<id>` for an entry in kernl.customProviders. */
export type ProviderId = BuiltInProvider | `custom:${string}`;

/** Used when kernl.model is empty. */
// Only ids verified to exist; other providers need kernl.model.
const DEFAULT_MODELS: Partial<Record<BuiltInProvider, string>> = { anthropic: "claude-sonnet-5-5", deepseek: "deepseek-flash" };

/**
 * A service the user named in kernl.customProviders, spoken to with the OpenAI or the Anthropic API.
 * Its key and the values of its secret headers live in SecretStorage; settings hold only their names.
 */
export interface CustomProvider {
  id: string;
  label: string;
  baseUrl: string;
  model: string;
  protocol: "openai" | "anthropic";
  /** Sent with every request; not secret (they're in settings). */
  headers: Record<string, string>;
  /** Names of headers whose values are in SecretStorage. A provider with one needs no API key. */
  secretHeaders: string[];
}

/** What a provider's requests carry from SecretStorage: its key and its secret headers' values. */
export interface ProviderAuth {
  apiKey?: string;
  secretHeaders?: Record<string, string>;
}

export interface ProviderSettings {
  provider: string;
  model: string;
  /** Required for openai-compatible (e.g. http://localhost:11434/v1 for Ollama); ignored otherwise. */
  baseUrl: string;
  /** Raw kernl.customProviders; validated by customProviders(). */
  customProviders?: unknown;
  /** Raw kernl.modelOptions; validated by modelOptions(). */
  modelOptions?: unknown;
  /** Raw kernl.modelProfiles: options per `provider/model` (and `*`) over kernl.modelOptions; see effectiveModelOptions(). */
  modelProfiles?: unknown;
}

export interface ModelOptions {
  temperature?: number;
  maxOutputTokens?: number;
  reasoningEffort?: "low" | "medium" | "high";
  /** The model's context window in tokens; Deep Agents compacts the conversation at 85% of it. */
  contextWindow?: number;
}

const EFFORTS = ["low", "medium", "high"] as const;
/** The thinking chip's choices: "off" turns off an effort set by a broader layer (kernl.modelOptions or `*`). */
export const THINKING_LEVELS = ["off", ...EFFORTS] as const;
export type ThinkingLevel = (typeof THINKING_LEVELS)[number];
const OPTION_FIELDS = ["temperature", "maxOutputTokens", "reasoningEffort", "contextWindow"];
/** Anthropic thinking budgets per effort; the API needs at least 1024 and less than max_tokens. */
const THINKING_BUDGET = { low: 2048, medium: 8192, high: 24576 } as const;

/**
 * Parses model options for a provider, naming the field and the reason when it can't be used. `where`
 * names the setting in messages: kernl.modelOptions, or the merged options of a model profile.
 */
export function modelOptions(raw: unknown, provider: ProviderId, where = "kernl.modelOptions"): ModelOptions | { error: string } {
  const fields = optionFields(raw, provider, where);
  if ("error" in fields) return fields;
  const { reasoningEffort, ...o } = fields;
  const effort = reasoningEffort === "off" ? undefined : reasoningEffort;
  if (effort !== undefined) {
    if (provider === "deepseek") return { error: `${where}.reasoningEffort isn't supported for deepseek (its thinking mode is on by default); remove it.` };
    if (provider === "anthropic") {
      if (o.temperature !== undefined) return { error: `For anthropic, ${where} can't set both reasoningEffort and temperature (extended thinking requires the default temperature).` };
      const budget = THINKING_BUDGET[effort];
      if (o.maxOutputTokens !== undefined && o.maxOutputTokens <= budget) {
        return { error: `For anthropic, reasoningEffort ${effort} thinks with ${budget} tokens, so ${where}.maxOutputTokens must be above ${budget}.` };
      }
    }
  }
  return { temperature: o.temperature, maxOutputTokens: o.maxOutputTokens, reasoningEffort: effort, contextWindow: o.contextWindow };
}

/** Each field's own type and range, without the rules that combine fields (see modelOptions). */
function optionFields(raw: unknown, provider: ProviderId, where: string): (Omit<ModelOptions, "reasoningEffort"> & { reasoningEffort?: ThinkingLevel }) | { error: string } {
  if (raw === undefined || raw === null) return {};
  if (typeof raw !== "object" || Array.isArray(raw)) return { error: `Expected ${where} to be an object, got ${JSON.stringify(raw)}.` };
  const o = raw as Record<string, unknown>;
  for (const key of Object.keys(o)) {
    if (!OPTION_FIELDS.includes(key)) return { error: `${where} has an unknown field '${key}'; expected ${OPTION_FIELDS.slice(0, -1).join(", ")}, or ${OPTION_FIELDS.at(-1)}.` };
  }
  const maxTemperature = provider === "anthropic" ? 1 : 2;
  if (o.temperature !== undefined && (typeof o.temperature !== "number" || o.temperature < 0 || o.temperature > maxTemperature)) {
    return { error: `Expected ${where}.temperature to be a number from 0 to ${maxTemperature} for ${provider}, got ${JSON.stringify(o.temperature)}.` };
  }
  if (o.maxOutputTokens !== undefined && (!Number.isInteger(o.maxOutputTokens) || (o.maxOutputTokens as number) < 1)) {
    return { error: `Expected ${where}.maxOutputTokens to be a whole number above 0, got ${JSON.stringify(o.maxOutputTokens)}.` };
  }
  if (o.contextWindow !== undefined && (!Number.isInteger(o.contextWindow) || (o.contextWindow as number) < 1000)) {
    return { error: `Expected ${where}.contextWindow to be a whole number of tokens, at least 1000, got ${JSON.stringify(o.contextWindow)}.` };
  }
  if (o.reasoningEffort !== undefined && !(THINKING_LEVELS as readonly unknown[]).includes(o.reasoningEffort)) {
    return { error: `Expected ${where}.reasoningEffort to be low, medium, high, or off, got ${JSON.stringify(o.reasoningEffort)}.` };
  }
  return o as Omit<ModelOptions, "reasoningEffort"> & { reasoningEffort?: ThinkingLevel };
}

/** The kernl.modelProfiles key for a provider's model: `anthropic/claude-sonnet-5-5`, `custom:gateway/team/model`. */
export const profileKey = (provider: string, model: string) => `${provider}/${model}`;

/**
 * The options a model is built with: kernl.modelOptions, then the `*` profile, then the model's own
 * profile in kernl.modelProfiles, each field overriding the one before. A bad field names its own setting.
 */
export function effectiveModelOptions(s: ProviderSettings, r: Pick<ResolvedProvider, "provider" | "model" | "custom">): ModelOptions | { error: string } {
  const api = providerApi(r);
  const profiles = s.modelProfiles ?? {};
  if (typeof profiles !== "object" || Array.isArray(profiles)) return { error: `Expected kernl.modelProfiles to be an object of model profiles, got ${JSON.stringify(profiles)}.` };
  const key = profileKey(r.provider, r.model);
  const layers: [unknown, string][] = [
    [s.modelOptions, "kernl.modelOptions"],
    [(profiles as Record<string, unknown>)["*"], 'kernl.modelProfiles["*"]'],
    [(profiles as Record<string, unknown>)[key], `kernl.modelProfiles["${key}"]`],
  ];
  const merged: Record<string, unknown> = {};
  for (const [raw, where] of layers) {
    const fields = optionFields(raw, api, where);
    if ("error" in fields) return fields;
    Object.assign(merged, fields);
  }
  const fromProfiles = layers.slice(1).some(([raw]) => raw !== undefined);
  return modelOptions(merged, api, fromProfiles ? `the options for ${key} (kernl.modelOptions with kernl.modelProfiles)` : "kernl.modelOptions");
}

const CUSTOM_ID = /^[a-z0-9-]+$/;
const isHttpUrl = (url: unknown) => typeof url === "string" && /^https?:\/\//.test(url);
/** An HTTP header name (RFC 9110 token). */
export const HEADER_NAME = /^[A-Za-z0-9!#$%&'*+.^_`|~-]+$/;

export function isProviderId(value: unknown): value is ProviderId {
  if (typeof value !== "string") return false;
  if ((BUILT_IN_PROVIDERS as readonly string[]).includes(value)) return true;
  return value.startsWith("custom:") && CUSTOM_ID.test(value.slice("custom:".length));
}

/** Parses kernl.customProviders, naming the first bad entry and field. */
export function customProviders(raw: unknown): CustomProvider[] | { error: string } {
  if (raw === undefined) return [];
  if (!Array.isArray(raw)) return { error: `Expected kernl.customProviders to be a list, got ${JSON.stringify(raw)}.` };
  const seen = new Set<string>();
  const out: CustomProvider[] = [];
  for (const [i, e] of raw.entries()) {
    const where = `kernl.customProviders[${i}]`;
    if (typeof e?.id !== "string" || !CUSTOM_ID.test(e.id)) return { error: `Expected ${where}.id to be lowercase letters, digits, or dashes, got ${JSON.stringify(e?.id)}.` };
    if (seen.has(e.id)) return { error: `Expected ${where}.id to be unique, got a second '${e.id}'.` };
    if (!isHttpUrl(e.baseUrl)) return { error: `Expected ${where}.baseUrl to be an http(s) URL, got ${JSON.stringify(e.baseUrl)}.` };
    if (typeof e.model !== "string" || !e.model.trim()) return { error: `Expected ${where}.model to be a model id, got ${JSON.stringify(e.model)}.` };
    const protocol = e.protocol ?? "openai";
    if (protocol !== "openai" && protocol !== "anthropic") return { error: `Expected ${where}.protocol to be "openai" or "anthropic", got ${JSON.stringify(e.protocol)}.` };
    const headers = e.headers ?? {};
    if (typeof headers !== "object" || Array.isArray(headers)) return { error: `Expected ${where}.headers to be an object of header names to values, got ${JSON.stringify(e.headers)}.` };
    for (const [name, value] of Object.entries(headers)) {
      if (!HEADER_NAME.test(name)) return { error: `Expected ${where}.headers to have valid header names, got ${JSON.stringify(name)}.` };
      if (typeof value !== "string") return { error: `Expected ${where}.headers.${name} to be a string, got ${JSON.stringify(value)}.` };
    }
    const secretHeaders = e.secretHeaders ?? [];
    if (!Array.isArray(secretHeaders)) return { error: `Expected ${where}.secretHeaders to be a list of header names, got ${JSON.stringify(e.secretHeaders)}.` };
    for (const name of secretHeaders) {
      if (typeof name !== "string" || !HEADER_NAME.test(name)) return { error: `Expected ${where}.secretHeaders to hold header names, got ${JSON.stringify(name)}.` };
      if (Object.keys(headers).some((h) => h.toLowerCase() === name.toLowerCase())) return { error: `${where} names the header '${name}' in both headers and secretHeaders; keep it in one.` };
    }
    seen.add(e.id);
    out.push({ id: e.id, label: typeof e.label === "string" && e.label.trim() ? e.label : e.id, baseUrl: e.baseUrl, model: e.model, protocol, headers: headers as Record<string, string>, secretHeaders });
  }
  return out;
}

/** What a chat model is built from, after settings are validated. */
export interface ResolvedProvider {
  provider: ProviderId;
  model: string;
  baseUrl: string;
  keyRequired: boolean;
  /** Set for a custom provider. */
  custom?: CustomProvider;
}

/** Whether a provider can't be used without an API key: not for openai-compatible, nor for a custom provider that authenticates with a secret header. */
export function keyRequired(provider: ProviderId, custom?: CustomProvider): boolean {
  if (provider === "openai-compatible") return false;
  return !custom?.secretHeaders.length;
}

/** The API a provider speaks, for the options and the request shape: a custom provider's protocol, else the provider itself. */
export function providerApi(r: Pick<ResolvedProvider, "provider" | "custom">): ProviderId {
  return r.custom ? (r.custom.protocol === "anthropic" ? "anthropic" : "openai-compatible") : r.provider;
}

/** Turns settings into one provider, model, and base URL, or explains what is wrong. */
export function resolveProvider(s: ProviderSettings): ResolvedProvider | { error: string } {
  const custom = customProviders(s.customProviders);
  if ("error" in custom) return custom;
  if (s.provider.startsWith("custom:")) {
    const entry = custom.find((c) => `custom:${c.id}` === s.provider);
    if (!entry) return { error: `kernl.provider is '${s.provider}', but kernl.customProviders has no entry with id '${s.provider.slice("custom:".length)}'.` };
    return { provider: `custom:${entry.id}`, model: s.model.trim() || entry.model, baseUrl: entry.baseUrl, keyRequired: keyRequired(`custom:${entry.id}`, entry), custom: entry };
  }
  if (!isProviderId(s.provider)) {
    const choices = [...BUILT_IN_PROVIDERS, ...custom.map((c) => `custom:${c.id}`)];
    return { error: `Expected kernl.provider to be one of ${choices.join(", ")}, got '${s.provider}'.` };
  }
  const provider = s.provider as BuiltInProvider;
  const model = s.model.trim() || DEFAULT_MODELS[provider] || "";
  if (!model) return { error: `Choose a model for ${provider}: use the model chip, or set kernl.model.` };
  if (provider === "openai-compatible" && !isHttpUrl(s.baseUrl)) {
    return { error: `Expected kernl.baseUrl to be an http(s) URL for the openai-compatible provider, got '${s.baseUrl}'.` };
  }
  return { provider, model, baseUrl: s.baseUrl, keyRequired: keyRequired(provider) };
}

/** Why settings cannot build a model yet, or undefined when they can. Shown to the user as-is. */
export function settingsProblem(s: ProviderSettings, auth: ProviderAuth): string | undefined {
  const r = resolveProvider(s);
  if ("error" in r) return r.error;
  const options = effectiveModelOptions(s, r);
  if ("error" in options) return options.error;
  if (!auth.apiKey && r.keyRequired) return `No API key stored for ${r.provider}: add one with the model chip (or "Choose provider and model").`;
  const missing = r.custom && missingSecretHeader(r.custom, auth);
  if (missing) return `No value stored for ${r.provider}'s secret header ${missing}: set it with "kernl: Set API key".`;
  return undefined;
}

/** A custom provider's secret header whose value isn't stored (yet), or undefined: its requests would go out incomplete. */
export function missingSecretHeader(custom: CustomProvider, auth: ProviderAuth): string | undefined {
  return custom.secretHeaders.find((name) => !auth.secretHeaders?.[name]);
}

/**
 * The headers a custom provider's requests carry: its settings headers and secret headers. Without a key,
 * the Anthropic SDK's key header is removed (null), so the placeholder key it requires is never sent; the
 * OpenAI client drops its placeholder in withoutPlaceholderKey instead (LangChain discards null headers).
 */
export function customHeaders(custom: CustomProvider, auth: ProviderAuth): Record<string, string | null> {
  const headers: Record<string, string | null> = { ...custom.headers, ...auth.secretHeaders };
  if (!auth.apiKey && custom.protocol === "anthropic" && !Object.keys(headers).some((h) => h.toLowerCase() === "x-api-key")) headers["x-api-key"] = null;
  return headers;
}

/** A fetch for the OpenAI client that removes the placeholder key's bearer header; any other Authorization header (the user's own) is sent as is. */
function withoutPlaceholderKey(input: RequestInfo | URL, init?: RequestInit): Promise<Response> {
  const headers = new Headers(init?.headers);
  if (headers.get("authorization") === `Bearer ${NO_KEY}`) headers.delete("authorization");
  return fetch(input, { ...init, headers });
}

// The SDKs refuse to start without a key; a custom provider using header auth sends this, then removes its header (customHeaders).
const NO_KEY = "not-needed";

/** Builds the chat model for the given settings and credentials. Call settingsProblem() first. */
export function createChatModel(s: ProviderSettings, auth: ProviderAuth): BaseChatModel {
  const problem = settingsProblem(s, auth);
  if (problem) throw new Error(problem);
  const r = resolveProvider(s) as ResolvedProvider;
  const o = effectiveModelOptions(s, r) as ModelOptions;
  return withContextWindow(buildModel(r, o, auth), o.contextWindow);
}

/**
 * The chat model classes read a model's context window from a fixed table (`profile`), which doesn't know
 * custom or newer models. A configured window replaces the table's maxInputTokens, so Deep Agents
 * compacts at 85% of it (without one, Deep Agents compacts at 170k tokens).
 */
function withContextWindow(model: BaseChatModel, contextWindow: number | undefined): BaseChatModel {
  if (contextWindow) Object.defineProperty(model, "profile", { value: { ...model.profile, maxInputTokens: contextWindow }, configurable: true });
  return model;
}

function buildModel(r: ResolvedProvider, o: ModelOptions, auth: ProviderAuth): BaseChatModel {
  const apiKey = auth.apiKey;
  const effort = o.reasoningEffort;
  const openAiStyle = { temperature: o.temperature, maxTokens: o.maxOutputTokens, reasoning: effort ? { effort } : undefined };
  if (r.custom?.protocol === "anthropic") return anthropicModel(r.model, o, { apiKey: apiKey || NO_KEY, anthropicApiUrl: r.baseUrl, clientOptions: { defaultHeaders: customHeaders(r.custom, auth) } });
  switch (r.provider) {
    case "anthropic":
      return anthropicModel(r.model, o, { apiKey });
    case "openai":
      return new ChatOpenAI({ model: r.model, apiKey, streaming: true, ...openAiStyle });
    case "google":
      return new ChatGoogleGenerativeAI({ model: r.model, apiKey, streaming: true, temperature: o.temperature, maxOutputTokens: o.maxOutputTokens, thinkingConfig: effort ? { thinkingLevel: effort.toUpperCase() as "LOW" } : undefined });
    case "deepseek":
      // ChatDeepSeek, not ChatOpenAI: it carries DeepSeek's reasoning_content between turns.
      return new ChatDeepSeek({ model: r.model, apiKey, streaming: true, temperature: o.temperature, maxTokens: o.maxOutputTokens });
    case "openai-compatible":
      // Local servers such as Ollama accept any key; the OpenAI client requires a non-empty one.
      return new ChatOpenAI({ model: r.model, apiKey: apiKey || "not-needed", streaming: true, configuration: { baseURL: r.baseUrl }, ...openAiStyle });
    default:
      return new ChatOpenAI({
        model: r.model,
        apiKey: apiKey || NO_KEY,
        streaming: true,
        configuration: { baseURL: r.baseUrl, defaultHeaders: customHeaders(r.custom!, auth), ...(apiKey ? {} : { fetch: withoutPlaceholderKey }) },
        ...openAiStyle,
      });
  }
}

function anthropicModel(model: string, o: ModelOptions, connection: Pick<AnthropicInput, "apiKey" | "anthropicApiUrl" | "clientOptions">): BaseChatModel {
  const budget = o.reasoningEffort ? THINKING_BUDGET[o.reasoningEffort] : undefined;
  // max_tokens must exceed the thinking budget; leave room for the answer when it isn't set.
  const maxTokens = o.maxOutputTokens ?? (budget ? budget + 8192 : undefined);
  return new ChatAnthropic({ model, ...connection, streaming: true, temperature: o.temperature, maxTokens, thinking: budget ? { type: "enabled", budget_tokens: budget, display: "summarized" } : undefined });
}
