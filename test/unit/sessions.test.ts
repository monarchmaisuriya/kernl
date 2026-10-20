// Stored conversations: saved per workspace, listed newest first, empty ones not kept; a stored
// kernl conversation continues with its history; cutting history stops before a given turn.
import { strict as assert } from "node:assert";
import { existsSync, mkdtempSync, readFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { test } from "node:test";
import { AIMessage } from "@langchain/core/messages";
import { buildAgent } from "../../src/agent/createAgent";
import { AgentSession } from "../../src/agent/session";
import { cutHistory, SessionStore, threadExcerpt, threadPage, threadTurns } from "../../src/sessions";
import { workspace } from "../support/harness";
import { ScriptedChatModel } from "../support/scriptedModel";

test("sessions are saved per workspace with a title from the first message, newest first; empty ones aren't kept", async () => {
  const store = new SessionStore(mkdtempSync(join(tmpdir(), "kernl-sessions-")));
  const empty = store.create("deepagents");
  await store.save("ws1", empty);
  assert.deepEqual(await store.list("ws1"), []);
  const a = store.create("deepagents");
  a.events.push({ type: "userMessage", workspace: "main", text: "Fix   the login\nbug please" });
  await store.save("ws1", a);
  await new Promise((r) => setTimeout(r, 5));
  const b = store.create("claude-code");
  b.events.push({ type: "userMessage", workspace: "main", text: "Second" }, { type: "text", workspace: "main", delta: "ok" });
  b.history = { sessionId: "acp-1" };
  await store.save("ws1", b);
  const list = await store.list("ws1");
  assert.deepEqual(list.map((s) => [s.title, s.harness, s.messages]), [["Second", "claude-code", 1], ["Fix the login bug please", "deepagents", 1]]);
  assert.deepEqual((await store.load("ws1", b.id))!.history, { sessionId: "acp-1" });
  assert.deepEqual(await store.list("ws2"), [], "other workspaces are separate");
});

async function runAgent(script: AIMessage[], history?: unknown) {
  const w = workspace(true);
  const model = new ScriptedChatModel(script);
  let seen = "";
  const original = model._generate.bind(model);
  model._generate = async (m: any) => ((seen = JSON.stringify(m.map((x: any) => x.content))), original(m));
  const agent = buildAgent({ model, workspaceBackend: w.workspaceBackend, tools: [], loadProjectRules: false });
  const session = new AgentSession(async () => agent, { text() {}, toolCall() {}, toolResult() {}, usage() {}, finished() {} });
  if (history) session.newThread(history);
  return { session, seen: () => seen };
}

test("a stored kernl conversation continues: the next message sees the earlier turns", async () => {
  const first = await runAgent([new AIMessage("answer one MARK-A")]);
  await first.session.send("question one MARK-Q");
  const history = await first.session.exportHistory();
  const resumed = await runAgent([new AIMessage("answer two")], JSON.parse(JSON.stringify(history)));
  await resumed.session.send("follow-up MARK-F");
  assert.match(resumed.seen(), /MARK-Q[\s\S]*MARK-A[\s\S]*MARK-F/);
});

test("a history export started just before a New Chat returns the conversation it started on, not the new empty one", async () => {
  const first = await runAgent([new AIMessage("answer one MARK-A")]);
  await first.session.send("question one MARK-Q");
  const exporting = first.session.exportHistory(); // New Chat starts the save, then...
  first.session.newThread(); // ...starts the new thread at once
  assert.match(JSON.stringify(await exporting), /MARK-Q[\s\S]*MARK-A/);
});

test("cutting history stops right before the chosen user turn", () => {
  const h = [{ type: "human" }, { type: "ai" }, { type: "human" }, { type: "ai" }, { type: "tool" }, { type: "human" }, { type: "ai" }];
  assert.equal((cutHistory(h, 0) as unknown[]).length, 0);
  assert.equal((cutHistory(h, 1) as unknown[]).length, 2);
  assert.equal((cutHistory(h, 2) as unknown[]).length, 5);
  assert.equal(cutHistory({ sessionId: "x" }, 1), undefined, "a CLI agent's session can't be cut");
});

const about = (s: { title: string; updatedAt: number }) => ({ title: s.title, updatedAt: s.updatedAt, agent: "Claude Code", workspace: "Develop", handle: "h-1" });

test("a short tagged conversation is sent whole: a header with its handle, then each turn's request, reply, and tool calls", () => {
  const s = new SessionStore(mkdtempSync(join(tmpdir(), "kernl-sessions-"))).create("claude-code");
  s.title = "Fix login";
  s.updatedAt = Date.UTC(2026, 9, 19, 14, 5);
  s.events.push(
    { type: "userMessage", workspace: "main", text: "Why does login loop?", attachments: [{ path: "src/session.ts", kind: "file" }] },
    { type: "text", workspace: "main", delta: "The redirect " },
    { type: "toolCall", workspace: "main", id: "t", name: "read_file", args: "{}" },
    { type: "text", workspace: "main", delta: "runs first." },
    { type: "finished", workspace: "main", reason: "done" },
  );
  assert.equal(
    threadExcerpt(s.events, about(s), 20_000),
    "Conversation: Fix login (Claude Code, in Develop; last active 2026-10-19 14:05 UTC)\nThread handle for read_thread: h-1\n\nUser: Why does login loop? [attached: src/session.ts]\nAssistant: The redirect\n[tool: read_file]\nAssistant: runs first.",
  );
});

test("a long conversation keeps an outline of every turn, its first request, and its newest turns within the limit, and says how to read the rest", () => {
  const s = new SessionStore(mkdtempSync(join(tmpdir(), "kernl-sessions-"))).create("deepagents");
  s.title = "Big refactor";
  for (let i = 1; i <= 40; i++) {
    s.events.push({ type: "userMessage", workspace: "main", text: `request ${i}` }, { type: "text", workspace: "main", delta: `reply ${i} ${"x".repeat(900)}` });
  }
  const text = threadExcerpt(s.events, about(s), 10_000);
  assert.ok(text.length <= 10_000, `${text.length} characters`);
  const outline = /Outline \(40 turns\):\n([\s\S]*?)\n\n/.exec(text)![1].split("\n");
  assert.equal(outline.length, 40, "every turn is in the outline");
  assert.equal(outline[19], "20. request 20");
  assert.match(text, /\n\n1\. User: request 1\n/, "the goal");
  assert.match(text, /\n\n40\. User: request 40\n/, "the newest turn, numbered as in the outline");
  const note = /\[turns 2-(\d+) left out: read them with read_thread \(thread h-1, turns "2-\d+" or a search\)\]/.exec(text);
  assert.ok(note, "how to read the rest");
  assert.match(text, new RegExp(`\\n\\n${Number(note![1]) + 1}\\. User: request ${Number(note![1]) + 1}\\n`), "the turns after the gap are all there");
});

test("read_thread's page: a range or one turn, the turns mentioning all the words, and a note to read on at the limit", () => {
  const texts = Array.from({ length: 12 }, (_, i) => `User: request ${i + 1}${i === 6 ? " about the login redirect" : ""}\nAssistant: ${"y".repeat(1_000)}`);
  assert.match(threadPage(texts, { turns: "4-5" }, 30_000), /^4\. User: request 4\n[\s\S]*\n\n5\. User: request 5\n/);
  assert.ok(!/6\. User/.test(threadPage(texts, { turns: "4-5" }, 30_000)));
  assert.match(threadPage(texts, { search: "LOGIN redirect" }, 30_000), /^7\. User: request 7 about the login redirect/);
  assert.equal(threadPage(texts, { search: "nothing like this" }, 30_000), 'No turn mentions "nothing like this" (the thread has turns 1-12).');
  assert.equal(threadPage(texts, { turns: "x" }, 30_000), 'turns must be a number or a range like "4-9" (the thread has turns 1-12).');
  const limited = threadPage(texts, {}, 3_200);
  assert.match(limited, /\[stopped at the limit: read on from turn 4 of 12\]$/);
  assert.ok(limited.length <= 3_300);
  assert.deepEqual(threadTurns([]), []);
});

test("listing conversations reads only files that are new or changed since the last listing (another window's change included)", async () => {
  const dir = mkdtempSync(join(tmpdir(), "kernl-list-"));
  const store = new SessionStore(dir);
  const records = ["a", "b", "c"].map((t) => {
    const r = store.create("deepagents");
    r.events.push({ type: "userMessage", workspace: "main", text: `talk ${t}` });
    return r;
  });
  for (const r of records) await store.save("ws", r);
  let reads = 0;
  const load = store.load.bind(store);
  store.load = (key: string, id: string) => (reads++, load(key, id));
  assert.equal((await store.list("ws")).length, 3);
  assert.equal(reads, 3, "the first listing reads each file");
  reads = 0;
  await store.list("ws");
  assert.equal(reads, 0, "nothing changed: nothing read");
  // Another window renames a conversation in the same store.
  const other = new SessionStore(dir);
  const changed = (await other.load("ws", records[1].id))!;
  changed.agentTitle = "Renamed elsewhere";
  await new Promise((r) => setTimeout(r, 20));
  await other.save("ws", changed);
  await other.remove("ws", records[2].id);
  const listed = await store.list("ws");
  assert.equal(reads, 1, "only the changed file is read again");
  assert.deepEqual(listed.map((s) => s.title).sort(), ["Renamed elsewhere", "talk a"], "the change shows, the removed one is gone");
});

test("queued messages are kept per workspace with their attachments, don't show up as conversations, and an empty queue removes them", async () => {
  const store = new SessionStore(mkdtempSync(join(tmpdir(), "kernl-queue-")));
  assert.deepEqual(await store.loadQueue("ws1"), []);
  const items = [{ id: "q1", text: "then run the tests", attachments: [{ path: "src/a.ts", kind: "file" as const }] }];
  await store.saveQueue("ws1", items);
  assert.deepEqual(await store.loadQueue("ws1"), items);
  assert.deepEqual(await store.loadQueue("ws2"), [], "per workspace");
  const s = store.create("deepagents");
  s.events.push({ type: "userMessage", workspace: "main", text: "hello" });
  await store.save("ws1", s);
  assert.deepEqual((await store.list("ws1")).map((x) => x.title), ["hello"], "the queue isn't listed as a conversation");
  await store.saveQueue("ws1", []);
  assert.deepEqual(await store.loadQueue("ws1"), []);
  await store.saveQueue("ws1", items);
  await store.clear();
  assert.deepEqual(await store.loadQueue("ws1"), [], "Clear history clears queued messages too");
});

test("a tool's image is saved as a file next to the conversations: raster types only, up to 5 MB, removed with them", async () => {
  const store = new SessionStore(mkdtempSync(join(tmpdir(), "kernl-sessions-")));
  const png = "iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAYAAAAfFcSJAAAADUlEQVR42mNkYPhfDwAChwGA60e6kgAAAABJRU5ErkJggg==";
  const file = await store.savePreview("conv-1", "call/1", { mimeType: "image/png", data: png });
  assert.match(file!, /^conv-1\/call_1-[0-9a-f]{8}\.png$/, "inside the conversation's folder, a safe name");
  assert.deepEqual(readFileSync(join(store.previewsDir, file!)), Buffer.from(png, "base64"));
  assert.equal(await store.savePreview("conv-1", "c2", { mimeType: "image/svg+xml", data: Buffer.from("<svg/>").toString("base64") }), undefined, "an SVG can carry script and links");
  assert.equal(await store.savePreview("conv-1", "c3", { mimeType: "image/png", data: Buffer.alloc(5 * 1024 * 1024 + 1).toString("base64") }), undefined, "over 5 MB");
  assert.equal(await store.savePreview("conv-1", "c4", { mimeType: "image/png", data: "" }), undefined, "empty");
  await store.clear();
  assert.equal(existsSync(join(store.previewsDir, file!)), false, "Delete conversations removes them too");
});

// Saves are queued one at a time per file and written to a temporary file renamed into place
// (SessionStore.write). This doesn't force the interleaving the fix prevents (plain concurrent
// writeFile passes here too); it pins the outcome: the last save wins, whole, and the list reads.
test("many saves of one conversation at once end with the last one, whole, and the list still reads", async () => {
  const store = new SessionStore(mkdtempSync(join(tmpdir(), "kernl-sessions-")));
  const s = store.create("claude-code");
  s.events.push({ type: "userMessage", workspace: "main", text: "first" });
  const saves: Promise<void>[] = [];
  for (let i = 0; i < 30; i++) {
    // Each save has a different length, as the conversation grows between them.
    s.events.push({ type: "text", workspace: "main", delta: "x".repeat(((i * 7919) % 30) * 20_000) });
    saves.push(store.save("ws", s));
  }
  await Promise.all(saves);
  const loaded = await store.load("ws", s.id);
  assert.equal(loaded?.events.length, 31, "the last save wins, whole");
  assert.equal((await store.list("ws")).length, 1, "the conversation list still reads");
});
