import { randomUUID } from "node:crypto";
import { mkdir, readdir, readFile, rename, rm, writeFile } from "node:fs/promises";
import { dirname, join } from "node:path";
import { type Attachment, type HostToPanel, PREVIEW_TYPES } from "./ui/protocol";

/**
 * Conversations per workspace, kept across window reloads (VS Code's workspace storage).
 * A session holds what the panel showed (so it can be shown again) and what the agent needs to
 * continue: for the kernl agent its message history, for a CLI agent its session id.
 * Everything stored here already went through the redactor (it is what the panel received).
 */
export type TranscriptEvent = Extract<HostToPanel, { workspace: string }>;

export interface SessionRecord {
  id: string;
  title: string;
  harness: string;
  createdAt: number;
  updatedAt: number;
  events: TranscriptEvent[];
  /** kernl agent: LangChain messages (StoredMessage[]); CLI agent: { sessionId }. */
  history?: unknown;
  /** Set on a conversation forked from another; its title says so. */
  forkOf?: string;
  /** A title the agent gave the conversation (ACP session_info_update); preferred over the first message. */
  agentTitle?: string;
  /** A CLI agent's session opened from its own list (started in a terminal or another app): its transcript is the agent's replay, loaded again on each open. */
  importedFrom?: { agent: string; sessionId: string };
}

/** A message waiting for the current run to end (the composer's queue). */
export interface QueuedMessage {
  id: string;
  text: string;
  attachments: Attachment[];
}

export interface SessionSummary {
  id: string;
  title: string;
  harness: string;
  updatedAt: number;
  messages: number;
  /** The CLI agent's session this conversation continues, so the agent's own list shows it once. */
  agentSessionId?: string;
}

export const PREVIEW_MAX_BYTES = 5 * 1024 * 1024;

/**
 * The turns an agent's replay of a session has after `lastUserText` (kernl's last message in its own
 * transcript): what was added in a terminal or another app since. The agent's copy of a message starts
 * with kernl's text (kernl may have added an attachment note). All of the replay when kernl has no
 * message yet; [] when nothing was added; undefined when kernl's message isn't in the replay.
 */
export function turnsAfter(replayed: readonly TranscriptEvent[], lastUserText: string | undefined): TranscriptEvent[] | undefined {
  if (lastUserText === undefined) return [...replayed];
  const mine = lastUserText.trim();
  const isUser = (e: TranscriptEvent): e is Extract<TranscriptEvent, { type: "userMessage" }> => e.type === "userMessage";
  let at = -1;
  replayed.forEach((e, i) => isUser(e) && e.text.trimStart().startsWith(mine) && (at = i));
  if (at < 0) return undefined;
  const next = replayed.findIndex((e, i) => i > at && isUser(e));
  return next < 0 ? [] : replayed.slice(next);
}

/** The most events of an agent's replayed session kept as its transcript; a longer one shows its latest turns. */
export const REPLAY_MAX_EVENTS = 4000;

/**
 * An agent's replay of a stored session as a transcript: each turn ends (finished) before the next user
 * message and at the end, as a live turn does. A replay longer than `max` events keeps its latest turns,
 * from a user message on, with a notice that earlier ones are only in the agent's history.
 */
export function replayTranscript(events: readonly TranscriptEvent[], workspace: string, max = REPLAY_MAX_EVENTS): TranscriptEvent[] {
  const out: TranscriptEvent[] = [];
  const end = () => out.length && out.at(-1)!.type !== "finished" && out.push({ type: "finished", workspace, reason: "done" });
  for (const e of events) {
    if (e.type === "userMessage") end();
    out.push(e);
  }
  end();
  if (out.length <= max) return out;
  const from = out.findIndex((e, i) => e.type === "userMessage" && out.length - i <= max - 1);
  const kept = from < 0 ? out.slice(-(max - 1)) : out.slice(from);
  return [{ type: "notice", workspace, text: "This session is long: showing its latest turns. The agent still has all of it." }, ...kept];
}
const safeName = (s: string) => s.replace(/[^a-zA-Z0-9_-]/g, "_");

export class SessionStore {
  constructor(private dir: string) {}

  /** The write in progress (or last queued) per file. */
  private writes = new Map<string, Promise<void>>();

