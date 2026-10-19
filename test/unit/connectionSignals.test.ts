// What real runs report lands on the right connection at once: an agent asking for a login, its
// login status push, a Codex MCP server that didn't start, a provider refusing kernl's key, and the
// kernl agent's MCP servers; and a run that worked clears an earlier run's failure.
import { strict as assert } from "node:assert";
import { test } from "node:test";
import { httpStatusOf } from "../../src/agent/session";
import { ConnectionMonitor } from "../../src/connections/monitor";
import { applySignal, type SignalContext } from "../../src/connections/signals";

function setup() {
  const m = new ConnectionMonitor(() => 7);
  const rechecked: string[] = [];
  const ctx: SignalContext = { now: () => 7, provider: "anthropic", recheck: (id) => rechecked.push(id) };
  return { m, ctx, rechecked };
}

test("an agent asking for a login needs action at once, with Log in; a run that works clears it", () => {
  const { m, ctx } = setup();
  applySignal(m, { type: "authRequired", message: "Authentication required: Please run /login" }, "claude-code", ctx);
  const s = m.get("agent:claude-code")!;
  assert.deepEqual([s.state, s.source, s.fix?.action, s.fix?.target], ["needsAction", "last run", "login", "claude-code"]);
  assert.match(s.detail, /asked for a login when kernl ran it: Authentication required: Please run \/login/);
  applySignal(m, { type: "runSucceeded" }, "claude-code", ctx);
  assert.equal(m.get("agent:claude-code")!.state, "ready");
});

test("a login status push of 'none' needs action; any other kind is rechecked with the status commands (they can see an expired login)", () => {
  const { m, ctx, rechecked } = setup();
  applySignal(m, { type: "authStatus", kind: "none", label: "Not logged in" }, "codex", ctx);
  assert.equal(m.get("agent:codex")!.state, "needsAction");
  applySignal(m, { type: "authStatus", kind: "account", label: "Claude Max" }, "claude-code", ctx);
  assert.deepEqual(rechecked, ["claude-code"]);
  assert.equal(m.get("agent:claude-code"), undefined, "nothing marked ready from the push alone");
});

test("a Codex MCP server that didn't start is failed, under Codex, with the error", () => {
  const { m, ctx } = setup();
  applySignal(m, { type: "mcpStartupFailed", server: "docs", error: "MCP server `docs` failed to start: connection refused" }, "codex", ctx);
  const s = m.get("mcp:codex:docs")!;
  assert.deepEqual([s.kind, s.owner, s.label, s.state], ["mcp", "Codex", "docs", "failed"]);
  assert.match(s.detail, /connection refused/);
});

test("a provider refusing kernl's key marks that key; an answered run clears it", () => {
  const { m, ctx } = setup();
  applySignal(m, { type: "provider", rejected: 401 }, "deepagents", ctx);
  const s = m.get("key:anthropic")!;
  assert.deepEqual([s.kind, s.state, s.detail, s.fix?.action], ["providerKey", "needsAction", "anthropic refused the stored key (HTTP 401)", "setKey"]);
  applySignal(m, { type: "provider" }, "deepagents", ctx);
  assert.equal(m.get("key:anthropic")!.state, "ready");
});

test("the kernl agent's MCP servers replace the last set (a removed server disappears)", async () => {
  const { m, ctx } = setup();
  applySignal(m, { type: "kernlMcp", servers: [{ name: "docs", origin: "kernl.mcpServers", state: "ready", detail: "Connected · 3 tools" }, { name: "notion", origin: "Claude Code: ~/.claude.json", state: "needsAction", detail: "needs a sign-in" }] }, "deepagents", ctx);
  await new Promise((r) => setImmediate(r));
  assert.deepEqual(m.list().map((s) => [s.id, s.state]), [["mcp:kernl:docs", "ready"], ["mcp:kernl:notion", "needsAction"]]);
  applySignal(m, { type: "kernlMcp", servers: [{ name: "docs", origin: "kernl.mcpServers", state: "ready", detail: "Connected · 3 tools" }] }, "deepagents", ctx);
  await new Promise((r) => setImmediate(r));
  assert.deepEqual(m.list().map((s) => s.id), ["mcp:kernl:docs"]);
});

test("a provider's HTTP status is found on the error or its causes (LangChain wraps the SDKs' errors)", () => {
  assert.equal(httpStatusOf(Object.assign(new Error("401"), { status: 401 })), 401);
  assert.equal(httpStatusOf(Object.assign(new Error("wrapped"), { cause: Object.assign(new Error("inner"), { response: { status: 403 } }) })), 403);
  assert.equal(httpStatusOf(new Error("ECONNRESET")), undefined);
});
