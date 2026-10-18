// Delegation: a subagent's text goes to its task row, not the main reply; its tool calls are
// labeled with its name; the built-in explorer can't edit or run, the reviewer can run but not edit.
import { strict as assert } from "node:assert";
import { test } from "node:test";
import { AIMessage } from "@langchain/core/messages";
import { BUILT_IN_AGENTS } from "../../src/agent/builtInAgents";
import { buildAgent } from "../../src/agent/createAgent";
import { blockedTools, toolGuard } from "../../src/agent/namedAgents";
import { AgentSession } from "../../src/agent/session";
import { toolCall, workspace } from "../support/harness";
import { ScriptedChatModel } from "../support/scriptedModel";

async function delegate(subScript: AIMessage[], approve = true) {
  const w = workspace(approve);
  const explorer = BUILT_IN_AGENTS.find((a) => a.name === "explorer")!;
  const main = new ScriptedChatModel([toolCall("task", { description: "find the login code", subagent_type: "explorer" }), new AIMessage("MAIN-FINAL")]);
  const agent = buildAgent({
    model: main,
    workspaceBackend: w.workspaceBackend,
    tools: [],
    loadProjectRules: false,
    subagents: [{ name: explorer.name, description: explorer.description, systemPrompt: explorer.prompt, model: new ScriptedChatModel(subScript), middleware: [toolGuard(explorer.name, blockedTools(explorer, { browser: [], mcp: [] }))] }] as any,
  });
  const out = { text: "", sub: [] as string[], calls: [] as string[] };
  const session = new AgentSession(async () => agent, {
    text: (d) => (out.text += d),
    subagentText: (id, d) => out.sub.push(`${id}:${d}`),
    toolCall: (_id, name) => out.calls.push(name),
    toolResult() {},
    usage() {},
    finished() {},
  });
  await session.send("go");
  return { ...out, asked: w.asked };
}

test("a subagent's text goes to its task row, not the main reply; its tool calls carry its name", async () => {
  const r = await delegate([toolCall("ls", { path: "/" }), new AIMessage("SUBAGENT-FINDINGS")]);
  assert.equal(r.text, "MAIN-FINAL");
  assert.ok(r.sub.length > 0 && r.sub.every((s) => /^c[a-z0-9]+:SUBAGENT-FINDINGS$/.test(s)), JSON.stringify(r.sub));
  assert.deepEqual(r.calls, ["task", "explorer > ls"]);
});

test("the built-in explorer can't edit or run; nothing reaches the approval gate", async () => {
  const r = await delegate([toolCall("write_file", { file_path: "/x.txt", content: "x" }), toolCall("execute", { command: "rm -rf /" }), new AIMessage("done")]);
  assert.deepEqual(r.asked, []);
  const reviewer = BUILT_IN_AGENTS.find((a) => a.name === "reviewer")!;
  assert.deepEqual([...blockedTools(reviewer, { browser: [], mcp: [] })].sort(), ["delete", "edit_file", "write_file"], "the reviewer may run checks but never edit");
});

test("token usage is counted across the main agent and its subagents' model calls", async () => {
  const w = workspace(true);
  const main = new ScriptedChatModel([
    new AIMessage({ content: "", tool_calls: [{ name: "task", args: { description: "d", subagent_type: "explorer" }, id: "t1", type: "tool_call" }], usage_metadata: { input_tokens: 100, output_tokens: 10, total_tokens: 110 } }),
    new AIMessage({ content: "done", usage_metadata: { input_tokens: 200, output_tokens: 20, total_tokens: 220 } }),
  ]);
  const sub = new ScriptedChatModel([new AIMessage({ content: "found", usage_metadata: { input_tokens: 50, output_tokens: 5, total_tokens: 55 } })]);
  const agent = buildAgent({ model: main, workspaceBackend: w.workspaceBackend, tools: [], loadProjectRules: false, subagents: [{ name: "explorer", description: "x", systemPrompt: "x", model: sub }] as any });
  let usage: number[] = [];
  await new AgentSession(async () => agent, { text() {}, toolCall() {}, toolResult() {}, usage: (i, o) => (usage = [i, o]), finished() {} }).send("go");
  assert.deepEqual(usage, [350, 35]);
});

test("a tool call whose arguments stream in pieces is reported once, with its whole arguments", async () => {
  const { AIMessageChunk } = await import("@langchain/core/messages");
  const { ChatGenerationChunk } = await import("@langchain/core/outputs");
  class Streaming extends ScriptedChatModel {
    private turn = 0;
    async *_streamResponseChunks() {
      if (this.turn++ > 0) {
        yield new ChatGenerationChunk({ message: new AIMessageChunk({ content: "done" }), text: "done" });
        return;
      }
      const pieces = ['{"description":"find', ' it","subagent_', 'type":"explorer"}'];
      for (const [i, args] of pieces.entries()) {
        yield new ChatGenerationChunk({ message: new AIMessageChunk({ content: "", tool_call_chunks: [{ index: 0, id: i === 0 ? "call-1" : undefined, name: i === 0 ? "task" : undefined, args, type: "tool_call_chunk" }] }), text: "" });
      }
    }
  }
  const w = workspace(true);
  const agent = buildAgent({ model: new Streaming([]), workspaceBackend: w.workspaceBackend, tools: [], loadProjectRules: false, subagents: [{ name: "explorer", description: "x", systemPrompt: "x", model: new ScriptedChatModel([new AIMessage("found")]) }] as any });
  const calls: [string, unknown][] = [];
  await new AgentSession(async () => agent, { text() {}, toolCall: (_id, name, args) => calls.push([name, args]), toolResult() {}, usage() {}, finished() {} }).send("go");
  assert.deepEqual(calls, [["task", { description: "find it", subagent_type: "explorer" }]]);
});
