// A command counts as waiting for input when its output went quiet on a line that asks something.
import { strict as assert } from "node:assert";
import { test } from "node:test";
import { looksLikePrompt } from "../../src/terminal/output";

test("questions, [y/N], passwords, press-any-key, and labels ending in a colon look like prompts", () => {
  for (const line of ["Continue? [y/N]", "Proceed (y/n)?", "Ok to proceed? (y)", "Password:", "Enter passphrase for key '/id':", "Press any key to continue . . .", "Username: ", "? Pick a template ›"]) {
    assert.equal(looksLikePrompt(line), true, line);
  }
});

test("ordinary output lines don't", () => {
  for (const line of ["", "Compiling 42 files", "✓ 18 tests passed", "Done in 2.1s.", "[INFO] Building jar"]) {
    assert.equal(looksLikePrompt(line), false, line);
  }
});
