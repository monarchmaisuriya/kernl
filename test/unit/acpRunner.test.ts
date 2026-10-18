import { strict as assert } from "node:assert";
import { existsSync, mkdtempSync, readFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join, resolve } from "node:path";
import { test } from "node:test";
import type { AskMode } from "../../src/acp/agents";
import { AcpRunner } from "../../src/acp/acpRunner";
import { toPermissionResponse } from "../../src/acp/permission";
import { ApprovalGate, type GateRequest } from "../../src/gate/approvalGate";
import { PendingApprovals } from "../../src/gate/pendingApprovals";

const fake = resolve(__dirname, "fakeAcpAgent.cjs");
const MANUAL: AskMode = { kind: "configOption", optionId: "mode", value: "default" };

function harness(scenario: string, answer: boolean | "never", askMode: AskMode | (() => AskMode) = MANUAL, extraEnv: Record<string, string> = {}) {
  const cwd = mkdtempSync(join(tmpdir(), "yourstack-acp-"));
  const logFile = join(cwd, "..", `fake-${Math.random().toString(36).slice(2)}.log`);
  const asked: GateRequest[] = [];
  const events: string[] = [];
  const pending = new PendingApprovals(() => {}, () => {});
  const gate = new ApprovalGate(
    { ask: (id, r) => (asked.push(r), answer === "never" ? pending.ask(id, r) : Promise.resolve(answer)) },
    { rules: () => [] },
  );
  const runner = new AcpRunner({
    agentLabel: "Fake Agent",
    launch: { command: process.execPath, args: [fake], env: { FAKE_SCENARIO: scenario, FAKE_LOG: logFile, ...extraEnv } },
    mode: typeof askMode === "function" ? askMode : () => askMode,
    cwd,
    gate,
    onStop: () => pending.denyAll(),
    notice: (t) => events.push(`notice:${t}`),
    events: {
      text: (d) => events.push(`text:${d}`),
      toolCall: (_id, name) => events.push(`call:${name}`),
      toolResult: (_id, _n, out) => events.push(`result:${out}`),
      usage: () => {},
      finished: (reason, msg) => events.push(`finished:${reason}${msg ? `:${msg}` : ""}`),
    },
  });
  const fakeLog = () => (existsSync(logFile) ? readFileSync(logFile, "utf8").trim().split("\n") : []);
  return { cwd, asked, events, runner, fakeLog };
}

test("streams the agent's text and tool activity; an approved write happens with allow_once only", async () => {
  const h = harness("write", true);
  await h.runner.send("write it");
  h.runner.dispose();
  assert.ok(h.events.includes("text:hello from fake"), h.events.join(" | "));
  assert.ok(h.events.includes("call:Write hello.txt"));
  assert.ok(h.events.includes("result:wrote hello.txt"));
  assert.equal(h.events.at(-1), "finished:done");
  assert.equal(readFileSync(join(h.cwd, "hello.txt"), "utf8"), "hi\n");
  assert.ok(h.fakeLog().includes("permission selected:yes"), h.fakeLog().join(" | "));
  const card = h.asked[0] as Extract<GateRequest, { kind: "agent" }>;
  assert.equal(card.agent, "Fake Agent");
  assert.equal(card.diff?.after, "hi\n");
});

test("a rejected write is never performed", async () => {
  const h = harness("write", false);
  await h.runner.send("write it");
  h.runner.dispose();
  assert.equal(existsSync(join(h.cwd, "hello.txt")), false);
  assert.ok(h.fakeLog().includes("permission selected:no"));
  assert.equal(h.events.at(-1), "finished:done");
});

test("an agent that ends its turn as cancelled after a rejection is reported done, not stopped", async () => {
  const h = harness("cancel-on-reject", false);
  await h.runner.send("write it");
  h.runner.dispose();
  assert.equal(existsSync(join(h.cwd, "hello.txt")), false);
  assert.equal(h.events.at(-1), "finished:done");
});

