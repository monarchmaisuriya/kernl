import { strict as assert } from "node:assert";
import { createServer } from "node:http";
import type { AddressInfo } from "node:net";
import { test } from "node:test";
import { ChatAnthropic } from "@langchain/anthropic";
import { ChatDeepSeek } from "@langchain/deepseek";
import { ChatGoogleGenerativeAI } from "@langchain/google-genai";
import { ChatOpenAI } from "@langchain/openai";
import { KeyStore, type Secrets } from "../../src/providers/keys";
import { createChatModel, effectiveModelOptions, isProviderId, missingSecretHeader, type ProviderSettings, resolveProvider, settingsProblem } from "../../src/providers/registry";
import { Redactor } from "../../src/log";

const base: ProviderSettings = { provider: "anthropic", model: "some-model", baseUrl: "" };

test("builds one model class per provider from settings and a stub key", () => {
  assert.ok(createChatModel(base, { apiKey: "sk-stub-key-123" }) instanceof ChatAnthropic);
  assert.ok(createChatModel({ ...base, provider: "openai" }, { apiKey: "sk-stub-key-123" }) instanceof ChatOpenAI);
  assert.ok(createChatModel({ ...base, provider: "google" }, { apiKey: "stub-google-key" }) instanceof ChatGoogleGenerativeAI);
  const local = createChatModel({ ...base, provider: "openai-compatible", baseUrl: "http://localhost:11434/v1" }, {});
  assert.ok(local instanceof ChatOpenAI);
});

test("explains what is missing instead of building a broken model", () => {
  assert.match(settingsProblem({ ...base, provider: "openai", model: " " }, { apiKey: "k" })!, /Choose a model for openai: use the model chip, or set kernl.model/);
  assert.equal(settingsProblem({ ...base, model: " " }, { apiKey: "k" }), undefined, "Anthropic has a default model");
  assert.match(settingsProblem(base, {})!, /No API key stored for anthropic/);
  assert.match(settingsProblem({ ...base, provider: "openai-compatible", baseUrl: "localhost:11434" }, {})!, /http\(s\) URL/);
  assert.match(settingsProblem({ ...base, provider: "bogus" as any }, { apiKey: "k" })!, /one of anthropic, openai, google, deepseek, openai-compatible/);
  assert.equal(settingsProblem({ ...base, provider: "openai-compatible", baseUrl: "http://localhost:11434/v1" }, {}), undefined);
  assert.throws(() => createChatModel(base, {}), /No API key stored/);
});

const OPENROUTER = { id: "openrouter", label: "OpenRouter", baseUrl: "https://openrouter.ai/api/v1", model: "some/model" };

test("DeepSeek builds ChatDeepSeek, defaulting to deepseek-flash when no model is set", () => {
  const deepseek = { ...base, provider: "deepseek", model: "" };
  assert.match(settingsProblem(deepseek, {})!, /No API key stored for deepseek/);
  assert.equal(settingsProblem(deepseek, { apiKey: "sk-stub-deepseek" }), undefined);
  const model = createChatModel(deepseek, { apiKey: "sk-stub-deepseek" });
  assert.ok(model instanceof ChatDeepSeek);
  assert.equal((model as ChatDeepSeek).model, "deepseek-flash");
  assert.equal((createChatModel({ ...deepseek, model: "deepseek-v4-pro" }, { apiKey: "sk-stub-deepseek" }) as ChatDeepSeek).model, "deepseek-v4-pro");
});

test("a custom provider builds ChatOpenAI against its own base URL and model, and needs its own key", () => {
  const s = { ...base, provider: "custom:openrouter", model: "", customProviders: [OPENROUTER] };
  assert.match(settingsProblem(s, {})!, /No API key stored for custom:openrouter/);
  const model = createChatModel(s, { apiKey: "sk-stub-openrouter" }) as ChatOpenAI;
  assert.ok(model instanceof ChatOpenAI);
  assert.equal(model.model, "some/model");
  assert.equal((model as any).clientConfig.baseURL, "https://openrouter.ai/api/v1");
  assert.equal((resolveProvider({ ...s, model: "override/model" }) as any).model, "override/model", "kernl.model still wins when set");
});

