import { strict as assert } from "node:assert";
import { existsSync, mkdtempSync, readFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join, resolve } from "node:path";
import { test } from "node:test";
import type { AskMode } from "../../src/acp/agents";
import { AcpRunner, type AcpRunnerOptions, type CommandOutputEvent, isKernlTool } from "../../src/acp/acpRunner";
import { KernlToolServer } from "../../src/mcp/kernlServer";
import { tool } from "@langchain/core/tools";
import { z } from "zod";
import { toPermissionResponse } from "../../src/acp/permission";
import { ApprovalGate, type GateRequest } from "../../src/gate/approvalGate";
import { PendingApprovals } from "../../src/gate/pendingApprovals";

const fake = resolve(__dirname, "fakeAcpAgent.cjs");
const MANUAL: AskMode = { kind: "configOption", optionId: "mode", value: "default" };

function harness(scenario: string, answer: boolean | "never", askMode: AskMode | (() => AskMode) = MANUAL, extraEnv: Record<string, string> = {}, more: Pick<AcpRunnerOptions, "sessionSetup" | "commandOutput" | "connection" | "loginHint"> = {}) {
  const cwd = mkdtempSync(join(tmpdir(), "kernl-acp-"));
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
    ...more,
    events: {
      text: (d) => events.push(`text:${d}`),
      toolCall: (id, name, _args, info) => (info?.command && events.push(`command:${info.description ?? "-"}|${info.command}|${info.lookup ?? "-"}`), events.push(info?.status ? `call:${name}:${info.status}${info.kind ? `:${info.kind}` : ""}${info.diff ? `:+${info.diff.added}-${info.diff.removed}` : ""}${info.locations?.length ? `:@${info.locations[0].line}` : ""}` : `call:${name}`)),
      toolDiff: (id, d) => events.push(`diff:${id}:${d.before === null ? "new" : "changed"}`),
      thinking: (d) => events.push(`thinking:${d}`),
      plan: (entries) => events.push(`plan:${entries.map((e) => `${e.status}=${e.content}`).join("|")}`),
      context: (c) => events.push(`context:${c.used}/${c.size}:${c.cost?.amount}`),
      commands: (items) => events.push(`commands:${items.map((c) => c.name).join(",")}`),
      title: (t) => events.push(`title:${t}`),
      configChanged: (v) => events.push(`config:mode=${v.mode}`),
      toolResult: (_id, _n, out) => events.push(`result:${out}`),
      toolImage: (id, image) => events.push(`image:${id}:${image.mimeType}:${image.data.length}`),
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
  assert.ok(h.events.includes("call:Write hello.txt:pending:edit"), JSON.stringify(h.events));
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

test("a full agent's updates all reach the panel: thinking, one tool call merged through its states, an edit's size, plan, usage, commands, title, and its own mode change", async () => {
  const h = harness("rich", false);
  await h.runner.send("explain the hook");
  h.runner.dispose();
  const e = h.events;
  assert.deepEqual(e.filter((x) => x.startsWith("thinking:")), ["thinking:Look at the hook ", "thinking:before answering."]);
  assert.deepEqual(e.filter((x) => x.startsWith("call:Read src")), ["call:Read src/a.ts:pending:read:@3", "call:Read src/a.ts:running:read:@3", "call:Read src/a.ts"], JSON.stringify(e));
  assert.ok(e.includes("result:export const a = 1;"), "its output ends it, without the agent's code fence");
  assert.ok(e.includes("result:src/a.ts:3"), "a command's output loses its console fence");
  assert.ok(!e.some((x) => x.startsWith("call:tool")), `an update after the result keeps the call's title, not a blank one: ${JSON.stringify(e)}`);
  assert.equal(e.filter((x) => x === "result:src/a.ts:3").length, 1, "and its result isn't reported again");
  assert.ok(e.includes("image:i1:image/png:96"), `a read image is passed on, base64 with its type: ${JSON.stringify(e)}`);
  assert.ok(e.includes("command:Find usages of useRewards|grep -n useRewards src|search"), `a command leads with its description, without the cd into the session folder: ${JSON.stringify(e)}`);
  assert.ok(e.includes("call:Edit src/a.ts:running:edit") && e.includes("call:Edit src/a.ts"), JSON.stringify(e));
  assert.ok(e.includes("diff:e1:changed"));
  assert.ok(e.includes("plan:completed=Read the hook|in_progress=Explain it"));
  assert.ok(e.includes("context:150000/200000:0.42"));
  assert.ok(e.includes("commands:review"));
  assert.ok(e.includes("title:Explain the rewards hook"));
  assert.ok(e.includes("config:mode=plan"));
  assert.equal(e.at(-1), "finished:done");
});

test("a command drops only a leading cd into the session's own folder, and keeps the agent's description", async () => {
  const { describeCommand } = await import("../../src/acp/acpRunner");
  assert.deepEqual(describeCommand({ command: "cd /ws && grep -n x src", description: "Find x" }, "/ws"), { command: "grep -n x src", description: "Find x", lookup: "search" });
  assert.deepEqual(describeCommand({ command: 'cd "/ws/" ; npm test' }, "/ws"), { command: "npm test" }, "quoted, trailing slash, and ;");
  assert.deepEqual(describeCommand({ command: "cd /ws/sub && npm test" }, "/ws"), { command: "cd /ws/sub && npm test" }, "a cd into a subfolder changes where it runs, so it stays");
  assert.deepEqual(describeCommand({ command: "npm test", command_description: "Run the tests" }, "/ws"), { command: "npm test", description: "Run the tests" }, "newer Claude Code spells it command_description");
  assert.deepEqual(describeCommand({ command: "cd /ws" }, "/ws"), { command: "cd /ws" }, "a bare cd is the whole command");
  assert.deepEqual(describeCommand(undefined, "/ws"), {});
  assert.deepEqual(describeCommand({ command: "cat /ws/src/a.ts" }, "/ws"), { command: "cat /ws/src/a.ts", lookup: "read" }, "a read-only command is marked as a lookup");
});

test("a tool's output loses the code fence an agent wraps it in, and nothing else", async () => {
  const { unfenced } = await import("../../src/acp/acpRunner");
  assert.equal(unfenced("```console\nsrc/a.ts:3: useRewards\n```"), "src/a.ts:3: useRewards", "Claude Code's command output");
  assert.equal(unfenced("````\nhas ``` inside\n````"), "has ``` inside", "a longer fence around text with a fence in it");
  assert.equal(unfenced("```\n```"), "", "empty output");
  assert.equal(unfenced("see:\n```\nx\n```"), "see:\n```\nx\n```", "text that only contains a fence stays");
  assert.equal(unfenced("plain output"), "plain output");
});

test("an edit's size counts added and removed lines; a new file is all added", async () => {
  const { diffSize } = await import("../../src/acp/acpRunner");
  assert.deepEqual(diffSize("a\nb\n", "a\nB\nc\n"), { added: 2, removed: 1 });
  assert.deepEqual(diffSize(null, "x\ny"), { added: 2, removed: 0 });
  assert.deepEqual(diffSize("same", "same"), { added: 0, removed: 0 });
});

test("'allow always' is sent only when the user chose the card's always button, and only if the agent offers it", () => {
  const opts: any[] = [{ optionId: "once", kind: "allow_once" }, { optionId: "always", kind: "allow_always" }, { optionId: "no", kind: "reject_once" }];
  assert.deepEqual(toPermissionResponse(opts, true, false), { outcome: { outcome: "selected", optionId: "once" } }, "a plain approve never widens");
  assert.deepEqual(toPermissionResponse(opts, "always", false), { outcome: { outcome: "selected", optionId: "always" } });
  assert.deepEqual(toPermissionResponse(opts.filter((o) => o.kind !== "allow_always"), "always", false), { outcome: { outcome: "selected", optionId: "no" } }, "not offered: rejected, not widened to once");
});

test("the approval queue passes 'always' through only with an approve", async () => {
  const { PendingApprovals } = await import("../../src/gate/pendingApprovals");
  const pending = new PendingApprovals(() => {}, () => {});
  const a = pending.ask("a", { kind: "execute", command: "ls" });
  const b = pending.ask("b", { kind: "execute", command: "ls" });
  pending.answer("a", true, true);
  pending.answer("b", false, true);
  assert.equal(await a, "always");
  assert.equal(await b, false);
});

const echo = tool(async ({ command }: { command: string }) => `A: ${command}`, { name: "run_in_terminal", description: "Run", schema: z.object({ command: z.string() }) as any });

test("kernl's tools are given in every session with the agent's options; the agent's permission request for them gets no card", async () => {
  const server = new KernlToolServer();
  const access = await server.register(() => [echo]);
  const meta = { claudeCode: { options: { allowedTools: ["mcp__kernl"], disallowedTools: ["Bash"] } } };
  const h = harness("kernl-tools", false, MANUAL, { FAKE_MCP_HTTP: "1", FAKE_FORK: "1" }, {
    sessionSetup: async () => ({ mcpServers: [{ type: "http", name: "kernl", url: access.url, headers: Object.entries(access.headers).map(([name, value]) => ({ name, value })) }], meta }),
  });
  try {
    await h.runner.send("go");
    await h.runner.forkSession();
  } finally {
    h.runner.dispose();
    await server.dispose();
  }
  const log = h.fakeLog();
  assert.ok(log.includes(`setup new mcp=kernl:http meta=${JSON.stringify(meta)}`), log.join(" | "));
  assert.ok(log.includes(`setup fork mcp=kernl:http meta=${JSON.stringify(meta)}`), log.join(" | "));
  assert.ok(log.includes("kernl tool permission allow"), log.join(" | "));
  assert.deepEqual(h.asked, [], "no card: kernl's own tool asks through kernl's gate itself");
  assert.ok(h.events.some((e) => e.startsWith("result:") && e.includes("A: echo from agent")), h.events.join(" | "));
  assert.ok(h.events.includes("command:-|echo from agent|-"), "kernl's run_in_terminal shows as a command row");
});

test("an agent that can't reach HTTP MCP servers isn't given kernl's server", async () => {
  const h = harness("write", true, MANUAL, {}, { sessionSetup: async () => ({ mcpServers: [{ type: "http", name: "kernl", url: "http://127.0.0.1:1/mcp", headers: [] }] }) });
  await h.runner.send("go");
  h.runner.dispose();
  assert.ok(h.fakeLog().includes("setup new mcp=none meta=null"), h.fakeLog().join(" | "));
});

test("a command the agent runs in its own shell: streamed output fills its row and goes to the mirror terminal", async () => {
  const mirrored: CommandOutputEvent[] = [];
  const h = harness("kernl-tools", true, MANUAL, {}, { commandOutput: (e) => mirrored.push(e) });
  await h.runner.send("go");
  h.runner.dispose();
  assert.ok(h.events.includes("result:1 passing\nok"), h.events.join(" | "));
  assert.deepEqual(mirrored, [
    { id: "sh1", command: "npm test", cwd: h.cwd },
    { id: "sh1", data: "1 passing\r\n" },
    { id: "sh1", data: "\x1b[32mok\x1b[0m\r\n" },
    { id: "sh1", exitCode: 0 },
  ]);
});

test("kernl's own tools are recognised by each agent's naming, and nothing else is", () => {
  for (const name of ["mcp__kernl__run_in_terminal", "mcp.kernl.browser_click", "kernl_run_in_terminal"]) assert.equal(isKernlTool(name), true, name);
  for (const name of ["Bash", "mcp__kernel__x", "mcp.notion.search", "Write kernl_notes.md", undefined]) assert.equal(isKernlTool(name), false, String(name));
});

test("an agent that answers 'authentication required' is a login signal, and the error says how to log in", async () => {
  const signals: unknown[] = [];
  const h = harness("auth-required", true, MANUAL, {}, { connection: (s) => signals.push(s), loginHint: "Run `claude auth login` in a terminal." });
  await h.runner.send("go");
  h.runner.dispose();
  assert.deepEqual(signals, [{ type: "authRequired", message: "Authentication required: Please run /login" }]);
  assert.equal(h.events.at(-1), "finished:error:Fake Agent needs you to log in (Authentication required: Please run /login). Run `claude auth login` in a terminal.");
});

test("the adapters' login status push, a Codex MCP server that didn't start, and a run that worked are reported", async () => {
  const pushed: unknown[] = [];
  const status = harness("auth-status", true, MANUAL, {}, { connection: (s) => pushed.push(s) });
  await status.runner.send("go");
  // The push is a notification: it can be handled just after the prompt's reply.
  for (const deadline = Date.now() + 2_000; pushed.length < 2 && Date.now() < deadline; ) await new Promise((r) => setTimeout(r, 10));
  status.runner.dispose();
  // A notification and the prompt's reply may arrive in either order.
  assert.deepEqual(pushed.map((p) => JSON.stringify(p)).sort(), [{ type: "authStatus", kind: "none", label: "Not logged in" }, { type: "runSucceeded" }].map((p) => JSON.stringify(p)).sort());
  const mcp: unknown[] = [];
  const failed = harness("mcp-startup-failed", true, MANUAL, {}, { connection: (s) => mcp.push(s) });
  await failed.runner.send("go");
  failed.runner.dispose();
  assert.deepEqual(mcp[0], { type: "mcpStartupFailed", server: "docs", error: "MCP server `docs` failed to start: connection refused" });
});