test("the session is forced into ask mode before the prompt", async () => {
  const h = harness("write", false);
  await h.runner.send("x");
  h.runner.dispose();
  const log = h.fakeLog();
  assert.ok(log.indexOf("setConfig mode=default") >= 0 && log.indexOf("setConfig mode=default") < log.indexOf("prompt"), log.join(" | "));
});

test("if ask mode cannot be confirmed, the agent refuses and no prompt is sent", async () => {
  const h = harness("stuck-mode", true);
  const started = Date.now();
  await h.runner.send("write it");
  assert.ok(Date.now() - started < 500, `refusal took ${Date.now() - started} ms; a live agent must not wait for an exit`);
  h.runner.dispose();
  assert.match(h.events.at(-1)!, /finished:error:.*refusing to run: could not confirm its permission mode \(mode is 'auto', expected 'default'\)/);
  assert.ok(!h.fakeLog().includes("prompt"), h.fakeLog().join(" | "));
});

test("session-mode agents (Codex style) are confirmed through a mode update", async () => {
  const ok = harness("session-mode", false, { kind: "sessionMode", modeId: "read-only" });
  await ok.runner.send("x");
  ok.runner.dispose();
  assert.ok(ok.fakeLog().includes("setMode read-only") && ok.fakeLog().includes("prompt"), ok.fakeLog().join(" | "));
  const missing = harness("session-mode", false, { kind: "sessionMode", modeId: "ask-everything" });
  await missing.runner.send("x");
  missing.runner.dispose();
  assert.match(missing.events.at(-1)!, /mode 'ask-everything' not offered; available: auto, read-only/);
  assert.ok(!missing.fakeLog().includes("prompt"));
});

test("Stop while a card is open cancels: no write, run reported stopped within 3 seconds", async () => {
  const h = harness("write", "never");
  const run = h.runner.send("write it");
  for (let i = 0; i < 50 && h.asked.length === 0; i++) await new Promise((r) => setTimeout(r, 50));
  const stoppedAt = Date.now();
  h.runner.stop();
  await run;
  h.runner.dispose();
  assert.ok(Date.now() - stoppedAt < 3000, `took ${Date.now() - stoppedAt} ms`);
  assert.equal(h.events.at(-1), "finished:stopped");
  assert.equal(existsSync(join(h.cwd, "hello.txt")), false);
  assert.ok(h.fakeLog().some((l) => l.startsWith("permission cancelled")), h.fakeLog().join(" | "));
});

test("an agent that crashes mid-run ends the run with an error naming it and its last stderr line", async () => {
  const h = harness("crash", true);
  await h.runner.send("x");
  h.runner.dispose();
  assert.match(h.events.at(-1)!, /finished:error:Fake Agent stopped \(exit code 3\): fake agent: boom/);
  assert.equal(h.runner.running, false);
});