  /**
   * Writes a file one save at a time, each to a temporary file renamed over the real one. Two saves
   * of a conversation (the end of a run, a preview, New Chat) never interleave, and a reader never
   * sees half a file.
   */
  private write(file: string, data: string | Uint8Array): Promise<void> {
    const next = (this.writes.get(file) ?? Promise.resolve())
      .catch(() => {}) // the earlier save's caller got its own error
      .then(async () => {
        const temporary = `${file}.${randomUUID().slice(0, 8)}.tmp`;
        await writeFile(temporary, data);
        await rename(temporary, file);
      });
    this.writes.set(file, next);
    void next.finally(() => this.writes.get(file) === next && this.writes.delete(file)).catch(() => {});
    return next;
  }

  /**
   * Where tool images are kept, one folder per conversation; the panel may load files from here
   * (and nothing else in this store). Inside the store, so "Delete conversations" removes them too.
   */
  get previewsDir(): string {
    return join(this.dir, "previews");
  }

  /** Saves a tool's image; returns its path under `previewsDir`, or undefined for a type or size that isn't kept. */
  async savePreview(sessionId: string, callId: string, image: { mimeType: string; data: string }): Promise<string | undefined> {
    const ext = PREVIEW_TYPES[image.mimeType.toLowerCase()];
    if (!ext) return undefined;
    const bytes = Buffer.from(image.data, "base64");
    if (!bytes.length || bytes.length > PREVIEW_MAX_BYTES) return undefined;
    const file = `${safeName(sessionId)}/${safeName(callId)}-${randomUUID().slice(0, 8)}.${ext}`;
    await mkdir(join(this.previewsDir, safeName(sessionId)), { recursive: true });
    await writeFile(join(this.previewsDir, file), bytes);
    return file;
  }

  private folder(workspaceKey: string) {
    return join(this.dir, workspaceKey.replace(/[^a-zA-Z0-9_-]/g, "_"));
  }

  create(harness: string): SessionRecord {
    const now = Date.now();
    return { id: randomUUID(), title: "New conversation", harness, createdAt: now, updatedAt: now, events: [] };
  }

  async save(workspaceKey: string, s: SessionRecord): Promise<void> {
    if (!s.events.some((e) => e.type === "userMessage")) return; // empty conversations aren't kept
    const first = s.events.find((e) => e.type === "userMessage") as Extract<TranscriptEvent, { type: "userMessage" }> | undefined;
    const base = s.agentTitle ?? (first ? first.text.replace(/\s+/g, " ").slice(0, 80) : undefined);
    s.title = base ? `${base}${s.forkOf ? " (fork)" : ""}` : s.title;
    s.updatedAt = Date.now();
    await mkdir(this.folder(workspaceKey), { recursive: true });
    await this.write(join(this.folder(workspaceKey), `${s.id}.json`), JSON.stringify(s));
  }

  async load(workspaceKey: string, id: string): Promise<SessionRecord | undefined> {
    try {
      return JSON.parse(await readFile(join(this.folder(workspaceKey), `${id}.json`), "utf8"));
    } catch (err: any) {
      if (err?.code === "ENOENT") return undefined;
      throw err;
    }
  }

  /** Newest first. */
  async list(workspaceKey: string): Promise<SessionSummary[]> {
    let names: string[] = [];
    try {
      names = (await readdir(this.folder(workspaceKey))).filter((n) => n.endsWith(".json"));
    } catch (err: any) {
      if (err?.code !== "ENOENT") throw err;
    }
    const out: SessionSummary[] = [];
    for (const n of names) {
      const s = await this.load(workspaceKey, n.slice(0, -5));
      if (!s) continue;
      const agentSessionId = s.importedFrom?.sessionId ?? (s.history as { sessionId?: unknown } | undefined)?.sessionId;
      out.push({ id: s.id, title: s.title, harness: s.harness, updatedAt: s.updatedAt, messages: s.events.filter((e) => e.type === "userMessage").length, ...(typeof agentSessionId === "string" ? { agentSessionId } : {}) });
    }
    return out.sort((a, b) => b.updatedAt - a.updatedAt);
  }

  async remove(workspaceKey: string, id: string): Promise<void> {
    await rm(join(this.folder(workspaceKey), `${id}.json`), { force: true });
  }

  private queueFile(workspaceKey: string) {
    return join(this.dir, "queues", `${workspaceKey.replace(/[^a-zA-Z0-9_-]/g, "_")}.json`);
  }

