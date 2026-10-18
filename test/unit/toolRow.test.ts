// Tool calls in plain words: known tools become a sentence, CLI agents' titles pass through, MCP
// tools name their server, subagent calls name the subagent; elapsed time reads like "4s" / "1m 5s".
import { strict as assert } from "node:assert";
import { test } from "node:test";
import { describeTool, formatElapsed } from "../../src/webview/toolRow";

test("tool calls are described in plain words", () => {
  assert.deepEqual(describeTool("read_file", { file_path: "/src/a.ts" }), { action: "Reading", target: "src/a.ts" });
  assert.deepEqual(describeTool("edit_file", { file_path: "/README.md" }), { action: "Editing", target: "README.md" });
  assert.deepEqual(describeTool("grep", { pattern: "app.get", path: "/src" }), { action: "Searching for", target: '"app.get" in src' });
  assert.deepEqual(describeTool("execute", { command: "npm test" }), { action: "Running", target: "npm test" });
  assert.deepEqual(describeTool("ls", {}), { action: "Listing", target: "." });
  assert.deepEqual(describeTool("task", { subagent_type: "explorer", description: "find the login code" }), { action: "Delegating to explorer", target: "find the login code" });
  assert.deepEqual(describeTool("explorer > grep", { pattern: "login" }), { action: "explorer: Searching for", target: '"login"' });
  assert.deepEqual(describeTool("Read hello.txt", {}), { action: "Read hello.txt" }, "a CLI agent's own title");
  assert.deepEqual(describeTool("github__create_issue", {}), { action: "github: Create issue" });
  assert.deepEqual(describeTool("some_new_tool", {}), { action: "Some new tool" });
  assert.equal(describeTool("execute", { command: "x".repeat(200) }).target!.length, 80, "long commands are cut");
});

test("elapsed time reads like 4s or 1m 5s", () => {
  assert.equal(formatElapsed(400), "0s");
  assert.equal(formatElapsed(4_200), "4s");
  assert.equal(formatElapsed(65_000), "1m 5s");
});