test("malformed custom providers name the entry and field; unknown ids are explained", () => {
  const problem = (customProviders: unknown, provider = "custom:openrouter") => settingsProblem({ ...base, provider, customProviders }, { apiKey: "k" });
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
  const openai = createChatModel({ ...base, provider: "openai", modelOptions: { ...opts, reasoningEffort: "high" } }, { apiKey: "k-123456789" }) as any;
  assert.deepEqual([openai.temperature, openai.maxTokens, openai.reasoning], [0.2, 4000, { effort: "high" }]);
  const google = createChatModel({ ...base, provider: "google", modelOptions: { ...opts, reasoningEffort: "low" } }, { apiKey: "k-123456789" }) as any;
  assert.deepEqual([google.temperature, google.maxOutputTokens, google.thinkingConfig], [0.2, 4000, { thinkingLevel: "LOW" }]);
  const deepseek = createChatModel({ ...base, provider: "deepseek", modelOptions: opts }, { apiKey: "k-123456789" }) as any;
  assert.deepEqual([deepseek.temperature, deepseek.maxTokens], [0.2, 4000]);
  const custom = createChatModel({ ...base, provider: "custom:openrouter", model: "", customProviders: [OPENROUTER], modelOptions: { temperature: 1.5 } }, { apiKey: "k-123456789" }) as any;
  assert.equal(custom.temperature, 1.5);
});

test("anthropic reasoning effort becomes extended thinking, with room left for the answer", () => {
  const thinking = createChatModel({ ...base, modelOptions: { reasoningEffort: "medium" } }, { apiKey: "k-123456789" }) as any;
  assert.deepEqual(thinking.thinking, { type: "enabled", budget_tokens: 8192, display: "summarized" }, "summarized, so the thinking text comes back (current models omit it by default)");
  assert.ok(thinking.maxTokens > 8192, `max tokens ${thinking.maxTokens} must exceed the thinking budget`);
  const plain = createChatModel({ ...base, modelOptions: { temperature: 0.3 } }, { apiKey: "k-123456789" }) as any;
  assert.equal(plain.temperature, 0.3);
  assert.notEqual(plain.thinking?.type, "enabled");
});

