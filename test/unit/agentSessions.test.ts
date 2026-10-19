// CLI sessions in Conversations: an agent's replay becomes a transcript (each turn closed; a long one
// keeps its latest turns), each agent's store is watched only as a "list changed" signal, and a Claude
// session another running process has open is recognized from Claude Code's own process records.
import { strict as assert } from "node:assert";
import { mkdirSync, mkdtempSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { test } from "node:test";
import { claudeSessionOpenElsewhere, sessionStore } from "../../src/acp/sessionStores";
import { replayTranscript, type TranscriptEvent, turnsAfter } from "../../src/sessions";

const user = (text: string): TranscriptEvent => ({ type: "userMessage", workspace: "w", text });
const reply = (delta: string): TranscriptEvent => ({ type: "text", workspace: "w", delta });

test("a replay's turns each end before the next question and at the end, as live turns do", () => {
  const out = replayTranscript([user("q1"), reply("a1"), user("q2"), reply("a2")], "w");
  assert.deepEqual(out.map((e) => e.type), ["userMessage", "text", "finished", "userMessage", "text", "finished"]);
  assert.deepEqual(replayTranscript([], "w"), []);
});

test("a replay over the limit keeps its latest turns from a question on, with a notice", () => {
  const events = Array.from({ length: 10 }, (_, i) => [user(`q${i}`), reply(`a${i}`)]).flat();
  const out = replayTranscript(events, "w", 8);
  assert.equal(out[0].type, "notice");
  assert.equal((out[1] as any).text, "q8", "starts at a question");
  assert.ok(out.length <= 8);
  assert.equal(out.at(-1)!.type, "finished");
});

test("each agent's session store, under its own home override", () => {
  const env = { CLAUDE_CONFIG_DIR: "/c", CODEX_HOME: "/x", XDG_DATA_HOME: "/d" };
  assert.deepEqual(sessionStore("claude-code", env, "/h"), { base: "/c/projects", pattern: "*/*.jsonl" });
  assert.deepEqual(sessionStore("codex", env, "/h"), { base: "/x", pattern: "state_*.sqlite*" });
  assert.deepEqual(sessionStore("opencode", env, "/h"), { base: "/d/opencode", pattern: "opencode.db*" });
  assert.deepEqual(sessionStore("claude-code", {}, "/h"), { base: "/h/.claude/projects", pattern: "*/*.jsonl" });
});

test("a Claude session is open elsewhere only when a running process's record names it", async () => {
  const home = mkdtempSync(join(tmpdir(), "kernl-claude-"));
  const dir = join(home, ".claude", "sessions");
  mkdirSync(dir, { recursive: true });
  writeFileSync(join(dir, "101.json"), JSON.stringify({ pid: 101, sessionId: "live" }));
  writeFileSync(join(dir, "102.json"), JSON.stringify({ pid: 102, sessionId: "ended" }));
  writeFileSync(join(dir, "103.json"), "{ half-written");
  const alive = (pid: number) => pid === 101;
  assert.equal(await claudeSessionOpenElsewhere("live", {}, home, alive), true);
  assert.equal(await claudeSessionOpenElsewhere("ended", {}, home, alive), false, "its process ended");
  assert.equal(await claudeSessionOpenElsewhere("other", {}, home, alive), false);
  assert.equal(await claudeSessionOpenElsewhere("live", {}, join(home, "missing"), alive), false, "no records folder");
});

test("turns added elsewhere: what the agent has after kernl's last message, found even with kernl's attachment note on the agent's copy", () => {
  const replay = [user("first"), reply("a1"), user("write hello.txt\n\nAttached: README.md"), reply("done"), user("added in a terminal"), reply("terminal reply")];
  assert.deepEqual(turnsAfter(replay, "write hello.txt")!.map((e) => (e as any).text ?? (e as any).delta), ["added in a terminal", "terminal reply"]);
  assert.deepEqual(turnsAfter(replay, "added in a terminal"), [], "nothing added since");
  assert.equal(turnsAfter(replay, "never sent"), undefined, "kernl's message isn't there: can't line up");
  assert.equal(turnsAfter(replay, undefined)!.length, replay.length, "kernl had no message yet: all of it");
  assert.deepEqual(turnsAfter([user("same"), reply("x"), user("same"), reply("y")], "same"), [], "the latest occurrence is kernl's last");
});
