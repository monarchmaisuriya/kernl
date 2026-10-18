// Proves untracedRunConfig() stops LangSmith tracing even when the environment turns it on.
// Run once per mode, in its own process, with tracing env pointed at a local fake LangSmith:
//   TRACING_TEST_MODE=control  -> the fake server must receive requests (proves detection works)
//   TRACING_TEST_MODE=untraced -> the fake server must receive none, and process.env must be unchanged
import { strict as assert } from "node:assert";
import { createServer } from "node:http";
import { awaitAllCallbacks } from "@langchain/core/callbacks/promises";
import { AIMessage } from "@langchain/core/messages";
import { createDeepAgent } from "deepagents";
import { untracedRunConfig } from "../../src/agent/tracing";
import { ScriptedChatModel } from "../support/scriptedModel";

async function main() {
  const mode = process.env.TRACING_TEST_MODE;
  if (mode !== "control" && mode !== "untraced") throw new Error(`Expected TRACING_TEST_MODE control|untraced, got '${mode}'`);
  const port = Number(process.env.FAKE_LANGSMITH_PORT);
  if (!Number.isInteger(port)) throw new Error(`Expected integer FAKE_LANGSMITH_PORT, got '${process.env.FAKE_LANGSMITH_PORT}'`);

  const received: string[] = [];
  const server = createServer((req, res) => {
    received.push(`${req.method} ${req.url}`);
    req.resume();
    res.setHeader("content-type", "application/json");
    res.end("{}");
  });
  await new Promise<void>((r) => server.listen(port, "127.0.0.1", () => r()));

  const envBefore = JSON.stringify(process.env);
  // The script spawns a subagent via the task tool, so nested runs are covered too.
  const spawnSubagent = new AIMessage({
    content: "",
    tool_calls: [{ name: "task", args: { description: "say hi", subagent_type: "general-purpose" }, id: "t1", type: "tool_call" }],
  });
  const agent = createDeepAgent({ model: new ScriptedChatModel([spawnSubagent]) });
  const input = { messages: [{ role: "user", content: "hi" }] };
  if (mode === "untraced") await agent.invoke(input, untracedRunConfig());
  else await agent.invoke(input);
  await awaitAllCallbacks();
  await new Promise((r) => setTimeout(r, 3000)); // let the LangSmith client flush its batch
  server.close();

  if (mode === "control") {
    assert.ok(received.length > 0, "control run sent no LangSmith requests, so the test cannot detect tracing");
  } else {
    assert.deepEqual(received, [], `untraced run sent LangSmith requests: ${received.join(", ")}`);
    assert.equal(JSON.stringify(process.env), envBefore, "untracedRunConfig changed process.env");
  }
  console.log(`PASS  tracing ${mode}: ${received.length} LangSmith request(s)${received[0] ? ` e.g. ${received[0]}` : ""}`);
}

main().catch((e) => {
  console.log(`FAIL  tracing ${process.env.TRACING_TEST_MODE}: ${e.message}`);
  process.exit(1);
});
