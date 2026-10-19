// The model picker's list: read from each API's models endpoint, cached for 10 minutes; a refusal, an
// unreadable or empty answer, or no answer in time means "type the model id" (undefined), and isn't cached.
import { strict as assert } from "node:assert";
import { test } from "node:test";
import { type ListFetch, listModels, parseModelList } from "../../src/providers/modelList";

test("model ids come from data[].id, or Google's models that can chat", () => {
  assert.deepEqual(parseModelList("openai", { data: [{ id: "gpt-a" }, { id: "" }, { object: "model" }, { id: "gpt-b" }] }), ["gpt-a", "gpt-b"]);
  assert.deepEqual(parseModelList("anthropic", { data: [{ id: "claude-x", display_name: "Claude X" }] }), ["claude-x"]);
  assert.deepEqual(
    parseModelList("google", { models: [{ name: "models/gemini-a", supportedGenerationMethods: ["generateContent"] }, { name: "models/embed", supportedGenerationMethods: ["embedContent"] }] }),
    ["gemini-a"],
  );
  assert.deepEqual(parseModelList("openai", "not json"), []);
});

function fakeFetch(answers: (() => { status: number; body?: unknown })[]) {
  const urls: string[] = [];
  const headers: Record<string, string>[] = [];
  const fetchImpl: ListFetch = async (url, init) => {
    urls.push(url);
    headers.push(init.headers);
    const a = answers.shift()!();
    return { status: a.status, json: async () => a.body };
  };
  return { fetchImpl, urls, headers };
}

test("a list is cached for 10 minutes per URL, with the request's headers sent, and Anthropic asked for every model", async () => {
  let t = 0;
  const f = fakeFetch([() => ({ status: 200, body: { data: [{ id: "m1" }] } }), () => ({ status: 200, body: { data: [{ id: "m2" }] } })]);
  const req = { url: "https://cache-test.example/v1/models", headers: { "X-Token": "t" } };
  const opts = { fetchImpl: f.fetchImpl, now: () => t };
  assert.deepEqual(await listModels(req, "anthropic", opts), ["m1"]);
  t = 9 * 60_000;
  assert.deepEqual(await listModels(req, "anthropic", opts), ["m1"], "from the cache");
  t = 11 * 60_000;
  assert.deepEqual(await listModels(req, "anthropic", opts), ["m2"], "asked again after 10 minutes");
  assert.deepEqual(f.urls, ["https://cache-test.example/v1/models?limit=1000", "https://cache-test.example/v1/models?limit=1000"]);
  assert.deepEqual(f.headers[0], { "X-Token": "t" });
});

test("a refusal, an empty list, or no answer in time means type the id, and the next ask tries again", async () => {
  const req = { url: "https://fail-test.example/models", headers: {} };
  const f = fakeFetch([() => ({ status: 401 }), () => ({ status: 200, body: { data: [] } }), () => ({ status: 200, body: { data: [{ id: "ok" }] } })]);
  assert.equal(await listModels(req, "openai-compatible", { fetchImpl: f.fetchImpl }), undefined);
  assert.equal(await listModels(req, "openai-compatible", { fetchImpl: f.fetchImpl }), undefined);
  assert.deepEqual(await listModels(req, "openai-compatible", { fetchImpl: f.fetchImpl }), ["ok"]);
  const hanging: ListFetch = (_url, init) => new Promise((_, reject) => init.signal.addEventListener("abort", () => reject(new Error("aborted"))));
  assert.equal(await listModels({ url: "https://slow-test.example/models", headers: {} }, "openai", { fetchImpl: hanging, timeoutMs: 20 }), undefined);
});
