import { ChatAnthropic } from "@langchain/anthropic";
import type { BaseChatModel } from "@langchain/core/language_models/chat_models";
import { ChatDeepSeek } from "@langchain/deepseek";
import { ChatGoogleGenerativeAI } from "@langchain/google-genai";
import { ChatOpenAI } from "@langchain/openai";

export const BUILT_IN_PROVIDERS = ["anthropic", "openai", "google", "deepseek", "openai-compatible"] as const;
type BuiltInProvider = (typeof BUILT_IN_PROVIDERS)[number];
/** A built-in provider, or `custom:<id>` for an entry in yourstack.customProviders. */
export type ProviderId = BuiltInProvider | `custom:${string}`;

/** Used when yourstack.model is empty. */
const DEFAULT_MODELS: Partial<Record<BuiltInProvider, string>> = { deepseek: "deepseek-flash" };

/** An OpenAI-compatible service the user named in yourstack.customProviders. Its key lives in SecretStorage. */
export interface CustomProvider {
  id: string;
  label: string;
  baseUrl: string;
  model: string;
}

export interface ProviderSettings {
  provider: string;
  model: string;
  /** Required for openai-compatible (e.g. http://localhost:11434/v1 for Ollama); ignored otherwise. */
  baseUrl: string;
  /** Raw yourstack.customProviders; validated by customProviders(). */
  customProviders?: unknown;
  /** Raw yourstack.modelOptions; validated by modelOptions(). */
  modelOptions?: unknown;
}

export interface ModelOptions {
  temperature?: number;
  maxOutputTokens?: number;
  reasoningEffort?: "low" | "medium" | "high";
}

const EFFORTS = ["low", "medium", "high"] as const;
/** Anthropic thinking budgets per effort; the API needs at least 1024 and less than max_tokens. */
const THINKING_BUDGET = { low: 2048, medium: 8192, high: 24576 } as const;

/** Parses yourstack.modelOptions for a provider, naming the field and the reason when it can't be used. */
export function modelOptions(raw: unknown, provider: ProviderId): ModelOptions | { error: string } {
  if (raw === undefined || raw === null) return {};
  if (typeof raw !== "object" || Array.isArray(raw)) return { error: `Expected yourstack.modelOptions to be an object, got ${JSON.stringify(raw)}.` };
  const o = raw as Record<string, unknown>;
  for (const key of Object.keys(o)) {
    if (!["temperature", "maxOutputTokens", "reasoningEffort"].includes(key)) return { error: `yourstack.modelOptions has an unknown field '${key}'; expected temperature, maxOutputTokens, or reasoningEffort.` };
  }
  const maxTemperature = provider === "anthropic" ? 1 : 2;
  if (o.temperature !== undefined && (typeof o.temperature !== "number" || o.temperature < 0 || o.temperature > maxTemperature)) {
    return { error: `Expected yourstack.modelOptions.temperature to be a number from 0 to ${maxTemperature} for ${provider}, got ${JSON.stringify(o.temperature)}.` };
  }
  if (o.maxOutputTokens !== undefined && (!Number.isInteger(o.maxOutputTokens) || (o.maxOutputTokens as number) < 1)) {
    return { error: `Expected yourstack.modelOptions.maxOutputTokens to be a whole number above 0, got ${JSON.stringify(o.maxOutputTokens)}.` };
  }
  const effort = o.reasoningEffort;
  if (effort !== undefined) {
    if (!(EFFORTS as readonly unknown[]).includes(effort)) return { error: `Expected yourstack.modelOptions.reasoningEffort to be low, medium, or high, got ${JSON.stringify(effort)}.` };
    if (provider === "deepseek") return { error: "yourstack.modelOptions.reasoningEffort isn't supported for deepseek (its thinking mode is on by default); remove it." };
    if (provider === "anthropic") {
      if (o.temperature !== undefined) return { error: "For anthropic, yourstack.modelOptions can't set both reasoningEffort and temperature (extended thinking requires the default temperature)." };
      const budget = THINKING_BUDGET[effort as keyof typeof THINKING_BUDGET];
      if (o.maxOutputTokens !== undefined && (o.maxOutputTokens as number) <= budget) {
        return { error: `For anthropic, reasoningEffort ${effort} thinks with ${budget} tokens, so yourstack.modelOptions.maxOutputTokens must be above ${budget}.` };
      }
    }
  }
  return { temperature: o.temperature as number | undefined, maxOutputTokens: o.maxOutputTokens as number | undefined, reasoningEffort: effort as ModelOptions["reasoningEffort"] };
}

const CUSTOM_ID = /^[a-z0-9-]+$/;
const isHttpUrl = (url: unknown) => typeof url === "string" && /^https?:\/\//.test(url);

export function isProviderId(value: unknown): value is ProviderId {
  if (typeof value !== "string") return false;
  if ((BUILT_IN_PROVIDERS as readonly string[]).includes(value)) return true;
  return value.startsWith("custom:") && CUSTOM_ID.test(value.slice("custom:".length));
}

