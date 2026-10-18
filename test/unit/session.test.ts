import { strict as assert } from "node:assert";
import { test } from "node:test";
import { AIMessage } from "@langchain/core/messages";
import { buildAgent } from "../../src/agent/createAgent";
import { AgentSession, imagesOf, type SessionEvents } from "../../src/agent/session";
import { GatedBackend } from "../../src/backend/gatedBackend";
import { NodeWorkspaceFiles } from "../../src/backend/workspaceFiles";
import { ApprovalGate } from "../../src/gate/approvalGate";
import { ScriptedChatModel } from "../support/scriptedModel";
import { toolCall, workspace } from "../support/harness";

function recorder() {
  const log: string[] = [];
  const events: SessionEvents = {
    text: (d) => log.push(`text:${d}`),
    toolCall: (_id, name) => log.push(`call:${name}`),
    toolResult: (_id, name, out) => log.push(`result:${name}:${out.slice(0, 40)}`),
    usage: () => log.push("usage"),
    thinking: (d) => log.push(`thinking:${d}`),
    plan: (entries) => log.push(`plan:${entries.map((e) => `${e.status}=${e.content}`).join("|")}`),
    finished: (reason, msg) => log.push(`finished:${reason}${msg ? `:${msg}` : ""}`),
  };
  return { log, events };
}

test("streams assistant text, tool calls, and tool results, then finishes", async () => {
  const w = workspace(true);
  const model = new ScriptedChatModel([toolCall("ls", { path: "/" }), new AIMessage("All files listed.")]);
  const agent = buildAgent({ model, workspaceBackend: w.workspaceBackend, tools: [], loadProjectRules: false });
  const { log, events } = recorder();
  await new AgentSession(async () => agent, events).send("list files");
  assert.ok(log.includes("call:ls"), log.join(" | "));
  assert.ok(log.some((l) => l.startsWith("result:ls:") && l.includes("app.txt")), log.join(" | "));
  assert.ok(log.includes("text:All files listed."), log.join(" | "));
  assert.equal(log.at(-1), "finished:done");
});

test("the thread keeps history across turns", async () => {
  const w = workspace(true);
  const model = new ScriptedChatModel([new AIMessage("first"), new AIMessage("second")]);
  const seen: number[] = [];
  const original = model._generate.bind(model);
  model._generate = async (messages: any) => (seen.push(messages.length), original(messages));
  const agent = buildAgent({ model, workspaceBackend: w.workspaceBackend, tools: [], loadProjectRules: false });
  const session = new AgentSession(async () => agent, recorder().events);
  await session.send("one");
  await session.send("two");
  assert.ok(seen[1] > seen[0], `second turn should see more messages: ${seen}`);
});

test("Stop pressed during the run's last step is still reported as stopped", async () => {
  const w = workspace(true);
  let session!: AgentSession;
  const model = new ScriptedChatModel([]);
  model._generate = async () => {
    session.stop(); // user presses Stop while the final reply is being produced
    return { generations: [{ message: new AIMessage("final answer"), text: "final answer" }] };
  };
  const agent = buildAgent({ model, workspaceBackend: w.workspaceBackend, tools: [], loadProjectRules: false });
  const { log, events } = recorder();
  session = new AgentSession(async () => agent, events);
  await session.send("go");
  assert.equal(log.at(-1), "finished:stopped");
});

test("Stop ends a run blocked in a command within 2 seconds and tells the blocked tool", async () => {
  let session!: AgentSession;
  let toldToStop = false;
  const runner = (_cmd: string) =>
    new Promise<any>((resolve) => {
      session.signal!.addEventListener("abort", () => {
        toldToStop = true;
        resolve({ output: "cancelled", exitCode: null, truncated: false });
      });
    });
  const w = workspace(true);
  const backend = new GatedBackend(w.root, new ApprovalGate({ ask: async () => true }, { rules: () => [] }), new NodeWorkspaceFiles(), runner);
  const agent = buildAgent({ model: new ScriptedChatModel([toolCall("execute", { command: "sleep 60" })]), workspaceBackend: backend, tools: [], loadProjectRules: false });
  const { log, events } = recorder();
  session = new AgentSession(async () => agent, events);
  const started = Date.now();
  const run = session.send("run it");
  await new Promise((r) => setTimeout(r, 300));
  session.stop();
  await run;
  assert.ok(Date.now() - started < 2300, `took ${Date.now() - started} ms`);
  assert.equal(toldToStop, true);
  assert.equal(log.at(-1), "finished:stopped");
  assert.equal(session.running, false);
});

test("the model's thinking streams to the panel (Anthropic thinking parts and DeepSeek reasoning_content), apart from the reply", async () => {
  const w = workspace(true);
  const reply = new AIMessage({ content: [{ type: "thinking", thinking: "Check the files first." } as any, { type: "text", text: "Here is the answer." }], additional_kwargs: { reasoning_content: " Then answer." } });
  const agent = buildAgent({ model: new ScriptedChatModel([reply]), workspaceBackend: w.workspaceBackend, tools: [], loadProjectRules: false });
  const { log, events } = recorder();
  await new AgentSession(async () => agent, events).send("explain");
  assert.ok(log.includes("thinking:Check the files first. Then answer."), log.join(" | "));
  assert.ok(log.includes("text:Here is the answer."), "the reply has no thinking in it");
});

test("the agent's to-do list becomes the plan, not a tool row", async () => {
  const w = workspace(true);
  const model = new ScriptedChatModel([toolCall("write_todos", { todos: [{ content: "Read the hook", status: "completed" }, { content: "Explain it", status: "in_progress" }] }), new AIMessage("Explained.")]);
  const agent = buildAgent({ model, workspaceBackend: w.workspaceBackend, tools: [], loadProjectRules: false });
  const { log, events } = recorder();
  await new AgentSession(async () => agent, events).send("explain");
  assert.ok(log.includes("plan:completed=Read the hook|in_progress=Explain it"), log.join(" | "));
  assert.ok(!log.some((l) => l.startsWith("call:write_todos") || l.startsWith("result:write_todos")), log.join(" | "));
});

test("images in a tool result reach the panel: kernl's own image parts and base64 data URLs; nothing else", () => {
  assert.deepEqual(imagesOf([{ type: "text", text: "page" }, { type: "image", mimeType: "image/png", data: "AAAA" }]), [{ mimeType: "image/png", data: "AAAA" }]);
  assert.deepEqual(imagesOf([{ type: "image_url", image_url: { url: "data:image/jpeg;base64,BBBB" } }]), [{ mimeType: "image/jpeg", data: "BBBB" }]);
  assert.deepEqual(imagesOf([{ type: "image_url", image_url: { url: "https://example.com/x.png" } }]), [], "a URL is never fetched");
  assert.deepEqual(imagesOf("plain text"), []);
});