test("a missing command is reported, not thrown", async () => {
  const h = harness("write", true);
  (h.runner as any).o.launch = { command: "/nonexistent/agent-binary", args: [], env: {} };
  await h.runner.send("x");
  assert.match(h.events.at(-1)!, /finished:error:Fake Agent stopped \(could not start '\/nonexistent\/agent-binary'/);
});

test("approval never widens to allow_always, and a missing one-time allow rejects", () => {
  const opts: any[] = [{ optionId: "a", kind: "allow_always" }, { optionId: "r", kind: "reject_once" }];
  assert.deepEqual(toPermissionResponse(opts, true, false), { outcome: { outcome: "selected", optionId: "r" } });
  assert.deepEqual(toPermissionResponse(opts, false, true), { outcome: { outcome: "cancelled" } });
});

test("New chat closes the agent's previous session before the next one starts", async () => {
  const h = harness("write", false);
  await h.runner.send("first");
  h.runner.newThread();
  await h.runner.send("second");
  h.runner.dispose();
  const log = h.fakeLog();
  const closeAt = log.indexOf("closeSession s1");
  assert.ok(closeAt >= 0, log.join(" | "));
  assert.ok(log.filter((l) => l.startsWith("newSession")).length === 2 && log.findIndex((l, i) => i > closeAt && l.startsWith("newSession")) > closeAt, log.join(" | "));
});

test("a stored CLI conversation is reloaded with session/load; the agent's replay isn't shown again; ask mode is forced again", async () => {
  const h = harness("write", false, MANUAL, { FAKE_LOAD: "1" });
  h.runner.newThread({ sessionId: "stored-session-7" });
  await h.runner.send("continue");
  assert.ok(h.fakeLog().includes("loadSession stored-session-7"));
  assert.ok(!h.fakeLog().some((l) => l.startsWith("newSession")), "no new session when the old one loads");
  assert.ok(h.fakeLog().includes("setConfig mode=default"), "ask mode is confirmed for the loaded session too");
  assert.ok(!h.events.some((e) => e.includes("REPLAYED-OLD-MESSAGE")), "the replay is dropped");
  assert.deepEqual(await h.runner.exportHistory(), { sessionId: "stored-session-7" });
  h.runner.dispose();
});

test("an agent that can't reload sessions starts a new one and says so", async () => {
  const h = harness("write", false);
  h.runner.newThread({ sessionId: "stored-session-8" });
  await h.runner.send("continue");
  assert.ok(h.fakeLog().some((l) => l.startsWith("newSession")));
  assert.ok(h.events.some((e) => /can't reload earlier conversations/.test(e)));
  h.runner.dispose();
});

test("an agent with session/fork forks the whole session; the runner continues in the copy, with ask mode forced again", async () => {
  const h = harness("write", false, MANUAL, { FAKE_FORK: "1" });
  await h.runner.send("first");
  const before = await h.runner.exportHistory();
  const forked = await h.runner.forkSession();
  assert.deepEqual(forked, { sessionId: `${(before as any).sessionId}-fork` });
  assert.ok(h.fakeLog().includes(`forkSession ${(before as any).sessionId}`));
  assert.equal(h.fakeLog().filter((l) => l === "setConfig mode=default").length, 2, "ask mode confirmed for the fork too");
  assert.deepEqual(await h.runner.exportHistory(), forked);
  h.runner.dispose();
});

test("an agent without session/fork can't fork", async () => {
  const h = harness("write", false);
  await h.runner.send("first");
  assert.equal(await h.runner.forkSession(), undefined);
  h.runner.dispose();
});

test("a permission mode change is applied to the live session and confirmed; an agent that doesn't confirm it is refused", async () => {
  let mode: AskMode = MANUAL;
  const h = harness("write", false, () => mode);
  await h.runner.send("first");
  mode = { kind: "configOption", optionId: "mode", value: "acceptEdits" };
  await h.runner.applyMode();
  assert.ok(h.fakeLog().includes("setConfig mode=acceptEdits"), h.fakeLog().join(" | "));
  h.runner.dispose();
  const stuck = harness("stuck-mode", false, () => MANUAL);
  await stuck.runner.applyMode(); // no session yet: applied when one starts
  stuck.runner.dispose();
});

test("an agent whose reply lags one mode behind (OpenCode leaving plan) is confirmed by setting the mode again", async () => {
  let mode: AskMode = { kind: "configOption", optionId: "mode", value: "plan" };
  const h = harness("lagging-mode", false, () => mode);
  await h.runner.send("first");
  mode = { kind: "configOption", optionId: "mode", value: "build" };
  await h.runner.applyMode();
  assert.deepEqual(h.fakeLog().filter((l) => l.startsWith("setConfig")), ["setConfig mode=plan", "setConfig mode=plan", "setConfig mode=build", "setConfig mode=build"]);
  h.runner.dispose();
});
