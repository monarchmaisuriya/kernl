// Regression tests for the code-review findings: run start is claimed atomically, agent builds
// never orphan MCP resources, a reloaded panel gets the host's state back, and the browser only
// opens web URLs.
import { strict as assert } from "node:assert";
import { test } from "node:test";
import { AIMessage } from "@langchain/core/messages";
import { AgentLifecycle } from "../../src/agent/agentLifecycle";
import { buildAgent } from "../../src/agent/createAgent";
import { AgentSession } from "../../src/agent/session";
import { assertNavigableUrl } from "../../src/browser/urlPolicy";
import type { GateRequest } from "../../src/gate/approvalGate";
import { panelSnapshot } from "../../src/ui/approvalCards";
import { PanelChannel } from "../../src/ui/panelChannel";
import { ScriptedChatModel } from "../support/scriptedModel";
import { workspace } from "../support/harness";

const noEvents = { text() {}, toolCall() {}, toolResult() {}, usage() {}, finished() {} };

test("a second send while the agent is still starting is refused, and the agent is built once", async () => {
  const w = workspace(true);
  let builds = 0;
  let release!: () => void;
  const gate = new Promise<void>((r) => (release = r));
  const session = new AgentSession(async () => {
    builds++;
    await gate; // agent build in progress (e.g. MCP servers starting)
    return buildAgent({ model: new ScriptedChatModel([new AIMessage("ok")]), workspaceBackend: w.workspaceBackend, tools: [], loadProjectRules: false });
  }, noEvents);
  const first = session.send("one");
  assert.equal(session.running, true);
  await assert.rejects(() => session.send("two"), /already in progress/);
  release();
  await first;
  assert.equal(builds, 1);
  assert.equal(session.running, false);
});

function fakeBuild(log: string[]) {
  let n = 0;
  return async () => {
    const id = ++n;
    log.push(`build ${id}`);
    await new Promise((r) => setTimeout(r, 20));
    return { agent: { id } as any, close: async () => void log.push(`close ${id}`) };
  };
}

test("concurrent agent requests share one build; invalidate closes it; next request rebuilds", async () => {
  const log: string[] = [];
  const life = new AgentLifecycle(fakeBuild(log));
  const [a, b] = await Promise.all([life.get(), life.get()]);
  assert.equal(a, b);
  await life.invalidate();
  const c: any = await life.get();
  assert.equal(c.id, 2);
  assert.deepEqual(log, ["build 1", "close 1", "build 2"]);
});

test("a build that finishes after invalidate is closed, not kept", async () => {
  const log: string[] = [];
  const life = new AgentLifecycle(fakeBuild(log));
  const pending = life.get();
  await life.invalidate();
  await assert.rejects(pending, /Settings changed while the agent was starting/);
  assert.deepEqual(log, ["build 1", "close 1"]);
});

test("a failed build is not cached", async () => {
  let attempts = 0;
  const life = new AgentLifecycle(async () => {
    attempts++;
    if (attempts === 1) throw new Error("No API key stored for anthropic");
    return { agent: {} as any, close: async () => {} };
  });
  await assert.rejects(life.get(), /No API key/);
  await life.get();
  assert.equal(attempts, 2);
});

test("panel messages are dropped until the webview is ready, and a reload resets readiness", () => {
  const got: string[] = [];
  const channel = new PanelChannel<string>();
  assert.equal(channel.post("before attach"), false);
  channel.attach((m) => got.push(m));
  assert.equal(channel.post("before ready"), false);
  channel.markReady();
  assert.equal(channel.post("delivered"), true);
  channel.attach((m) => got.push(`reloaded:${m}`)); // panel closed and reopened
  assert.equal(channel.post("lost"), false);
  channel.markReady();
  channel.post("again");
  channel.detach();
  channel.markReady();
  assert.equal(channel.post("after dispose"), false);
  assert.deepEqual(got, ["delivered", "reloaded:again"]);
});

test("the snapshot sent to a reloaded panel carries every waiting card with its workspace", () => {
  const pending: Array<[string, GateRequest]> = [
    ["a", { kind: "execute", command: "npm test" }],
    ["b", { kind: "edit", path: "/app.ts", before: "x", after: "y" }],
  ];
  const snap: any = panelSnapshot(pending.map(([id, request]) => [id, { workspace: id === "a" ? { id: "main", label: "Main" } : { id: "wt:fix-login", label: "fix-login" }, request }]));
  assert.equal(snap.type, "snapshot");
  assert.deepEqual(snap.cards.map((c: any) => [c.id, c.workspaceId, c.workspace, c.detail, c.hasDiff]), [["a", "main", "Main", "npm test", false], ["b", "wt:fix-login", "fix-login", "/app.ts", true]]);
});

test("the browser opens only http(s) and about: URLs", () => {
  for (const ok of ["http://localhost:3000/", "https://example.com/a?b", "about:blank"]) assertNavigableUrl(ok);
  for (const bad of ["file:///Users/me/.env", "javascript:alert(1)", "chrome://settings", "localhost:3000", "data:text/html,hi"]) {
    assert.throws(() => assertNavigableUrl(bad), /http\(s\)/, bad);
  }
});
