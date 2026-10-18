import { strict as assert } from "node:assert";
import { test } from "node:test";
import { CLI_AGENTS, OPENCODE_ASK_CONFIG, resolveLaunch } from "../../src/acp/agents";
import { resolveCommand } from "../../src/acp/commands";
import { AgentCredentials, credentialEnv, DEEPSEEK_ANTHROPIC_URL } from "../../src/acp/credentials";
import { Redactor } from "../../src/log";

test("each agent has a fail-closed ask-mode strategy", () => {
  assert.deepEqual(CLI_AGENTS["claude-code"].askMode, { kind: "configOption", optionId: "mode", value: "default" });
  assert.deepEqual(CLI_AGENTS.codex.askMode, { kind: "configOption", optionId: "mode", value: "read-only" });
  assert.equal(CLI_AGENTS.codex.experimental, true);
  assert.deepEqual(JSON.parse(OPENCODE_ASK_CONFIG).permission, { edit: "ask", bash: "ask", webfetch: "ask", external_directory: "ask" });
});

test("an override replaces the command but never drops OpenCode's ask configuration", () => {
  const launch = resolveLaunch("opencode", { opencode: { command: "/opt/oc", args: ["acp"], env: { OPENCODE_CONFIG_CONTENT: "{}", X: "1" } } });
  assert.deepEqual(launch, { command: "/opt/oc", args: ["acp"], env: { X: "1", OPENCODE_CONFIG_CONTENT: OPENCODE_ASK_CONFIG } });
});

test("a malformed override is explained", () => {
  const out = resolveLaunch("claude-code", { "claude-code": { cmd: "x" } });
  assert.match((out as any).error, /yourstack.agentCommands.claude-code to be \{ "command": string/);
});

const installed = Boolean(resolveCommand("claude") && resolveCommand("opencode") && resolveCommand("npx"));

test("default launches resolve the installed claude and opencode CLIs", { skip: !installed && "claude, opencode, or npx not installed" }, () => {
  const claude = resolveLaunch("claude-code", undefined) as any;
  assert.ok(!claude.error, claude.error);
  assert.match(claude.args.join(" "), /^-y @agentclientprotocol\/claude-agent-acp@0\.93\.0$/);
  assert.ok(claude.env.CLAUDE_CODE_EXECUTABLE.endsWith("/claude"));
  const oc = resolveLaunch("opencode", undefined) as any;
  assert.ok(!oc.error, oc.error);
  assert.deepEqual(oc.args, ["acp"]);
});

test("a stored Claude Code credential reaches the launch env with an isolated config folder, over an override's env but never over ask-forcing", () => {
  const root = "/storage/agent-config";
  const env = credentialEnv("claude-code", { apiKey: "sk-agent-secret-1", baseUrl: DEEPSEEK_ANTHROPIC_URL }, root);
  const expected = { ANTHROPIC_API_KEY: "sk-agent-secret-1", ANTHROPIC_BASE_URL: "https://api.deepseek.com/anthropic", CLAUDE_CONFIG_DIR: "/storage/agent-config/claude-code" };
  assert.deepEqual(env, expected, "with a key, Claude Code never sees the user's login");
  const launch = resolveLaunch("claude-code", { "claude-code": { command: "/opt/a", env: { ANTHROPIC_API_KEY: "from-settings", CLAUDE_CONFIG_DIR: "/home/me/.claude", X: "1" } } }, env) as any;
  assert.deepEqual(launch.env, { ...expected, X: "1" }, "an override cannot point a keyed launch back at the user's config");
  const oc = resolveLaunch("opencode", { opencode: { command: "/opt/oc" } }, { OPENCODE_CONFIG_CONTENT: "{}" }) as any;
  assert.equal(oc.env.OPENCODE_CONFIG_CONTENT, OPENCODE_ASK_CONFIG, "nothing overrides ask-forcing");
  assert.deepEqual(credentialEnv("codex", { apiKey: "k-codex-123456" }, root), { CODEX_API_KEY: "k-codex-123456" });
  assert.deepEqual(credentialEnv("claude-code", undefined, root), {}, "no stored key: the agent keeps its own login and config");
  assert.deepEqual(credentialEnv("opencode", { apiKey: "unused-123456" }, root), {}, "OpenCode keeps keys in its own config");
});

test("agent credentials live in their own secrets, are redacted once read, and Clear removes key and endpoint", async () => {
  const map = new Map<string, string>();
  const secrets = { get: async (k: string) => map.get(k), store: async (k: string, v: string) => void map.set(k, v), delete: async (k: string) => void map.delete(k) };
  const redactor = new Redactor();
  const store = new AgentCredentials(secrets, redactor);
  await store.store("claude-code", { apiKey: " sk-agent-secret-2 ", baseUrl: DEEPSEEK_ANTHROPIC_URL });
  assert.deepEqual([...map.keys()].sort(), ["yourstack.agentBaseUrl.claude-code", "yourstack.agentKey.claude-code"]);
  assert.equal(redactor.scrub("x sk-agent-secret-2 y"), "x [redacted] y");
  await store.store("claude-code", { apiKey: "sk-agent-secret-3" });
  assert.deepEqual(await store.get("claude-code"), { apiKey: "sk-agent-secret-3" }, "a plain key drops the old endpoint");
  await assert.rejects(store.store("opencode", { apiKey: "k-123456789" }), /opencode does not take an API key/);
  await assert.rejects(store.store("claude-code", { apiKey: "k-123456789", baseUrl: "api.deepseek.com" }), /http\(s\) base URL/);
  map.set("yourstack.apiKey.anthropic", "provider-key-kept");
  await store.clearAll();
  assert.deepEqual([...map.keys()], ["yourstack.apiKey.anthropic"]);
  assert.equal(await store.get("claude-code"), undefined);
});
