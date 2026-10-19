import { strict as assert } from "node:assert";
import { existsSync, mkdtempSync, readFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join, resolve } from "node:path";
import { test } from "node:test";
import { ApprovalGate } from "../../src/gate/approvalGate";
import { toolRule } from "../../src/gate/gatedTool";
import { createServer } from "node:http";
import { loadMcpTools, mergeServers, type McpServer, needsSignIn, SignInRequired, settingServers } from "../../src/mcp/servers";

const serverScript = resolve(__dirname, "mcpShoutServer.mjs");

async function withShoutTool(approve: boolean, fn: (shout: any, callLog: string, asked: unknown[]) => Promise<void>) {
  const callLog = join(mkdtempSync(join(tmpdir(), "kernl-mcp-")), "calls.txt");
  const asked: unknown[] = [];
  const gate = new ApprovalGate({ ask: async (_id, r) => (asked.push(r), approve) }, { rules: () => [] });
  const servers = settingServers({ shout: { command: process.execPath, args: [serverScript], env: { SHOUT_CALL_LOG: callLog } } });
  const { tools, close } = await loadMcpTools(servers, gate, { timeoutMs: 30_000, allowProjectServer: async () => true });
  try {
    const shout = tools.find((t) => t.name.includes("shout"));
    assert.ok(shout, `tools loaded: ${tools.map((t) => t.name)}`);
    assert.equal(toolRule(shout), "ask");
    await fn(shout, callLog, asked);
  } finally {
    await close();
  }
}

test("a rejected MCP tool call asks first and never reaches the server", async () => {
  await withShoutTool(false, async (shout, callLog, asked) => {
    assert.equal(await shout.invoke({ text: "hi" }), "rejected by user");
    assert.equal(asked.length, 1);
    assert.equal(existsSync(callLog), false);
  });
});

test("an approved MCP tool call runs on the server and returns its result", async () => {
  await withShoutTool(true, async (shout, callLog) => {
    const out = await shout.invoke({ text: "hi" });
    assert.match(JSON.stringify(out), /HI/);
    assert.equal(readFileSync(callLog, "utf8"), "hi\n");
  });
});

test("a malformed server setting names the server", () => {
  assert.throws(() => settingServers({ broken: { cmd: "x" } }), /kernl.mcpServers.broken to have a "command" or a "url"/);
  assert.throws(() => settingServers([]), /Expected kernl.mcpServers to be an object/);
  assert.deepEqual(settingServers({}), []);
});

const shoutServer = (name: string, project: boolean): McpServer => ({ name, origin: project ? "Claude Code: project .mcp.json" : "kernl.mcpServers", project, connection: { command: process.execPath, args: [serverScript], env: {} } });
const askNever = new ApprovalGate({ ask: async () => false }, { rules: () => [] });

test("a server that can't start is reported with its reason, and the others still load", async () => {
  const broken: McpServer = { name: "broken", origin: "Codex: ~/.codex/config.toml", project: false, connection: { command: join(tmpdir(), "kernl-no-such-program"), args: [] } };
  const { tools, failures, close } = await loadMcpTools([broken, shoutServer("shout", false)], askNever, { timeoutMs: 30_000, allowProjectServer: async () => true });
  try {
    assert.ok(tools.some((t) => t.name.includes("shout")), `tools loaded: ${tools.map((t) => t.name)}`);
    assert.deepEqual(failures.map((f) => [f.server.name, f.server.origin, f.signIn]), [["broken", "Codex: ~/.codex/config.toml", false]]);
  } finally {
    await close();
  }
});

test("a server that never answers is given up on after the timeout", async () => {
  // A program that never speaks MCP (it ends by itself after 3 s, so the test leaves nothing running).
  const silent: McpServer = { name: "silent", origin: "kernl.mcpServers", project: false, connection: { command: process.execPath, args: ["-e", "setTimeout(() => {}, 3000)"] } };
  const started = Date.now();
  const { tools, failures, close } = await loadMcpTools([silent], askNever, { timeoutMs: 500, allowProjectServer: async () => true });
  await close();
  assert.deepEqual(tools, []);
  assert.match(failures[0]?.reason ?? "", /didn't answer within/);
  assert.ok(Date.now() - started < 2_000, `gave up after ${Date.now() - started} ms`);
});

test("a project server starts only when allowed; your own servers never ask", async () => {
  const asked: string[] = [];
  const { tools, failures, close } = await loadMcpTools([shoutServer("mine", false), shoutServer("theirs", true)], askNever, {
    timeoutMs: 30_000,
    allowProjectServer: async (s) => (asked.push(s.name), false),
  });
  await close();
  assert.deepEqual(asked, ["theirs"]);
  assert.ok(tools.every((t) => !t.name.includes("theirs")) && tools.some((t) => t.name.includes("mine")));
  assert.deepEqual(failures.map((f) => [f.server.name, f.reason]), [["theirs", "not allowed to start in this workspace"]]);
});

test("kernl.mcpServers wins over an imported server of the same name, and the clash is reported", () => {
  const { servers, skipped } = mergeServers(settingServers({ db: { url: "http://localhost:1/mcp" } }), [
    { name: "db", origin: "Claude Code: ~/.claude.json", project: false, connection: { command: "x", args: [] } },
    { name: "docs", origin: "Codex: ~/.codex/config.toml", project: false, connection: { url: "http://localhost:2/mcp", transport: "http" } },
  ]);
  assert.deepEqual(servers.map((s) => [s.name, s.origin]), [["db", "kernl.mcpServers"], ["docs", "Codex: ~/.codex/config.toml"]]);
  assert.deepEqual(skipped, [{ item: "MCP server db", origin: "Claude Code: ~/.claude.json", reason: "same name as the one from kernl.mcpServers" }]);
});

test("a remote server that wants a sign-in (HTTP 401) is marked as needing OAuth, not reported as broken", async () => {
  const http = createServer((_req, res) => res.writeHead(401, { "www-authenticate": 'Bearer resource_metadata="x"' }).end());
  await new Promise<void>((r) => http.listen(0, "127.0.0.1", () => r()));
  try {
    const url = `http://127.0.0.1:${(http.address() as any).port}/mcp`;
    const notion: McpServer = { name: "notion", origin: "Claude Code: ~/.claude.json", project: false, connection: { url, transport: "http" } };
    const { tools, failures, close } = await loadMcpTools([notion], askNever, { timeoutMs: 10_000, allowProjectServer: async () => true });
    await close();
    assert.deepEqual(tools, []);
    assert.deepEqual(failures.map((f) => [f.server.name, f.reason, f.signIn]), [["notion", "needs a sign-in (OAuth): use it in its own agent", true]]);
    const seen = new SignInRequired();
    seen.add(notion);
    assert.equal(seen.has({ ...notion, origin: "elsewhere" }), true, "the same name and URL");
    assert.equal(seen.has({ ...notion, connection: { url: `${url}/other`, transport: "http" } }), false);
  } finally {
    http.close();
  }
});

test("only a 401 or UnauthorizedError, on the error or a cause, counts as needing a sign-in", () => {
  assert.equal(needsSignIn(Object.assign(new Error("wrapped"), { cause: Object.assign(new Error("401"), { status: 401 }) })), true);
  assert.equal(needsSignIn(Object.assign(new Error("x"), { name: "UnauthorizedError" })), true);
  assert.equal(needsSignIn(Object.assign(new Error("forbidden"), { status: 403 })), false);
  assert.equal(needsSignIn(new Error("ECONNREFUSED")), false);
});
