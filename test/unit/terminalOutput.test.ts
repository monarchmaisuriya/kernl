import { strict as assert } from "node:assert";
import { test } from "node:test";
import { cleanTerminalOutput } from "../../src/terminal/output";

test("removes escape sequences, carriage returns, and the zsh % marker seen in the spike", () => {
  assert.equal(cleanTerminalOutput("spike-ok\r\n%\n").text, "spike-ok");
  assert.equal(cleanTerminalOutput("\x1b[32mgreen\x1b[0m done\x1b]633;D;0\x07").text, "green done");
  assert.equal(cleanTerminalOutput("progress 10%\rprogress 100%\nok").text, "progress 100%\nok");
});

test("keeps the tail of long output and says so", () => {
  const { text, truncated } = cleanTerminalOutput("x".repeat(50) + "TAIL", 10);
  assert.equal(truncated, true);
  assert.ok(text.endsWith("xxxxxxTAIL"));
  assert.match(text, /^\[earlier output truncated\]/);
});