test("model options a provider can't take are named instead of dropped", () => {
  const problem = (provider: string, modelOptions: unknown) => settingsProblem({ ...base, provider, model: "m", modelOptions }, { apiKey: "k-123456789" });
  assert.equal(problem("openai", {}), undefined);
  assert.match(problem("deepseek", { reasoningEffort: "low" })!, /reasoningEffort isn't supported for deepseek/);
  assert.match(problem("anthropic", { reasoningEffort: "low", temperature: 0.5 })!, /can't set both reasoningEffort and temperature/);
  assert.match(problem("anthropic", { reasoningEffort: "high", maxOutputTokens: 1000 })!, /maxOutputTokens must be above 24576/);
  assert.match(problem("anthropic", { temperature: 1.5 })!, /from 0 to 1 for anthropic/);
  assert.match(problem("openai", { temperature: 3 })!, /from 0 to 2 for openai/);
  assert.match(problem("openai", { maxOutputTokens: 0 })!, /whole number above 0/);
  assert.match(problem("openai", { reasoningEffort: "max" })!, /low, medium, high, or off, got "max"/);
  assert.match(problem("openai", { topP: 1 })!, /unknown field 'topP'/);
});

// Custom providers with headers: secret header values come from SecretStorage, never from settings;
// a provider with a secret header needs no key; and each protocol sends exactly the configured headers.
const GATEWAY = { id: "gateway", label: "Gateway", baseUrl: "https://gw.example/v1", model: "team/model" };

test("custom provider entries without the new fields still parse, as the OpenAI protocol with no headers", () => {
  const r = resolveProvider({ ...base, provider: "custom:gateway", customProviders: [GATEWAY] }) as any;
  assert.deepEqual(r.custom, { ...GATEWAY, protocol: "openai", headers: {}, secretHeaders: [] });
  assert.equal(r.keyRequired, true);
});

test("bad protocol or header fields name the entry and field", () => {
  const problem = (entry: object) => settingsProblem({ ...base, provider: "custom:gateway", customProviders: [{ ...GATEWAY, ...entry }] }, { apiKey: "k" });
  assert.match(problem({ protocol: "gemini" })!, /customProviders\[0\]\.protocol to be "openai" or "anthropic", got "gemini"/);
  assert.match(problem({ headers: ["X-Team"] })!, /customProviders\[0\]\.headers to be an object/);
  assert.match(problem({ headers: { "X Team": "a" } })!, /valid header names, got "X Team"/);
  assert.match(problem({ headers: { "X-Team": 7 } })!, /headers\.X-Team to be a string, got 7/);
  assert.match(problem({ secretHeaders: "X-Token" })!, /secretHeaders to be a list/);
  assert.match(problem({ headers: { "x-token": "a" }, secretHeaders: ["X-Token"] })!, /names the header 'X-Token' in both headers and secretHeaders/);
});

test("a secret header replaces the key: no key needed, but its value must be stored", () => {
  const s = { ...base, provider: "custom:gateway", customProviders: [{ ...GATEWAY, secretHeaders: ["X-Token"] }] };
  assert.equal((resolveProvider(s) as any).keyRequired, false);
  assert.match(settingsProblem(s, {})!, /No value stored for custom:gateway's secret header X-Token/);
  assert.equal(settingsProblem(s, { secretHeaders: { "X-Token": "t" } }), undefined);
});

test("the Anthropic protocol builds ChatAnthropic against the provider's base URL, with Anthropic's thinking options", () => {
  const s = { ...base, provider: "custom:gateway", customProviders: [{ ...GATEWAY, protocol: "anthropic", baseUrl: "https://gw.example/anthropic" }], modelOptions: { reasoningEffort: "low" } };
  const model = createChatModel(s, { apiKey: "k" }) as any;
  assert.ok(model instanceof ChatAnthropic);
  assert.equal((model as any).apiUrl, "https://gw.example/anthropic");
  assert.equal((model as any).thinking.budget_tokens, 2048);
  assert.match(settingsProblem({ ...s, modelOptions: { reasoningEffort: "low", temperature: 0.5 } }, { apiKey: "k" })!, /can't set both reasoningEffort and temperature/, "options are checked as Anthropic's");
});

/** A local server that records each request's headers and refuses it (400), so the model call fails fast after sending. */
async function headerRecorder() {
  const seen: Record<string, string | string[] | undefined>[] = [];
  const server = createServer((req, res) => {
    seen.push(req.headers);
    req.resume();
    res.writeHead(400, { "content-type": "application/json" }).end(JSON.stringify({ error: { type: "invalid_request_error", message: "recorded" } }));
  });
  await new Promise<void>((r) => server.listen(0, "127.0.0.1", r));
  const url = `http://127.0.0.1:${(server.address() as AddressInfo).port}`;
  return { url, seen, close: () => new Promise<void>((r) => server.close(() => r())) };
}

for (const protocol of ["openai", "anthropic"] as const) {
  test(`${protocol} protocol: a local server sees the settings and secret headers, and no placeholder key`, async () => {
    const server = await headerRecorder();
    try {
      const entry = { ...GATEWAY, protocol, baseUrl: server.url, headers: { "X-Team": "kernl" }, secretHeaders: ["X-Token"] };
      const s = { ...base, provider: "custom:gateway", customProviders: [entry], modelOptions: { maxOutputTokens: 16 } };
      await assert.rejects(createChatModel(s, { secretHeaders: { "X-Token": "tok-secret-1" } }).invoke("hi"));
      await assert.rejects(createChatModel(s, { apiKey: "sk-real-key-2", secretHeaders: { "X-Token": "tok-secret-1" } }).invoke("hi"));
      assert.equal(server.seen.length, 2, "one request per call: a 400 isn't retried");
      const [headerOnly, withKey] = server.seen;
      for (const h of [headerOnly, withKey]) {
        assert.equal(h["x-team"], "kernl");
        assert.equal(h["x-token"], "tok-secret-1");
      }
      const keyHeader = protocol === "openai" ? "authorization" : "x-api-key";
      assert.equal(headerOnly[keyHeader], undefined, "without a key, the SDK's placeholder key isn't sent");
      assert.ok(!JSON.stringify(headerOnly).includes("not-needed"));
      assert.equal(withKey[keyHeader], protocol === "openai" ? "Bearer sk-real-key-2" : "sk-real-key-2");
    } finally {
      await server.close();
    }
  });
}

test("secret header values live in their own secrets, are redacted, gathered with the key, and cleared with the keys", async () => {
  const secrets = memorySecrets();
  const redactor = new Redactor();
  const keys = new KeyStore(secrets, redactor);
  const custom = [{ ...GATEWAY, secretHeaders: ["X-Token"] }];
  await keys.storeHeader("custom:gateway", "X-Token", " tok-secret-5 ");
  assert.deepEqual([...secrets.map.keys()].sort(), ["kernl.apiKeyIndex", "kernl.header.custom.gateway.x-token"]);
  assert.equal(redactor.scrub("sent tok-secret-5"), "sent [redacted]");
  assert.deepEqual(await keys.auth("custom:gateway", custom), { apiKey: undefined, secretHeaders: { "X-Token": "tok-secret-5" } });
  assert.deepEqual(await keys.auth("bogus", custom), {});
  await keys.clearAll();
  assert.deepEqual([...secrets.map.keys()], []);
  assert.equal(redactor.scrub("tok-secret-5"), "tok-secret-5");
});

// Model profiles: kernl.modelProfiles overrides kernl.modelOptions per model; the context window
// becomes the model's maxInputTokens, which is what Deep Agents compacts at 85% of.
test("a model's profile overrides the '*' profile, which overrides kernl.modelOptions; off turns thinking off", () => {
  const s = (modelProfiles: unknown) => ({ ...base, provider: "openai", model: "gpt-x", modelOptions: { reasoningEffort: "low", maxOutputTokens: 1000 }, modelProfiles });
  const o = (modelProfiles: unknown) => effectiveModelOptions(s(modelProfiles), { provider: "openai", model: "gpt-x" });
  assert.deepEqual(o({}), { temperature: undefined, maxOutputTokens: 1000, reasoningEffort: "low", contextWindow: undefined });
  assert.deepEqual(o({ "*": { reasoningEffort: "medium", contextWindow: 200000 }, "openai/gpt-x": { reasoningEffort: "high" }, "openai/other": { reasoningEffort: "off" } }), {
    temperature: undefined,
    maxOutputTokens: 1000,
    reasoningEffort: "high",
    contextWindow: 200000,
  });
  assert.equal((o({ "openai/gpt-x": { reasoningEffort: "off" } }) as any).reasoningEffort, undefined, "off overrides the base effort");
  const model = createChatModel(s({ "openai/gpt-x": { reasoningEffort: "off" } }), { apiKey: "k" }) as any;
  assert.equal(model.reasoning, undefined);
});

test("a bad profile names its own entry; combined rules name the merged options", () => {
  const problem = (provider: string, modelProfiles: unknown, modelOptions?: unknown) => settingsProblem({ ...base, provider, model: "m", modelOptions, modelProfiles }, { apiKey: "k" });
  assert.match(problem("openai", [])!, /Expected kernl.modelProfiles to be an object/);
  assert.match(problem("openai", { "openai/m": { contextWindow: 10 } })!, /kernl.modelProfiles\["openai\/m"\]\.contextWindow to be a whole number of tokens, at least 1000/);
  assert.match(problem("openai", { "*": { topK: 3 } })!, /kernl.modelProfiles\["\*"\] has an unknown field 'topK'/);
  assert.match(problem("anthropic", { "anthropic/m": { reasoningEffort: "low" } }, { temperature: 0.5 })!, /For anthropic, the options for anthropic\/m \(kernl.modelOptions with kernl.modelProfiles\) can't set both/);
  assert.match(problem("deepseek", { "deepseek/m": { reasoningEffort: "high" } })!, /reasoningEffort isn't supported for deepseek/);
  assert.equal(problem("deepseek", { "deepseek/m": { reasoningEffort: "off" } }), undefined, "off is always allowed");
});

test("contextWindow sets the model's maxInputTokens (what Deep Agents compacts at 85% of), keeping the rest of its profile", () => {
  const known = createChatModel({ ...base, model: "claude-sonnet-4-5" }, { apiKey: "k" });
  const table = known.profile.maxInputTokens;
  const sized = createChatModel({ ...base, model: "claude-sonnet-4-5", modelProfiles: { "anthropic/claude-sonnet-4-5": { contextWindow: 750_000 } } }, { apiKey: "k" });
  assert.equal(sized.profile.maxInputTokens, 750_000);
  assert.equal(sized.profile.imageInputs, known.profile.imageInputs, "the table's other fields stay");
  assert.notEqual(table, 750_000);
  const custom = createChatModel({ ...base, provider: "custom:gateway", model: "", customProviders: [GATEWAY], modelProfiles: { "*": { contextWindow: 64_000 } } }, { apiKey: "k" });
  assert.equal(custom.profile.maxInputTokens, 64_000, "a model the table doesn't know gets one");
});

test("a secret header without a stored value is named, so no request is sent without it (the key check and model list skip it)", () => {
  const entry = { ...GATEWAY, protocol: "openai" as const, headers: {}, secretHeaders: ["X-Token", "X-Org"] };
  assert.equal(missingSecretHeader(entry, {}), "X-Token");
  assert.equal(missingSecretHeader(entry, { secretHeaders: { "X-Token": "t" } }), "X-Org");
  assert.equal(missingSecretHeader(entry, { secretHeaders: { "X-Token": "t", "X-Org": "o" } }), undefined);
  assert.equal(missingSecretHeader({ ...entry, secretHeaders: [] }, {}), undefined);
});

test("registerAll reads every stored provider key and secret header value into a fresh redactor (built-in names and the index)", async () => {
  const secrets = memorySecrets();
  await new KeyStore(secrets, new Redactor()).store("custom:openrouter", "sk-openrouter-secret-1");
  await new KeyStore(secrets, new Redactor()).storeHeader("custom:openrouter", "X-Team-Token", "team-token-value-5");
  secrets.map.set("kernl.apiKey.anthropic", "sk-stored-before-the-index-2");
  const redactor = new Redactor();
  await new KeyStore(secrets, redactor).registerAll();
  assert.equal(redactor.scrub("sk-openrouter-secret-1 team-token-value-5 sk-stored-before-the-index-2"), "[redacted] [redacted] [redacted]");
});
