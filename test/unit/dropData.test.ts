// What a drop on the panel carries: Explorer URIs in each format VS Code provides, and files from
// Finder (no path) attached as text when they are text.
import { strict as assert } from "node:assert";
import { test } from "node:test";
import { droppedFiles, droppedUris } from "../../src/webview/dropData";

const data = (formats: Record<string, string>) => ({ getData: (type: string) => formats[type] ?? "" });

test("an Explorer drop's URIs come from the richest format it carries", () => {
  // VS Code's own list has every item, folders included; text/uri-list keeps only the first (a Chromium workaround).
  assert.deepEqual(droppedUris(data({ "application/vnd.code.uri-list": "file:///ws/src/a.ts\nfile:///ws/docs", "text/uri-list": "file:///ws/src/a.ts" })), ["file:///ws/src/a.ts", "file:///ws/docs"]);
  assert.deepEqual(droppedUris(data({ resourceurls: JSON.stringify(["file:///ws/b.ts"]) })), ["file:///ws/b.ts"]);
  assert.deepEqual(droppedUris(data({ codefiles: JSON.stringify(["/ws/my file.ts"]) })), ["file:///ws/my%20file.ts"], "paths become file URIs");
  assert.deepEqual(droppedUris(data({ "text/uri-list": "# comment\r\nfile:///ws/c.ts\r\n" })), ["file:///ws/c.ts"]);
  assert.deepEqual(droppedUris(data({ resourceurls: "not json" })), []);
  assert.deepEqual(droppedUris(data({})), []);
});

test("files from Finder are attached by content when they're text; others are named with the reason", async () => {
  const { attached, skipped } = await droppedFiles([
    new File(["export const a = 1;\n"], "a.ts", { type: "text/plain" }),
    new File([new Uint8Array([0x89, 0x50, 0x4e, 0x47, 0, 0, 0])], "logo.png", { type: "image/png" }),
    new File([new Uint8Array([1, 2, 0, 3])], "data.bin"),
    new File(["x".repeat(20_001)], "big.log"),
  ]);
  assert.deepEqual(attached, [{ kind: "text", path: "a.ts", text: "export const a = 1;\n" }]);
  assert.deepEqual(skipped, ["logo.png (not text)", "data.bin (not text)", "big.log (over 20,000 characters)"]);
});