  /** The workspace's queued messages, kept so a window reload doesn't lose them; an empty queue removes the file. */
  async saveQueue(workspaceKey: string, items: readonly QueuedMessage[]): Promise<void> {
    const file = this.queueFile(workspaceKey);
    if (!items.length) return rm(file, { force: true });
    await mkdir(dirname(file), { recursive: true });
    await this.write(file, JSON.stringify(items));
  }

  async loadQueue(workspaceKey: string): Promise<QueuedMessage[]> {
    try {
      return JSON.parse(await readFile(this.queueFile(workspaceKey), "utf8"));
    } catch (err: any) {
      if (err?.code === "ENOENT") return [];
      throw err;
    }
  }

  async clear(): Promise<void> {
    await rm(this.dir, { recursive: true, force: true });
  }
}

/**
 * The kernl agent's stored history up to (not including) the user's `turn`-th message
 * (0-based), so a cut-back conversation continues from there. Other harnesses' history (a CLI
 * session id) can't be cut and is dropped: the agent starts a new session.
 */
export function cutHistory(history: unknown, turn: number): unknown {
  if (!Array.isArray(history)) return undefined;
  let humans = 0;
  for (let i = 0; i < history.length; i++) {
    if ((history[i] as { type?: string })?.type === "human" && humans++ === turn) return history.slice(0, i);
  }
  return history;
}

/** One turn of a stored conversation as plain text: the user's message, then the reply, tool calls, and errors. */
function turnText(events: readonly TranscriptEvent[]): string {
  const lines: string[] = [];
  let reply = "";
  const flush = () => {
    if (reply.trim()) lines.push(`Assistant: ${reply.trim()}`);
    reply = "";
  };
  for (const e of events) {
    if (e.type === "text") reply += e.delta;
    else {
      flush();
      if (e.type === "userMessage") lines.push(`User: ${e.text}${e.attachments?.length ? ` [attached: ${e.attachments.map((a) => a.path).join(", ")}]` : ""}`);
      else if (e.type === "toolCall") lines.push(`[tool: ${e.name}]`);
      else if (e.type === "finished" && e.reason === "error") lines.push(`[error: ${e.message ?? ""}]`);
    }
  }
  flush();
  return lines.join("\n");
}

/**
 * A stored conversation as text for an agent in another conversation (any agent, any provider: the
 * transcript has one shape whatever ran it). Within `max` characters: a header, the first turn (what
 * the conversation set out to do), then the newest turns that fit, saying how many in between were
 * left out; a newest turn too long to fit keeps its end.
 */
export function threadExcerpt(s: SessionRecord, about: { agent: string; workspace: string }, max: number): string {
  const turns: TranscriptEvent[][] = [];
  for (const e of s.events) {
    if (e.type === "userMessage" || !turns.length) turns.push([]);
    turns[turns.length - 1].push(e);
  }
  const texts = turns.map(turnText).filter(Boolean);
  const head = `Conversation: ${s.title} (${about.agent}, in ${about.workspace}; last active ${new Date(s.updatedAt).toISOString().slice(0, 16).replace("T", " ")} UTC)`;
  if (!texts.length) return `${head}\n(no messages)`;
  const cut = (text: string, room: number, keep: "start" | "end") => {
    if (text.length <= room) return text;
    const marker = keep === "start" ? "\n[...rest of this turn left out]" : "[...start of this turn left out]\n";
    const n = Math.max(0, room - marker.length);
    return keep === "start" ? text.slice(0, n) + marker : marker + text.slice(text.length - n);
  };
  // The first turn gets at most a quarter of the room, so the newest turns always have most of it.
  const first = cut(texts[0], Math.floor(max / 4), "start");
  let room = max - head.length - first.length - 80;
  const newest: string[] = [];
  for (let i = texts.length - 1; i > 0 && room > 0; i--) {
    const text = texts[i].length <= room ? texts[i] : newest.length ? "" : cut(texts[i], room, "end");
    if (!text) break;
    newest.unshift(text);
    room -= text.length + 2;
  }
  const leftOut = texts.length - 1 - newest.length;
  return [head, first, ...(leftOut ? [`[${leftOut} earlier turn${leftOut === 1 ? "" : "s"} left out]`] : []), ...newest].join("\n\n");
}
