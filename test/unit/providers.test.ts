import { strict as assert } from "node:assert";
import { test } from "node:test";
import { ChatAnthropic } from "@langchain/anthropic";
import { ChatDeepSeek } from "@langchain/deepseek";
import { ChatGoogleGenerativeAI } from "@langchain/google-genai";
import { ChatOpenAI } from "@langchain/openai";
import { KeyStore, type Secrets } from "../../src/providers/keys";
import { createChatModel, isProviderId, type ProviderSettings, resolveProvider, settingsProblem } from "../../src/providers/registry";
import { Redactor } from "../../src/log";

const base: ProviderSettings = { provider: "anthropic", model: "some-model", baseUrl: "" };

test("builds one model class per provider from settings and a stub key", () => {
  assert.ok(createChatModel(base, "sk-stub-key-123") instanceof ChatAnthropic);
  assert.ok(createChatModel({ ...base, provider: "openai" }, "sk-stub-key-123") instanceof ChatOpenAI);
  assert.ok(createChatModel({ ...base, provider: "google" }, "stub-google-key") instanceof ChatGoogleGenerativeAI);
  const local = createChatModel({ ...base, provider: "openai-compatible", baseUrl: "http://localhost:11434/v1" }, undefined);
  assert.ok(local instanceof ChatOpenAI);
});

test("explains what is missing instead of building a broken model", () => {
  assert.match(settingsProblem({ ...base, provider: "openai", model: " " }, "k")!, /Choose a model for openai: use the model chip, or set kernl.model/);
  assert.equal(settingsProblem({ ...base, model: " " }, "k"), undefined, "Anthropic has a default model");
  assert.match(settingsProblem(base, undefined)!, /No API key stored for anthropic/);
  assert.match(settingsProblem({ ...base, provider: "openai-compatible", baseUrl: "localhost:11434" }, undefined)!, /http\(s\) URL/);
  assert.match(settingsProblem({ ...base, provider: "bogus" as any }, "k")!, /one of anthropic, openai, google, deepseek, openai-compatible/);
  assert.equal(settingsProblem({ ...base, provider: "openai-compatible", baseUrl: "http://localhost:11434/v1" }, undefined), undefined);
  assert.throws(() => createChatModel(base, undefined), /No API key stored/);
});

const OPENROUTER = { id: "openrouter", label: "OpenRouter", baseUrl: "https://openrouter.ai/api/v1", model: "some/model" };

test("DeepSeek builds ChatDeepSeek, defaulting to deepseek-flash when no model is set", () => {
  const deepseek = { ...base, provider: "deepseek", model: "" };
  assert.match(settingsProblem(deepseek, undefined)!, /No API key stored for deepseek/);
  assert.equal(settingsProblem(deepseek, "sk-stub-deepseek"), undefined);
  const model = createChatModel(deepseek, "sk-stub-deepseek");
  assert.ok(model instanceof ChatDeepSeek);
  assert.equal((model as ChatDeepSeek).model, "deepseek-flash");
  assert.equal((createChatModel({ ...deepseek, model: "deepseek-v4-pro" }, "sk-stub-deepseek") as ChatDeepSeek).model, "deepseek-v4-pro");
});

test("a custom provider builds ChatOpenAI against its own base URL and model, and needs its own key", () => {
  const s = { ...base, provider: "custom:openrouter", model: "", customProviders: [OPENROUTER] };
  assert.match(settingsProblem(s, undefined)!, /No API key stored for custom:openrouter/);
  const model = createChatModel(s, "sk-stub-openrouter") as ChatOpenAI;
  assert.ok(model instanceof ChatOpenAI);
  assert.equal(model.model, "some/model");
  assert.equal((model as any).clientConfig.baseURL, "https://openrouter.ai/api/v1");
  assert.equal((resolveProvider({ ...s, model: "override/model" }) as any).model, "override/model", "kernl.model still wins when set");
});

test("malformed custom providers name the entry and field; unknown ids are explained", () => {
  const problem = (customProviders: unknown, provider = "custom:openrouter") => settingsProblem({ ...base, provider, customProviders }, "k");
  assert.match(problem([{ ...OPENROUTER, id: "Open Router" }])!, /customProviders\[0\]\.id/);
  assert.match(problem([{ ...OPENROUTER, baseUrl: "openrouter.ai" }])!, /customProviders\[0\]\.baseUrl to be an http\(s\) URL/);
  assert.match(problem([OPENROUTER, { ...OPENROUTER, model: "" }])!, /customProviders\[1\]\.id to be unique/);
  assert.match(problem([{ ...OPENROUTER, model: " " }])!, /customProviders\[0\]\.model/);
  assert.match(problem({ openrouter: OPENROUTER })!, /to be a list/);
  assert.match(problem([OPENROUTER], "custom:groq")!, /no entry with id 'groq'/);
  assert.match(problem([OPENROUTER], "bogus")!, /one of .*custom:openrouter, got 'bogus'/);
  assert.equal(isProviderId("custom:openrouter"), true);
  assert.equal(isProviderId("custom:Bad Id"), false);
});

