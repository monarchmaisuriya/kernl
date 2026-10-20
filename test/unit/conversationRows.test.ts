// The Conversations view's rows: kernl's conversations first (they never move), then each agent's own
// sessions not opened in kernl, with a row while an agent is still being asked.
import { strict as assert } from "node:assert";
import { test } from "node:test";
import { conversationRows, since } from "../../src/ui/conversationRows";

const now = Date.UTC(2026, 9, 20, 12, 0);
const label = (h: string) => ({ "claude-code": "Claude Code", deepagents: "kernl", codex: "Codex" })[h] ?? h;
const kept = [
  { id: "a", title: "Fix login", harness: "claude-code", updatedAt: now - 2 * 3600_000, messages: 3, agentSessionId: "s-linked" },
  { id: "b", title: "Refactor", harness: "deepagents", updatedAt: now - 5 * 60_000, messages: 1 },
];

test("kernl's conversations come first with their messages, agent, and age; the current one is marked", () => {
  const rows = conversationRows({ kept, current: "b", agents: [], label, now });
  assert.deepEqual(rows, [
    { kind: "new", title: "New conversation" },
    { kind: "kernl", id: "a", title: "Fix login", detail: "3 messages · Claude Code · 2 h ago", current: false, group: "Conversations" },
    { kind: "kernl", id: "b", title: "Refactor", detail: "1 message · kernl · 5 min ago", current: true, group: "Conversations" },
  ]);
});

test("an agent's sessions follow in its own group, without those a kernl conversation already continues; an agent still being asked has a row", () => {
  const rows = conversationRows({
    kept,
    current: "b",
    agents: [
      { id: "claude-code", label: "Claude Code", pending: false, sessions: [{ sessionId: "s-linked", title: "Fix login" }, { sessionId: "s2", title: " Old idea ", updatedAt: new Date(now - 3 * 86_400_000).toISOString() }, { sessionId: "s3" }] },
      { id: "codex", label: "Codex", pending: true },
    ],
    label,
    now,
  });
  assert.deepEqual(rows.slice(3), [
    { kind: "agent", agent: "claude-code", sessionId: "s2", title: "Old idea", detail: "Claude Code session · 3 d ago", group: "Claude Code sessions not opened in kernl" },
    { kind: "agent", agent: "claude-code", sessionId: "s3", title: "Untitled session", detail: "Claude Code session", group: "Claude Code sessions not opened in kernl" },
    { kind: "pending", agent: "codex", title: "Looking for Codex sessions…", group: "Codex sessions not opened in kernl" },
  ]);
});

test("ages read plainly", () => {
  assert.deepEqual([since(now, now), since(now - 59 * 60_000, now), since(now - 47 * 3600_000, now)], ["just now", "59 min ago", "2 d ago"]);
});
