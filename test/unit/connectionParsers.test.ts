// The CLIs' status outputs, as recorded on 2026-10-19 from Claude Code 2.1.303, Codex 0.163.0, and
// OpenCode 2.0.32 (emails, organizations, URLs, and home paths replaced), read as connection states.
// Two inputs weren't observable here and come from the binaries' own strings: Claude Code logged in,
// and OpenCode with MCP servers. Anything unreadable must be "unknown", never "needsAction".
import { strict as assert } from "node:assert";
import { test } from "node:test";
import { parseClaudeAuth, parseClaudeMcpList, parseClaudePlugins, parseCodexLogin, parseCodexMcpList, parseOpencodeAuth, parseOpencodeMcpList } from "../../src/connections/parsers";
import type { CommandResult } from "../../src/connections/statusCommands";

const out = (output: string, exitCode: number | null = 0, timedOut = false): CommandResult => ({ output, exitCode, timedOut });

const CLAUDE_LOGGED_OUT_JSON = `{
  "loggedIn": false,
  "authMethod": "none",
  "apiProvider": "firstParty",
  "analyticsDisabled": false,
  "projectsDirectory": "/home/me/.claude/projects",
  "configDirectory": "/home/me/.claude"
}`;
const CLAUDE_EXPIRED_TEXT = `Login: Expired — log in again
Organization: Example Org
Email: me@example.com
Not logged in. Run claude auth login to authenticate.`;
// From the binary's fields (auth status, authMethod "claude.ai"): not observable while logged out.
const CLAUDE_LOGGED_IN_JSON = JSON.stringify({ loggedIn: true, authMethod: "claude.ai", apiProvider: "firstParty", email: "me@example.com", orgId: "x", orgName: "Example Org", subscriptionType: "max" });

test("Claude Code: logged out, expired, logged in with a plan or an API key, and an expired login the JSON still calls logged in", () => {
  assert.deepEqual(parseClaudeAuth(out(CLAUDE_LOGGED_OUT_JSON, 1), out(CLAUDE_EXPIRED_TEXT, 1)), { state: "needsAction", detail: "Claude Code's login has expired: log in again" });
  assert.deepEqual(parseClaudeAuth(out(CLAUDE_LOGGED_OUT_JSON, 1), out("Not logged in. Run claude auth login to authenticate.", 1)), { state: "needsAction", detail: "Claude Code isn't logged in" });
  assert.deepEqual(parseClaudeAuth(out(CLAUDE_LOGGED_IN_JSON), out("Login: claude.ai")), { state: "ready", detail: "Logged in: claude.ai login (max)" });
  assert.deepEqual(parseClaudeAuth(out(JSON.stringify({ loggedIn: true, authMethod: "api_key" })), out("")), { state: "ready", detail: "Logged in: API key" });
  assert.equal(parseClaudeAuth(out(CLAUDE_LOGGED_IN_JSON), out(CLAUDE_EXPIRED_TEXT, 1)).state, "needsAction", "--text's Expired wins over --json's loggedIn");
});

