// Stored keys are checked with the provider's model list (no tokens, key in a header, never in the
// URL): only 401/403 means refused, anything else is "can't tell". The agents' MCP servers and Claude
// Code's plugins come from their own list commands, run with the agent's binary and launch env.
import { strict as assert } from "node:assert";
import { mkdtempSync } from "node:fs";
import { createServer } from "node:http";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { test } from "node:test";
import type { CliAgentId, Launch } from "../../src/acp/agents";
import type { AgentCheckDeps } from "../../src/connections/agentChecks";
import { checkKey, keyRequest } from "../../src/connections/keyCheck";
import { checkAgentMcp, checkClaudePlugins } from "../../src/connections/listChecks";
import type { CommandResult, StatusCommand } from "../../src/connections/statusCommands";

test("each provider's models-list request carries the key in a header, never in the URL", () => {
  const key = "sk-test-key";
  for (const [provider, base] of [["anthropic", undefined], ["openai", undefined], ["google", undefined], ["deepseek", undefined], ["custom:groq", "https://api.groq.example/openai/v1/"]] as const) {
    const req = keyRequest(provider, key, base)!;
    assert.ok(req, provider);
    assert.doesNotMatch(req.url, /sk-test-key/, `${provider}: not in the URL`);
    assert.ok(Object.values(req.headers).some((v) => v.includes(key)), `${provider}: in a header`);
  }
  assert.equal(keyRequest("custom:groq", key, "https://api.groq.example/openai/v1/")!.url, "https://api.groq.example/openai/v1/models");
  assert.equal(keyRequest("anthropic", key, "https://api.deepseek.com/anthropic")!.url, "https://api.deepseek.com/anthropic/v1/models");
  assert.equal(keyRequest("openai-compatible", key), undefined, "no URL, nothing to ask");
});

test("a custom provider's models-list request carries its headers, with or without a key, and never a removed (null) header", () => {
  const headers = { "X-Team": "kernl", "X-Token": "tok", "x-api-key": null };
  assert.deepEqual(keyRequest("openai-compatible", undefined, "https://gw.example/v1", headers), { url: "https://gw.example/v1/models", headers: { "X-Team": "kernl", "X-Token": "tok" } });
  assert.deepEqual(keyRequest("openai-compatible", "sk-k", "https://gw.example/v1", headers)!.headers, { Authorization: "Bearer sk-k", "X-Team": "kernl", "X-Token": "tok" });
  assert.deepEqual(keyRequest("anthropic", undefined, "https://gw.example/anthropic", headers), {
    url: "https://gw.example/anthropic/v1/models",
    headers: { "anthropic-version": "2023-06-01", "X-Team": "kernl", "X-Token": "tok" },
  });
});

test("200 is accepted, 401/403 refused, 404 or no answer can't tell", async () => {
  const seen: { path?: string; auth?: string }[] = [];
  const server = createServer((req, res) => {
    seen.push({ path: req.url, auth: req.headers.authorization });
    const status = req.url!.startsWith("/ok") ? 200 : req.url!.startsWith("/bad") ? 401 : req.url!.startsWith("/forbidden") ? 403 : req.url!.startsWith("/slow") ? 0 : 404;
    if (status) res.writeHead(status).end("{}");
  });
  await new Promise<void>((r) => server.listen(0, "127.0.0.1", () => r()));
  const base = `http://127.0.0.1:${(server.address() as any).port}`;
  try {
    const ask = (path: string, timeout = 2_000) => checkKey({ url: `${base}${path}/models`, headers: { Authorization: "Bearer k" } }, "groq", undefined, timeout);
    assert.deepEqual(await ask("/ok"), { state: "ready", detail: "groq accepted the key" });
    assert.deepEqual(await ask("/bad"), { state: "needsAction", detail: "groq refused the key (HTTP 401)" });
    assert.equal((await ask("/forbidden")).state, "needsAction");
    assert.deepEqual(await ask("/none"), { state: "unknown", detail: "Couldn't check the key: groq answered HTTP 404" });
    assert.deepEqual(await ask("/slow", 300), { state: "unknown", detail: "Couldn't check the key: groq didn't answer in time" });
    assert.equal(seen[0].auth, "Bearer k");
    assert.equal(seen[0].path, "/ok/models", "a GET of the model list, nothing else");
  } finally {
    server.closeAllConnections();
    server.close();
  }
  assert.equal((await checkKey({ url: "http://127.0.0.1:1/models", headers: {} }, "local")).state, "unknown", "a network error can't tell");
});

const launches: Record<CliAgentId, Launch> = {
  "claude-code": { command: "/usr/bin/npx", args: [], env: { PATH: "/opt/node/bin", CLAUDE_CODE_EXECUTABLE: "/opt/claude" } },
  codex: { command: "/usr/bin/npx", args: [], env: {} },
  opencode: { command: "/opt/opencode", args: ["acp"], env: {} },
};
function deps(outputs: Partial<Record<StatusCommand, string>>, ran: string[] = []): AgentCheckDeps {
  return {
    launch: async (id) => launches[id],
    hasStoredKey: async () => false,
    launchOverride: () => undefined,
    find: (c) => `/usr/local/bin/${c}`,
    run: async (name, t): Promise<CommandResult> => (ran.push(`${t.path} ${name} cwd=${t.cwd}`), { output: outputs[name] ?? "", exitCode: 0, timedOut: false }),
    cwd: "/work",
    now: () => 9,
  };
}

test("an agent's MCP servers become rows under the agent; Claude Code's that need a sign-in say how", async () => {
  const ran: string[] = [];
  const rows = await checkAgentMcp("claude-code", deps({ claudeMcpList: "Checking MCP server health…\n\nnotion: https://x (HTTP) - ! Needs authentication\nrender: https://y (HTTP) - ✔ Connected\n" }, ran));
  assert.deepEqual(rows.map((r) => [r.id, r.owner, r.state, r.fix?.label]), [
    ["mcp:claude-code:notion", "Claude Code", "needsAction", "How to sign in"],
    ["mcp:claude-code:render", "Claude Code", "ready", undefined],
  ]);
  assert.deepEqual(ran, ["/opt/claude claudeMcpList cwd=/work"], "the launch's binary, in the workspace folder (project servers count)");
  const codex = await checkAgentMcp("codex", deps({ codexMcpList: JSON.stringify([{ name: "docs", enabled: true }]) }));
  assert.deepEqual(codex.map((r) => [r.id, r.state]), [["mcp:codex:docs", "unknown"]]);
  const unreadable = await checkAgentMcp("opencode", deps({ opencodeMcpList: "Error: something new" }));
  assert.deepEqual(unreadable.map((r) => [r.id, r.state]), [["mcp:opencode", "unknown"]]);
});

test("Claude Code's plugins: enabled, turned off, or enabled with its folder missing", async () => {
  const present = mkdtempSync(join(tmpdir(), "kernl-plugin-"));
  const list = JSON.stringify([
    { id: "render@market", version: "0.3.0", enabled: true, installPath: present },
    { id: "gone@market", version: "1.0.0", enabled: true, installPath: join(present, "missing") },
    { id: "off@market", version: "1.0.0", enabled: false, installPath: join(present, "missing") },
  ]);
  const rows = await checkClaudePlugins(deps({ claudePluginList: list }));
  assert.deepEqual(rows.map((r) => [r.id, r.label, r.state]), [
    ["plugin:claude-code:render@market", "render", "ready"],
    ["plugin:claude-code:gone@market", "gone", "failed"],
    ["plugin:claude-code:off@market", "off", "off"],
  ]);
  assert.match(rows[1].detail, /folder is missing/);
});