function memorySecrets(): Secrets & { map: Map<string, string> } {
  const map = new Map<string, string>();
  return {
    map,
    get: async (k) => map.get(k),
    store: async (k, v) => void map.set(k, v),
    delete: async (k) => void map.delete(k),
  };
}

test("custom provider keys get their own secret, and Clear removes every provider key but nothing else", async () => {
  const secrets = memorySecrets();
  const redactor = new Redactor();
  const keys = new KeyStore(secrets, redactor);
  await keys.store("custom:openrouter", "  sk-openrouter-secret-1  ");
  await keys.store("custom:removed-entry", "sk-orphan-secret-3");
  await keys.store("custom:openrouter", "sk-openrouter-secret-1");
  secrets.map.set("kernl.apiKey.anthropic", "sk-stored-before-the-index-2");
  secrets.map.set("kernl.agentKey.claude-code", "sk-agent-secret-4");
  assert.equal(await keys.get("custom:openrouter"), "sk-openrouter-secret-1");
  assert.ok(secrets.map.has("kernl.apiKey.custom.removed-entry"));
  assert.equal(redactor.scrub("key sk-openrouter-secret-1 here"), "key [redacted] here");
  await keys.clearAll();
  assert.deepEqual([...secrets.map.keys()], ["kernl.agentKey.claude-code"], "agent credentials are cleared by their own store");
  assert.equal(redactor.scrub("sk-openrouter-secret-1"), "sk-openrouter-secret-1", "cleared keys are no longer scrubbed");
});

test("model options reach each provider's model in that provider's own form", () => {
  const opts = { temperature: 0.2, maxOutputTokens: 4000 };
  const openai = createChatModel({ ...base, provider: "openai", modelOptions: { ...opts, reasoningEffort: "high" } }, "k-123456789") as any;
  assert.deepEqual([openai.temperature, openai.maxTokens, openai.reasoning], [0.2, 4000, { effort: "high" }]);
  const google = createChatModel({ ...base, provider: "google", modelOptions: { ...opts, reasoningEffort: "low" } }, "k-123456789") as any;
  assert.deepEqual([google.temperature, google.maxOutputTokens, google.thinkingConfig], [0.2, 4000, { thinkingLevel: "LOW" }]);
  const deepseek = createChatModel({ ...base, provider: "deepseek", modelOptions: opts }, "k-123456789") as any;
  assert.deepEqual([deepseek.temperature, deepseek.maxTokens], [0.2, 4000]);
  const custom = createChatModel({ ...base, provider: "custom:openrouter", model: "", customProviders: [OPENROUTER], modelOptions: { temperature: 1.5 } }, "k-123456789") as any;
  assert.equal(custom.temperature, 1.5);
});

test("anthropic reasoning effort becomes extended thinking, with room left for the answer", () => {
  const thinking = createChatModel({ ...base, modelOptions: { reasoningEffort: "medium" } }, "k-123456789") as any;
  assert.deepEqual(thinking.thinking, { type: "enabled", budget_tokens: 8192 });
  assert.ok(thinking.maxTokens > 8192, `max tokens ${thinking.maxTokens} must exceed the thinking budget`);
  const plain = createChatModel({ ...base, modelOptions: { temperature: 0.3 } }, "k-123456789") as any;
  assert.equal(plain.temperature, 0.3);
  assert.notEqual(plain.thinking?.type, "enabled");
});

test("model options a provider can't take are named instead of dropped", () => {
  const problem = (provider: string, modelOptions: unknown) => settingsProblem({ ...base, provider, model: "m", modelOptions }, "k-123456789");
  assert.equal(problem("openai", {}), undefined);
  assert.match(problem("deepseek", { reasoningEffort: "low" })!, /reasoningEffort isn't supported for deepseek/);
  assert.match(problem("anthropic", { reasoningEffort: "low", temperature: 0.5 })!, /can't set both reasoningEffort and temperature/);
  assert.match(problem("anthropic", { reasoningEffort: "high", maxOutputTokens: 1000 })!, /maxOutputTokens must be above 24576/);
  assert.match(problem("anthropic", { temperature: 1.5 })!, /from 0 to 1 for anthropic/);
  assert.match(problem("openai", { temperature: 3 })!, /from 0 to 2 for openai/);
  assert.match(problem("openai", { maxOutputTokens: 0 })!, /whole number above 0/);
  assert.match(problem("openai", { reasoningEffort: "max" })!, /low, medium, or high/);
  assert.match(problem("openai", { topP: 1 })!, /unknown field 'topP'/);
});