test("output a parser can't read is unknown, never needsAction", () => {
  assert.equal(parseClaudeAuth(out("Error: something new"), out("")).state, "unknown");
  assert.equal(parseClaudeAuth(out("", null, true), out("", null, true)).state, "unknown");
  assert.match(parseClaudeAuth(out("", null, true), out("")).detail, /didn't answer in time/);
  assert.equal(parseCodexLogin(out("Error loading configuration: CODEX_HOME points to /x but that path does not exist", 1)).state, "unknown");
  assert.equal(parseOpencodeAuth(out("not json")).state, "unknown");
  assert.equal((parseClaudeMcpList(out("some other output")) as any).state, "unknown");
  assert.equal((parseClaudePlugins(out("[oops")) as any).state, "unknown");
});

test("Codex: logged in, not logged in", () => {
  assert.deepEqual(parseCodexLogin(out("Logged in using ChatGPT\n")), { state: "ready", detail: "Logged in using ChatGPT" });
  assert.deepEqual(parseCodexLogin(out("Logged in using an API key - sk-***\n")), { state: "ready", detail: "Logged in using an API key - sk-***" });
  assert.deepEqual(parseCodexLogin(out("Not logged in\n", 1)), { state: "needsAction", detail: "Codex isn't logged in" });
});

test("OpenCode: no logins is still usable (its own models and configured providers)", () => {
  assert.equal(parseOpencodeAuth(out("[]\n")).state, "ready");
  assert.match(parseOpencodeAuth(out("[]\n")).detail, /No logins/);
  assert.equal(parseOpencodeAuth(out(JSON.stringify([{ id: "anthropic", label: "Anthropic" }]))).detail, "Logged in to Anthropic");
});

// Recorded (URLs replaced).
const CLAUDE_MCP_LIST = `Checking MCP server health…

plugin:render:render: https://mcp.example.com/render (HTTP) - ✔ Connected
plugin:postman:postman: https://mcp.example.com/postman (HTTP) - ! Needs authentication
notion: https://mcp.example.com/notion (HTTP) - ! Needs authentication
slack: https://mcp.example.com/slack (HTTP) - ✘ Failed to connect — Incompatible auth server: does not support dynamic client registration
datadog: https://mcp.example.com/datadog (HTTP) - ! Needs authentication
pushowl-support: https://mcp.example.com/support (HTTP) - ✔ Connected
rea: npx -y rea-agents@6.7.0 mcp - ✘ Failed to connect — ENOENT: Executable not found in $PATH: "npx"
`;

test("Claude Code MCP servers (claude.ai connectors among them): connected, needs authentication, failed with the issue", () => {
  const items = parseClaudeMcpList(out(CLAUDE_MCP_LIST)) as any[];
  assert.deepEqual(items.map((i) => [i.name, i.state]), [
    ["plugin:render:render", "ready"],
    ["plugin:postman:postman", "needsAction"],
    ["notion", "needsAction"],
    ["slack", "failed"],
    ["datadog", "needsAction"],
    ["pushowl-support", "ready"],
    ["rea", "failed"],
  ]);
  assert.equal(items[3].detail, "Failed to connect: Incompatible auth server: does not support dynamic client registration");
  assert.equal(items[1].detail, "Needs authentication");
  assert.deepEqual(parseClaudeMcpList(out("No MCP servers configured. Use `claude mcp add` to add a server.\n")), []);
  const other = parseClaudeMcpList(out("Checking MCP server health…\n\nx: cmd - ⊘ Disabled for this project (re-enable via /mcp)\ny: cmd - ⏸ Pending approval (run `claude` to approve)\n")) as any[];
  assert.deepEqual(other.map((i) => i.state), ["off", "needsAction"]);
});

test("Codex MCP servers are configured-only (no health check); turned-off ones are off", () => {
  assert.deepEqual(parseCodexMcpList(out("[]\n")), []);
  const items = parseCodexMcpList(out(JSON.stringify([{ name: "docs", enabled: true, auth_status: "unsupported" }, { name: "old", enabled: false, disabled_reason: "manual" }]))) as any[];
  assert.deepEqual(items.map((i) => [i.name, i.state]), [["docs", "unknown"], ["old", "off"]]);
});

test("OpenCode MCP servers (lines from the binary's strings; none configured to record)", () => {
  assert.deepEqual(parseOpencodeMcpList(out("No MCP servers configured\n")), []);
  const items = parseOpencodeMcpList(out("✓ files connected\n⚠ web needs authentication\n✗ db failed: connection refused\n○ slow pending\n")) as any[];
  assert.deepEqual(items.map((i) => [i.name, i.state, i.detail]), [
    ["files", "ready", "connected"],
    ["web", "needsAction", "needs authentication"],
    ["db", "failed", "failed: connection refused"],
    ["slow", "unknown", "pending"],
  ]);
});

test("Claude Code plugins: enabled or turned off, with version and MCP servers", () => {
  const recorded = JSON.stringify([
    { id: "postman@claude-plugins-official", version: "2.0.1", scope: "user", enabled: true, installPath: "/home/me/.claude/plugins/cache/x/postman/2.0.1", mcpServers: { postman: { type: "http", url: "https://mcp.example.com/postman" } }, projectEnabled: false },
    { id: "render@claude-plugins-official", version: "0.3.0", scope: "user", enabled: false, installPath: "/home/me/.claude/plugins/cache/x/render/0.3.0" },
  ]);
  const items = parseClaudePlugins(out(recorded)) as any[];
  assert.deepEqual(items.map((i) => [i.name, i.state, i.detail]), [
    ["postman@claude-plugins-official", "ready", "Enabled · version 2.0.1 · MCP: postman"],
    ["render@claude-plugins-official", "off", "Installed, turned off · version 0.3.0"],
  ]);
  assert.equal(items[0].installPath, "/home/me/.claude/plugins/cache/x/postman/2.0.1");
});
