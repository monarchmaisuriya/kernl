import { randomUUID } from "node:crypto";
import { mkdir, readdir, readFile, rm, writeFile } from "node:fs/promises";
import { dirname, join } from "node:path";
import type { Attachment, HostToPanel } from "./ui/protocol";

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
}

/** Image types kept as previews: raster only (an SVG can carry script and links), by file extension. */
const PREVIEW_TYPES: Record<string, string> = { "image/png": "png", "image/jpeg": "jpg", "image/gif": "gif", "image/webp": "webp" };
export const PREVIEW_MAX_BYTES = 5 * 1024 * 1024;
const safeName = (s: string) => s.replace(/[^a-zA-Z0-9_-]/g, "_");

export class SessionStore {
  constructor(private dir: string) {}

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
    await writeFile(join(this.folder(workspaceKey), `${s.id}.json`), JSON.stringify(s));
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
      if (s) out.push({ id: s.id, title: s.title, harness: s.harness, updatedAt: s.updatedAt, messages: s.events.filter((e) => e.type === "userMessage").length });
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
    await writeFile(file, JSON.stringify(items));
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

/** A stored conversation as plain text, to attach to a message in another conversation. */
export function transcriptText(s: SessionRecord): string {
  const lines: string[] = [`Conversation: ${s.title}`];
  let reply = "";
  const flush = () => {
    if (reply.trim()) lines.push(`Assistant: ${reply.trim()}`);
    reply = "";
  };
  for (const e of s.events) {
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
