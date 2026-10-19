// The unsent message is kept per window; long pasted text past the limit isn't, and an empty box keeps nothing.
import { strict as assert } from "node:assert";
import { test } from "node:test";
import { DRAFT_TEXT_LIMIT, draftToKeep } from "../../src/ui/draft";

test("a draft keeps its text and attachments; an empty box keeps nothing", () => {
  const file = { path: "src/a.ts", kind: "file" as const };
  assert.deepEqual(draftToKeep("look at @src/a.ts", [file]), { draft: { text: "look at @src/a.ts", attachments: [file] }, dropped: 0 });
  assert.deepEqual(draftToKeep("   ", []), { dropped: 0 });
  assert.ok(draftToKeep("", [file]).draft, "an attachment alone is a draft");
});

test("text attachments past the limit in total are left out, files never are", () => {
  const big = { path: "paste-1", kind: "text" as const, text: "x".repeat(DRAFT_TEXT_LIMIT - 10) };
  const more = { path: "paste-2", kind: "text" as const, text: "y".repeat(100) };
  const folder = { path: "docs", kind: "folder" as const };
  const { draft, dropped } = draftToKeep("hi", [big, more, folder]);
  assert.deepEqual(draft!.attachments.map((a) => a.path), ["paste-1", "docs"]);
  assert.equal(dropped, 1);
});
