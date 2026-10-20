// CLI agents' sessions read for tags, shared by a window's tabs: once per version, a read in progress
// shared, failures not kept, and the sessions used longest ago dropped past the limit.
import { strict as assert } from "node:assert";
import { test } from "node:test";
import { AgentThreadCache } from "../../src/agentThreads";
import type { TranscriptEvent } from "../../src/sessions";

const events = (text: string): TranscriptEvent[] => [{ type: "userMessage", workspace: "main", text }];

test("a session is read once per version; a newer version is read again", async () => {
  const cache = new AgentThreadCache();
  let reads = 0;
  const load = (text: string) => async () => (reads++, events(text));
  assert.deepEqual(await cache.get("claude-code:s1", 100, load("v1")), events("v1"));
  assert.deepEqual(await cache.get("claude-code:s1", 100, load("other")), events("v1"), "the kept copy, not a new read");
  assert.equal(reads, 1);
  assert.deepEqual(await cache.get("claude-code:s1", 200, load("v2")), events("v2"));
  assert.equal(reads, 2);
});

test("two tabs asking at once share one read; a failed read isn't kept", async () => {
  const cache = new AgentThreadCache();
  let reads = 0;
  let finish!: (v: TranscriptEvent[]) => void;
  const slow = () => (reads++, new Promise<TranscriptEvent[]>((r) => (finish = r)));
  const first = cache.get("codex:s2", 1, slow);
  const second = cache.get("codex:s2", 1, slow);
  finish(events("shared"));
  assert.deepEqual(await first, events("shared"));
  assert.deepEqual(await second, events("shared"));
  assert.equal(reads, 1);
  let tries = 0;
  assert.equal(await cache.get("codex:s3", 1, async () => (tries++, "Codex didn't load it")), "Codex didn't load it");
  assert.deepEqual(await cache.get("codex:s3", 1, async () => (tries++, events("later"))), events("later"), "tried again");
  assert.equal(tries, 2);
});

test("past the limit, the session used longest ago goes", async () => {
  const cache = new AgentThreadCache(2);
  let reads = 0;
  const load = (text: string) => async () => (reads++, events(text));
  await cache.get("a", 1, load("a"));
  await cache.get("b", 1, load("b"));
  await cache.get("a", 1, load("a again"));
  await cache.get("c", 1, load("c"));
  assert.equal(reads, 3);
  assert.deepEqual(await cache.get("a", 1, load("a reread")), events("a"), "a was used most recently, so it stayed");
  assert.deepEqual(await cache.get("b", 1, load("b reread")), events("b reread"), "b went");
  assert.equal(reads, 4);
});

test("a session the agent gives no time for isn't kept (each tag reads it fresh); a read in progress is still shared", async () => {
  const cache = new AgentThreadCache();
  let reads = 0;
  let finish!: (v: TranscriptEvent[]) => void;
  const slow = () => (reads++, new Promise<TranscriptEvent[]>((r) => (finish = r)));
  const first = cache.get("opencode:s9", 0, slow);
  const second = cache.get("opencode:s9", 0, slow);
  finish(events("now"));
  await Promise.all([first, second]);
  assert.equal(reads, 1, "shared while in progress");
  assert.deepEqual(await cache.get("opencode:s9", 0, async () => (reads++, events("later"))), events("later"), "not kept: read again");
  assert.equal(reads, 2);
});
