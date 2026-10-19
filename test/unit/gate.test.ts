import { strict as assert } from "node:assert";
import { test } from "node:test";
import { tool } from "@langchain/core/tools";
import { z } from "zod";
import { ApprovalGate, isSensitivePath } from "../../src/gate/approvalGate";
import { gatedTool, toolRule } from "../../src/gate/gatedTool";
import { PendingApprovals } from "../../src/gate/pendingApprovals";
import { parseRules } from "../../src/gate/rules";
import { runScript, toolCall, workspace } from "../support/harness";

test("credential-looking file names are sensitive", () => {
  for (const p of ["/.env", "/.env.local", "/certs/server.pem", "/a/private.key", "/home/id_rsa", "/x/id_ed25519.pub"]) assert.equal(isSensitivePath(p), true, p);
  for (const p of ["/app.ts", "/environment.ts", "/keys.ts", "/docs/key-points.md"]) assert.equal(isSensitivePath(p), false, p);
});

test("each approval id resolves once; stale, duplicate, and unknown answers are ignored", async () => {
  const shown: string[] = [];
  const pending = new PendingApprovals((id) => shown.push(id), () => {});
  const a = pending.ask("a", { kind: "delete", path: "/a" });
  const b = pending.ask("b", { kind: "delete", path: "/b" });
  assert.equal(pending.answer("b", true), true);
  assert.equal(pending.answer("b", false), false);
  assert.equal(pending.answer("zzz", true), false);
  assert.equal(pending.answer("a", false), true);
  assert.deepEqual(await Promise.all([a, b]), [false, true]);
  assert.deepEqual(shown, ["a", "b"]);
});

test("Stop denies every open request", async () => {
  const retracted: string[] = [];
  const pending = new PendingApprovals(() => {}, (id) => retracted.push(id));
  const asks = [pending.ask("1", { kind: "execute", command: "x" }), pending.ask("2", { kind: "execute", command: "y" })];
  pending.denyAll();
  assert.deepEqual(await Promise.all(asks), [false, false]);
  assert.deepEqual(retracted, ["1", "2"]);
  assert.equal(pending.size, 0);
});

test("a failing custom tool reports its error to the model and the run continues", async () => {
  const failing = tool(async () => {
    throw new Error("No element matches #missing");
  }, { name: "browser_click", description: "d", schema: z.object({ selector: z.string() }) });
  const w = workspace(true);
  const msgs = await runScript(w.backend, [toolCall("browser_click", { selector: "#missing" }), toolCall("ls", { path: "/" })], [gatedTool(failing, w.gate, "ask")]);
  assert.match(msgs[0], /Error from browser_click: No element matches #missing/);
  assert.match(msgs[1], /app\.txt/, "run should continue to the next tool call");
});

test("gatedTool asks before an 'ask' tool runs, never runs it on rejection, and stamps its rule", async () => {
  let ran = 0;
  const inner = tool(async ({ url }) => (ran++, `opened ${url}`), { name: "browser_navigate", description: "d", schema: z.object({ url: z.string() }) });
  const asked: unknown[] = [];
  const gate = (answer: boolean) => new ApprovalGate({ ask: async (_id, r) => (asked.push(r), answer) }, { rules: () => [] });
  assert.equal(await gatedTool(inner, gate(false), "ask").invoke({ url: "http://x" }), "rejected by user");
  assert.equal(ran, 0);
  assert.equal(await gatedTool(inner, gate(true), "ask").invoke({ url: "http://x" }), "opened http://x");
  assert.equal(ran, 1);
  assert.deepEqual(asked, [{ kind: "tool", tool: "browser_navigate", args: { url: "http://x" } }, { kind: "tool", tool: "browser_navigate", args: { url: "http://x" } }]);
  assert.equal(toolRule(gatedTool(inner, gate(true), "allow")), "allow");
  assert.equal(toolRule(inner), undefined);
});

test("Bypass (a CLI agent calling kernl's tools) skips the card, but a deny rule still refuses", async () => {
  const asked: unknown[] = [];
  const denied: string[] = [];
  const gate = new ApprovalGate({ ask: async (_id, r) => (asked.push(r), false) }, { rules: () => parseRules({ deny: ["run(rm *)"] }, []).rules, mode: () => "bypass", denied: (_r, rule) => denied.push(rule) });
  assert.equal(await gate.request({ kind: "execute", command: "npm test" }), true);
  assert.equal(await gate.request({ kind: "tool", tool: "browser_click", args: {} }), true);
  assert.equal(await gate.request({ kind: "execute", command: "rm -rf build" }), false);
  assert.deepEqual(asked, []);
  assert.equal(denied.length, 1);
});
