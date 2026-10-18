// Contract between Deep Agents and our backend: every side effect reaches the gate, and a
// rejection leaves the disk untouched. Run on every Deep Agents upgrade (npm run check:upgrade).
import { strict as assert } from "node:assert";
import { existsSync, readFileSync, writeFileSync } from "node:fs";
import { join } from "node:path";
import { test } from "node:test";
import { runScript, toolCall, workspace } from "../support/harness";
import type { GateRequest } from "../../src/gate/approvalGate";

test("rejected edit_file leaves the file unchanged and tells the model", async () => {
  const w = workspace(false);
  const msgs = await runScript(w.backend, [toolCall("edit_file", { file_path: "/app.txt", old_string: "world", new_string: "there" })]);
  assert.equal(readFileSync(join(w.root, "app.txt"), "utf8"), "hello world\n");
  assert.deepEqual(w.asked.map((r) => r.kind), ["edit"]);
  assert.match(msgs[0], /rejected by user/);
});

test("approved edit writes exactly the text shown for approval", async () => {
  const w = workspace(true);
  await runScript(w.backend, [toolCall("edit_file", { file_path: "/app.txt", old_string: "world", new_string: "there" })]);
  const shown = w.asked[0] as any;
  assert.equal(shown.before, "hello world\n");
  assert.equal(shown.after, "hello there\n");
  assert.equal(readFileSync(join(w.root, "app.txt"), "utf8"), shown.after);
});

test("ambiguous or missing old_string is an error and never asks", async () => {
  const w = workspace(true);
  const msgs = await runScript(w.backend, [
    toolCall("edit_file", { file_path: "/app.txt", old_string: "nope", new_string: "x" }),
    toolCall("edit_file", { file_path: "/app.txt", old_string: "o", new_string: "0" }),
  ]);
  assert.match(msgs[0], /String not found/);
  assert.match(msgs[1], /Found 2 matches/);
  assert.equal(w.asked.length, 0);
});

test("rejected write_file creates nothing", async () => {
  const w = workspace(false);
  await runScript(w.backend, [toolCall("write_file", { file_path: "/new.txt", content: "x" })]);
  assert.equal(existsSync(join(w.root, "new.txt")), false);
});

test("rejected delete keeps the file", async () => {
  const w = workspace(false);
  await runScript(w.backend, [toolCall("delete", { file_path: "/app.txt" })]);
  assert.equal(existsSync(join(w.root, "app.txt")), true);
});

test("rejected uploadFiles (the summarizer's write path) writes nothing", async () => {
  const w = workspace(false);
  const res = await w.workspaceBackend.uploadFiles([["/up.txt", new TextEncoder().encode("x")]]);
  assert.equal(res[0].error, "permission_denied");
  assert.equal(existsSync(join(w.root, "up.txt")), false);
});

test("rejected execute never reaches the runner; approved returns output to the model", async () => {
  const no = workspace(false);
  const noMsgs = await runScript(no.backend, [toolCall("execute", { command: "rm -rf /" })]);
  assert.deepEqual(no.commands, []);
  assert.match(noMsgs[0], /rejected by user/);
  const yes = workspace(true);
  const yesMsgs = await runScript(yes.backend, [toolCall("execute", { command: "npm test" })]);
  assert.deepEqual(yes.commands, ["npm test"]);
  assert.match(yesMsgs[0], /ran: npm test/);
});

test("allow-listed command runs without asking; the same command chained still asks", async () => {
  const w = workspace(false, ["npm test"]);
  await runScript(w.backend, [toolCall("execute", { command: "npm test" }), toolCall("execute", { command: "npm test; rm x" })]);
  assert.deepEqual(w.commands, ["npm test"]);
  assert.deepEqual(w.asked.map((r) => (r as any).command), ["npm test; rm x"]);
});

test("a subagent's edit goes through the same gate", async () => {
  const w = workspace(false);
  await runScript(w.backend, [
    toolCall("task", { description: "change world to there in /app.txt", subagent_type: "general-purpose" }),
    toolCall("edit_file", { file_path: "/app.txt", old_string: "world", new_string: "there" }),
  ]);
  assert.equal(readFileSync(join(w.root, "app.txt"), "utf8"), "hello world\n");
  assert.equal(w.asked.filter((r) => r.kind === "edit").length, 1);
});

test("harness scratch writes stay in memory and never ask", async () => {
  const w = workspace(false);
  const msgs = await runScript(w.backend, [toolCall("write_file", { file_path: "/large_tool_results/abc.txt", content: "big" })]);
  assert.doesNotMatch(msgs[0], /rejected|error/i);
  assert.equal(w.asked.length, 0);
  assert.equal(existsSync(join(w.root, "large_tool_results")), false);
});

test("reading a credential file asks; rejection returns no content; grep never shows its lines", async () => {
  const w = workspace(false);
  const msgs = await runScript(w.backend, [
    toolCall("read_file", { file_path: "/.env" }),
    toolCall("grep", { pattern: "SECRET_TOKEN", output_mode: "content" }),
    toolCall("read_file", { file_path: "/app.txt" }),
  ]);
  assert.deepEqual(w.asked, [{ kind: "read", path: "/.env" }]);
  assert.ok(!msgs.join("\n").includes("abc123"), `secret leaked: ${msgs.join(" | ")}`);
  assert.match(msgs[2], /hello world/);
});

test("paths cannot escape the workspace", async () => {
  const w = workspace(true);
  await assert.rejects(() => w.workspaceBackend.write("/../escape.txt", "x"), /escapes the workspace/);
});

test("approving after the file changed writes nothing and keeps the user's change", async () => {
  let root = "";
  const userSavesThenApproves = (_r: GateRequest) => {
    writeFileSync(join(root, "app.txt"), "hello world\nedited by user\n");
    return true;
  };
  const w = workspace(userSavesThenApproves);
  root = w.root;
  const msgs = await runScript(w.backend, [toolCall("edit_file", { file_path: "/app.txt", old_string: "world", new_string: "there" })]);
  assert.equal(readFileSync(join(w.root, "app.txt"), "utf8"), "hello world\nedited by user\n");
  assert.match(msgs[0], /changed while waiting for approval/);
});

test("overwriting a file that changed during approval writes nothing", async () => {
  let root = "";
  const w = workspace((_r: GateRequest) => (writeFileSync(join(root, "app.txt"), "user version\n"), true));
  root = w.root;
  const res = await w.workspaceBackend.write("/app.txt", "agent version\n");
  assert.match(res.error ?? "", /changed while waiting for approval/);
  assert.equal(readFileSync(join(w.root, "app.txt"), "utf8"), "user version\n");
});
