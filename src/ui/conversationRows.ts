// The Conversations view's rows, from what the host knows now: kernl's kept conversations (always
// there at once), then each CLI agent's own sessions not opened in kernl, or a row saying the agent is
// still being asked. Pure, so the order and wording are tested without VS Code.

/** One row of the view. `group` titles the rows under it ("Claude Code sessions not opened in kernl"). */
export type ConversationRow =
  | { kind: "new"; title: string }
  | { kind: "kernl"; id: string; title: string; detail: string; current: boolean; group: string }
  | { kind: "agent"; agent: string; sessionId: string; title: string; detail: string; group: string }
  | { kind: "pending"; agent: string; title: string; group: string };

/** What a picked row asks the host to open. */
export type ConversationPick = { kind: "new" } | { kind: "kernl"; id: string } | { kind: "agent"; agent: string; sessionId: string };

export interface KeptConversation {
  id: string;
  title: string;
  harness: string;
  updatedAt: number;
  messages: number;
  /** The CLI agent's session it continues, so that session isn't listed again. */
  agentSessionId?: string;
}

export interface AgentSession {
  sessionId: string;
  title?: string | null;
  updatedAt?: string | null;
}

/** "just now", "12 min ago", "3 h ago", "2 d ago". */
export function since(time: number, now: number): string {
  const m = Math.round((now - time) / 60_000);
  return m < 1 ? "just now" : m < 60 ? `${m} min ago` : m < 1440 ? `${Math.round(m / 60)} h ago` : `${Math.round(m / 1440)} d ago`;
}

export function conversationRows(input: {
  kept: readonly KeptConversation[];
  current: string;
  /** Each ready CLI agent, in order, with its sessions when known; `pending` while it's being asked. */
  agents: readonly { id: string; label: string; sessions?: readonly AgentSession[]; pending: boolean }[];
  label: (harness: string) => string;
  now: number;
}): ConversationRow[] {
  const { kept, current, agents, label, now } = input;
  const rows: ConversationRow[] = [{ kind: "new", title: "New conversation" }];
  for (const s of kept) {
    rows.push({
      kind: "kernl",
      id: s.id,
      title: s.title,
      detail: `${s.messages} message${s.messages === 1 ? "" : "s"} · ${label(s.harness)} · ${since(s.updatedAt, now)}`,
      current: s.id === current,
      group: "Conversations",
    });
  }
  const linked = new Set(kept.map((s) => s.agentSessionId).filter(Boolean));
  for (const a of agents) {
    const group = `${a.label} sessions not opened in kernl`;
    for (const s of a.sessions ?? []) {
      if (linked.has(s.sessionId)) continue;
      const updated = s.updatedAt ? Date.parse(s.updatedAt) : NaN;
      rows.push({
        kind: "agent",
        agent: a.id,
        sessionId: s.sessionId,
        title: s.title?.trim() || "Untitled session",
        detail: [`${a.label} session`, Number.isNaN(updated) ? undefined : since(updated, now)].filter(Boolean).join(" · "),
        group,
      });
    }
    if (a.pending) rows.push({ kind: "pending", agent: a.id, title: `Looking for ${a.label} sessions…`, group });
  }
  return rows;
}
