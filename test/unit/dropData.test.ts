// What a drop on the panel carries: Explorer URIs in each format VS Code provides, and files from
// Finder (no path) attached as text when they are text.
import { strict as assert } from "node:assert";
import { test } from "node:test";
import { droppedFiles, isPanelDrop, linkUris, vscodeUris } from "../../src/webview/dropData";

const data = (formats: Record<string, string>) => ({ getData: (type: string) => formats[type] ?? "" });

test("items dragged from VS Code come from the richest format it carries; links are read separately", () => {
  // VS Code's own list has every item, folders included; text/uri-list keeps only the first (a Chromium workaround).
  assert.deepEqual(vscodeUris(data({ "application/vnd.code.uri-list": "file:///ws/src/a.ts\nfile:///ws/docs", "text/uri-list": "file:///ws/src/a.ts" })), ["file:///ws/src/a.ts", "file:///ws/docs"]);
  assert.deepEqual(vscodeUris(data({ resourceurls: JSON.stringify(["file:///ws/b.ts"]) })), ["file:///ws/b.ts"]);
  assert.deepEqual(vscodeUris(data({ codefiles: JSON.stringify(["/ws/my file.ts"]) })), ["file:///ws/my%20file.ts"], "paths become file URIs");
  assert.deepEqual(vscodeUris(data({ "text/uri-list": "file:///ws/c.ts" })), [], "a plain link list isn't VS Code's");
  assert.deepEqual(linkUris(data({ "text/uri-list": "# comment\r\nhttps://example.com/page\r\n" })), ["https://example.com/page"]);
  assert.deepEqual(vscodeUris(data({ resourceurls: "not json" })), []);
});

test("only drops of files, VS Code items, or links are the panel's; moving text isn't", () => {
  assert.equal(isPanelDrop(["application/vnd.code.uri-list", "text/plain"]), true);
  assert.equal(isPanelDrop(["Files"]), true);
  assert.equal(isPanelDrop(["text/uri-list"]), true);
  assert.equal(isPanelDrop(["text/plain"]), false, "text dragged within the composer keeps the browser's own drop");
  assert.equal(isPanelDrop(undefined), false);
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
