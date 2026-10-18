import { strict as assert } from "node:assert";
import { writeFileSync } from "node:fs";
import { join } from "node:path";
import { test } from "node:test";
import { buildAgent } from "../../src/agent/createAgent";
import { ScriptedChatModel } from "../support/scriptedModel";
import { toolCall, workspace } from "../support/harness";

async function promptSeenByModel(loadProjectRules: boolean, writeRules: boolean) {
  const w = workspace(true);
  if (writeRules) writeFileSync(join(w.root, "AGENTS.md"), "Always answer in haiku. RULE-MARKER-7731\n");
  const model = new ScriptedChatModel([]);
  let seen = "";
  const original = model._generate.bind(model);
  model._generate = async (messages: any) => ((seen = JSON.stringify(messages.map((m: any) => m.content))), original(messages));
  await buildAgent({ model, workspaceBackend: w.workspaceBackend, tools: [], loadProjectRules }).invoke({ messages: [{ role: "user", content: "hi" }] }, { configurable: { thread_id: "t" } });
  return seen;
}

test("AGENTS.md reaches the model in a trusted workspace", async () => {
  assert.match(await promptSeenByModel(true, true), /RULE-MARKER-7731/);
});

test("AGENTS.md is ignored when project rules are off (Restricted Mode)", async () => {
  assert.doesNotMatch(await promptSeenByModel(false, true), /RULE-MARKER-7731/);
});

test("a missing AGENTS.md does not break the agent", async () => {
  await promptSeenByModel(true, false);
});

test("a 50-step task completes", async () => {
  const w = workspace(true);
  const script = Array.from({ length: 50 }, (_, i) => toolCall("ls", { path: "/" }, `s${i}`));
  const agent = buildAgent({ model: new ScriptedChatModel(script), workspaceBackend: w.workspaceBackend, tools: [], loadProjectRules: false });
  const out = await agent.invoke({ messages: [{ role: "user", content: "go" }] }, { configurable: { thread_id: "long" }, recursionLimit: 200 });
  assert.ok(out.messages.length > 100, `only ${out.messages.length} messages`);
});
