import { strict as assert } from "node:assert";
import { existsSync, mkdtempSync, readFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join, resolve } from "node:path";
import { test } from "node:test";
import { ApprovalGate } from "../../src/gate/approvalGate";
import { toolRule } from "../../src/gate/gatedTool";
import { loadMcpTools, toMcpConnections } from "../../src/mcp/servers";

const serverScript = resolve(__dirname, "mcpShoutServer.mjs");

async function withShoutTool(approve: boolean, fn: (shout: any, callLog: string, asked: unknown[]) => Promise<void>) {
  const callLog = join(mkdtempSync(join(tmpdir(), "yourstack-mcp-")), "calls.txt");
  const asked: unknown[] = [];
  const gate = new ApprovalGate({ ask: async (_id, r) => (asked.push(r), approve) }, { rules: () => [] });
  const { tools, close } = await loadMcpTools({ shout: { command: process.execPath, args: [serverScript], env: { SHOUT_CALL_LOG: callLog } } }, gate);
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
  assert.throws(() => toMcpConnections({ broken: { cmd: "x" } }), /yourstack.mcpServers.broken to have a "command" or a "url"/);
  assert.throws(() => toMcpConnections([]), /Expected yourstack.mcpServers to be an object/);
  assert.deepEqual(toMcpConnections({}), {});
});
