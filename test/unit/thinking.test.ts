// Built-in sequential thinking: the reference server's semantics, string-tolerant inputs, no approval.
import { strict as assert } from "node:assert";
import { test } from "node:test";
import { AIMessage } from "@langchain/core/messages";
import { ThinkingLog, thinkingTool } from "../../src/agent/thinking";
import { runScript, toolCall, workspace } from "../support/harness";

test("thoughts are recorded; the total rises when passed; branches are listed; reset starts over", () => {
  const log = new ThinkingLog();
  assert.deepEqual(log.process({ thought: "a", thoughtNumber: 1, totalThoughts: 3, nextThoughtNeeded: true }), { thoughtNumber: 1, totalThoughts: 3, nextThoughtNeeded: true, branches: [], thoughtHistoryLength: 1 });
  assert.equal(log.process({ thought: "b", thoughtNumber: 5, totalThoughts: 3, nextThoughtNeeded: true }).totalThoughts, 5);
  assert.deepEqual(log.process({ thought: "c", thoughtNumber: 3, totalThoughts: 5, nextThoughtNeeded: false, branchFromThought: 2, branchId: "alt" }).branches, ["alt"]);
  assert.equal(log.process({ thought: "d", thoughtNumber: 4, totalThoughts: 5, nextThoughtNeeded: false, branchFromThought: 2 }).branches.length, 1, "a branch needs an id to be listed");
  log.reset();
  assert.equal(log.process({ thought: "e", thoughtNumber: 1, totalThoughts: 1, nextThoughtNeeded: false }).thoughtHistoryLength, 1);
});

test("the agent's tool accepts numbers and booleans sent as strings, never asks, and answers with the server's JSON", async () => {
  const w = workspace(false);
  const results = await runScript(w.backend, [toolCall("sequential_thinking", { thought: "plan the fix", thoughtNumber: "2", totalThoughts: "4", nextThoughtNeeded: "true", isRevision: "false" }), new AIMessage("ok")], [thinkingTool(new ThinkingLog(), w.gate)]);
  assert.deepEqual(JSON.parse(results[0]), { thoughtNumber: 2, totalThoughts: 4, nextThoughtNeeded: true, branches: [], thoughtHistoryLength: 1 });
  assert.deepEqual(w.asked, []);
});
