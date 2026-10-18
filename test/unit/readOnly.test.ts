import { strict as assert } from "node:assert";
import { readFileSync } from "node:fs";
import { join } from "node:path";
import { test } from "node:test";
import { ReadOnlyBackend } from "../../src/backend/gatedBackend";
import { ScriptedChatModel } from "../support/scriptedModel";
import { runScript, toolCall, workspace } from "../support/harness";
import { buildAgent } from "../../src/agent/createAgent";

test("Restricted Mode: reads work, every change is refused without asking, and there is no shell tool", async () => {
  const w = workspace(true);
  const backend = new ReadOnlyBackend(w.root, w.gate);
  const msgs = await runScript(backend, [
    toolCall("read_file", { file_path: "/app.txt" }),
    toolCall("edit_file", { file_path: "/app.txt", old_string: "world", new_string: "x" }),
    toolCall("write_file", { file_path: "/new.txt", content: "x" }),
  ]);
  assert.match(msgs[0], /hello world/);
  assert.match(msgs[1], /Restricted Mode/);
  assert.match(msgs[2], /Restricted Mode/);
  assert.equal(readFileSync(join(w.root, "app.txt"), "utf8"), "hello world\n");
  assert.equal(w.asked.length, 0);

  const model = new ScriptedChatModel([]);
  let toolNames: string[] = [];
  model.bindTools = ((tools: any[]) => ((toolNames = tools.map((t) => t.name)), model)) as any;
  await buildAgent({ model, workspaceBackend: backend, tools: [], loadProjectRules: false }).invoke({ messages: [{ role: "user", content: "hi" }] }, { configurable: { thread_id: "t" } });
  assert.ok(toolNames.includes("read_file"), toolNames.join(","));
  assert.ok(!toolNames.includes("execute"), `execute offered in Restricted Mode: ${toolNames}`);
});