/** Parses yourstack.customProviders, naming the first bad entry and field. */
export function customProviders(raw: unknown): CustomProvider[] | { error: string } {
  if (raw === undefined) return [];
  if (!Array.isArray(raw)) return { error: `Expected yourstack.customProviders to be a list, got ${JSON.stringify(raw)}.` };
  const seen = new Set<string>();
  const out: CustomProvider[] = [];
  for (const [i, e] of raw.entries()) {
    const where = `yourstack.customProviders[${i}]`;
    if (typeof e?.id !== "string" || !CUSTOM_ID.test(e.id)) return { error: `Expected ${where}.id to be lowercase letters, digits, or dashes, got ${JSON.stringify(e?.id)}.` };
    if (seen.has(e.id)) return { error: `Expected ${where}.id to be unique, got a second '${e.id}'.` };
    if (!isHttpUrl(e.baseUrl)) return { error: `Expected ${where}.baseUrl to be an http(s) URL, got ${JSON.stringify(e.baseUrl)}.` };
    if (typeof e.model !== "string" || !e.model.trim()) return { error: `Expected ${where}.model to be a model id, got ${JSON.stringify(e.model)}.` };
    seen.add(e.id);
    out.push({ id: e.id, label: typeof e.label === "string" && e.label.trim() ? e.label : e.id, baseUrl: e.baseUrl, model: e.model });
  }
  return out;
}

/** What a chat model is built from, after settings are validated. */
export interface ResolvedProvider {
  provider: ProviderId;
  model: string;
  baseUrl: string;
  keyRequired: boolean;
}

/** Turns settings into one provider, model, and base URL, or explains what is wrong. */
export function resolveProvider(s: ProviderSettings): ResolvedProvider | { error: string } {
  const custom = customProviders(s.customProviders);
  if ("error" in custom) return custom;
  if (s.provider.startsWith("custom:")) {
    const entry = custom.find((c) => `custom:${c.id}` === s.provider);
    if (!entry) return { error: `yourstack.provider is '${s.provider}', but yourstack.customProviders has no entry with id '${s.provider.slice("custom:".length)}'.` };
    return { provider: `custom:${entry.id}`, model: s.model.trim() || entry.model, baseUrl: entry.baseUrl, keyRequired: true };
  }
  if (!isProviderId(s.provider)) {
    const choices = [...BUILT_IN_PROVIDERS, ...custom.map((c) => `custom:${c.id}`)];
    return { error: `Expected yourstack.provider to be one of ${choices.join(", ")}, got '${s.provider}'.` };
  }
  const provider = s.provider as BuiltInProvider;
  const model = s.model.trim() || DEFAULT_MODELS[provider] || "";
  if (!model) return { error: "Set yourstack.model to a model id for your provider." };
  if (provider === "openai-compatible" && !isHttpUrl(s.baseUrl)) {
    return { error: `Expected yourstack.baseUrl to be an http(s) URL for the openai-compatible provider, got '${s.baseUrl}'.` };
  }
  return { provider, model, baseUrl: s.baseUrl, keyRequired: provider !== "openai-compatible" };
}

/** Why settings cannot build a model yet, or undefined when they can. Shown to the user as-is. */
export function settingsProblem(s: ProviderSettings, apiKey: string | undefined): string | undefined {
  const r = resolveProvider(s);
  if ("error" in r) return r.error;
  const options = modelOptions(s.modelOptions, r.provider);
  if ("error" in options) return options.error;
  if (!apiKey && r.keyRequired) return `No API key stored for ${r.provider}. Run "YourStack: Set API key".`;
  return undefined;
}

/** Builds the chat model for the given settings and key. Call settingsProblem() first. */
export function createChatModel(s: ProviderSettings, apiKey: string | undefined): BaseChatModel {
  const problem = settingsProblem(s, apiKey);
  if (problem) throw new Error(problem);
  const r = resolveProvider(s) as ResolvedProvider;
  const o = modelOptions(s.modelOptions, r.provider) as ModelOptions;
  const effort = o.reasoningEffort;
  const openAiStyle = { temperature: o.temperature, maxTokens: o.maxOutputTokens, reasoning: effort ? { effort } : undefined };
  switch (r.provider) {
    case "anthropic": {
      const budget = effort ? THINKING_BUDGET[effort] : undefined;
      // max_tokens must exceed the thinking budget; leave room for the answer when it isn't set.
      const maxTokens = o.maxOutputTokens ?? (budget ? budget + 8192 : undefined);
      return new ChatAnthropic({ model: r.model, apiKey, streaming: true, temperature: o.temperature, maxTokens, thinking: budget ? { type: "enabled", budget_tokens: budget } : undefined });
    }
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
      return new ChatOpenAI({ model: r.model, apiKey, streaming: true, configuration: { baseURL: r.baseUrl }, ...openAiStyle });
  }
}
