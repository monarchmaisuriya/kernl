import { type ChildProcess, spawn } from "node:child_process";
import { Readable, Writable } from "node:stream";
import * as acp from "@agentclientprotocol/sdk";
import type { Runner } from "../agent/runner";
import type { SessionEvents } from "../agent/session";
import type { ApprovalGate } from "../gate/approvalGate";
import type { AskMode, Launch } from "./agents";
import { toGateRequest, toPermissionResponse } from "./permission";
import { lookupKind } from "./readOnlyCommand";
import { join } from "node:path";
import { pathToFileURL } from "node:url";
import { KERNL_SERVER_NAME } from "../mcp/kernlServer";
import { cleanTerminalOutput } from "../terminal/output";
import { type AgentOptionView, type Attachment, attachmentNote, type ToolInfo } from "../ui/protocol";
import { chipOptions, nextRemembered, wireValue } from "./agentOptions";
import { browserRowTitle, describeBrowserCall } from "../browser/describe";

export interface AcpRunnerOptions {
  agentLabel: string;
  launch: Launch;
  /** The permission mode to put each session in (read when a session starts and on applyMode). */
  mode: () => AskMode;
  cwd: string;
  gate: ApprovalGate;
  events: SessionEvents;
  /** Called on Stop so the panel withdraws open cards (denies pending approvals). */
  onStop?: () => void;
  log?: (line: string) => void;
  /** A one-line note for the transcript (e.g. an earlier conversation couldn't be reloaded). */
  notice?: (text: string) => void;
  /** Read for every new, loaded, and forked session: MCP servers to give the agent (kernl's tools) and the agent's own session options (`_meta`). */
  sessionSetup?: () => Promise<SessionSetup>;
  /** A command the agent ran in its own shell (Codex), as its output streams: shown in a kernl terminal. */
  commandOutput?: (event: CommandOutputEvent) => void;
  /** What a run learned about the agent's connections: a login it needs, its login status, an MCP server that failed to start, a run that worked. */
  connection?: (signal: ConnectionSignal) => void;
  /** How to log the agent in, said when it answers "authentication required" ("Run `claude auth login` in a terminal"). */
  loginHint?: string;
  /**
   * Whether the agent's own permission request for one of kernl's tools is shown as a card (Auto mode:
   * the agent decides, and kernl's tool doesn't ask again). Otherwise it's answered yes, because kernl's
   * tool asks through kernl's gate itself.
   */
  agentDecidesKernlTools?: () => boolean;
  /** The user's model, thinking, and fast-mode choices for this agent (option id -> value), applied to each new session before its first message. */
  rememberedOptions?: () => Readonly<Record<string, string | boolean>>;
}

/** ACP's "authentication required" (RequestError.authRequired): the agent can't run until the user logs in. */
export const AUTH_REQUIRED = -32000;

export type ConnectionSignal =
  | { type: "authRequired"; message: string }
  /** The adapter's `_auth/status_update` (claude-agent-acp, codex-acp): kind none, account, api_key, gateway, or external. */
  | { type: "authStatus"; kind: string; label?: string }
  /** codex-acp's `mcp__<server>__startup` tool call that failed. */
  | { type: "mcpStartupFailed"; server: string; error: string }
  | { type: "runSucceeded" };

export interface SessionSetup {
  mcpServers: acp.McpServer[];
  meta?: Record<string, unknown>;
}

/** One step of a command an agent runs itself: its start (command, folder), more output, or its end. */
export interface CommandOutputEvent {
  id: string;
  command?: string;
  cwd?: string;
  data?: string;
  exitCode?: number | null;
}

/**
 * Whether a tool call is one of kernl's own tools (Claude Code `mcp__kernl__x`, Codex `mcp.kernl.x`,
 * OpenCode `kernl_x`). Those ask through kernl's gate themselves, so the agent's own permission
 * request for them is answered without a second card.
 */
export function isKernlTool(name: string | undefined): boolean {
  if (!name) return false;
  const n = KERNL_SERVER_NAME;
  return name.startsWith(`mcp__${n}__`) || name.startsWith(`mcp.${n}.`) || name.startsWith(`${n}_`);
}

/** The session could not be confirmed to ask before every action; nothing was sent. */
class AskModeRefusal extends Error {}

const textOf = (content: any): string => (content?.type === "text" ? String(content.text ?? "") : content?.type === "content" ? textOf(content.content) : "");

/** One tool call as it changes (ACP sends the call, then partial updates that change only some fields). */
interface CallState {
  title: string;
  kind?: string;
  status: string;
  locations?: { path: string; line?: number }[];
  rawInput: unknown;
  diff?: { path: string; before: string | null; after: string };
  /** Completed or failed, and its result reported. Kept: an agent can still update it afterwards. */
  ended?: boolean;
  /** Output the agent streamed for a command it ran itself (Codex's terminal_output_delta). */
  output?: string;
  /** The agent's own name for the tool, when it sends one (Claude Code: `mcp__kernl__run_in_terminal`). */
  toolName?: string;
  /** The kernl tool this call is, by its name in any agent's form (kept when the row gets a plain-words title). */
  kernlTool?: string;
}

/**
 * An execute call's command and the agent's own description of it. A leading `cd <folder> &&` (or
 * `;`) into the session's folder changes nothing, so it's dropped; a `cd` anywhere else stays. A
 * command that only reads or searches is marked as a lookup (see readOnlyCommand.ts).
 */
export function describeCommand(rawInput: unknown, cwd: string): Pick<ToolInfo, "command" | "description" | "lookup"> {
  const input = rawInput && typeof rawInput === "object" ? (rawInput as Record<string, unknown>) : {};
  const text = (v: unknown) => (typeof v === "string" && v.trim() ? v.trim() : undefined);
  const description = text(input.description) ?? text(input.command_description);
  let command = text(input.command);
  const cd = command && /^cd\s+(?:"([^"]+)"|'([^']+)'|(\S+))\s*(?:&&|;)\s*/.exec(command);
  const folder = (path: string) => path.replace(/\/+$/, "");
  if (cd && folder(cd[1] ?? cd[2] ?? cd[3]) === folder(cwd)) command = command!.slice(cd[0].length) || command;
  const lookup = command ? lookupKind(command) : undefined;
  return { ...(command ? { command } : {}), ...(description ? { description } : {}), ...(lookup ? { lookup } : {}) };
}

/**
 * Agents built for Markdown clients wrap a tool's output in a code fence (Claude Code: ```console
 * around a command's output, ``` around a file). kernl shows output as plain text, so one fence
 * around the whole text is removed; any other text is left as it is.
 */
export function unfenced(text: string): string {
  const fenced = /^(`{3,})[^\n`]*\n([\s\S]*?)\n?\1\s*$/.exec(text);
  return fenced ? fenced[2] : text;
}

/** Lines added and removed between two texts (multiset count: fast, and exact for the totals shown). */
export function diffSize(before: string | null, after: string): { added: number; removed: number } {
  const old = new Map<string, number>();
  for (const line of (before ?? "").split("\n")) if (before !== null) old.set(line, (old.get(line) ?? 0) + 1);
  let added = 0;
  for (const line of after.split("\n")) {
    const n = old.get(line) ?? 0;
    if (n > 0) old.set(line, n - 1);
    else added++;
  }
  let removed = 0;
  for (const n of old.values()) removed += n;
  return { added, removed };
}

/**
 * Runs an external coding agent (Claude Code, Codex, OpenCode) over ACP as a subprocess.
 * Every permission request goes to the shared ApprovalGate. The session must be confirmed to
 * be in its ask-everything mode before any prompt is sent; if it cannot be, nothing runs.
 */
export class AcpRunner implements Runner {
  private child: ChildProcess | undefined;
  private connection: acp.ClientSideConnection | undefined;
  private connecting: Promise<acp.ClientSideConnection> | undefined;
  private sessionId: string | undefined;
  private stderrTail = "";
  private active: { stopped: boolean } | undefined;
  /** Resolves with why the current agent process ended; never rejects. */
  private exitReason: Promise<string> | undefined;
  /**
   * A stored session to load on the next send, and whether its replayed history is arriving now:
   * dropped when the panel already shows it (kernl's own conversation), shown when it doesn't (a
   * session opened from the agent's list).
   */
  private resumeId: string | undefined;
  private replaying: false | "drop" | "show" = false;
  /** The previous session's close; the next session waits for it, so the agent never holds both. */
  private closing: Promise<void> | undefined;
  private agentCapabilities: acp.AgentCapabilities | undefined;
  /** The current session's modes (for agents that use session modes rather than config options). */
  private sessionModes: acp.NewSessionResponse["modes"];
  /** The current session's model, thinking, and fast-mode chips, as last reported. */
  private options: AgentOptionView[] = [];
  /** A session being opened before any message (prepare); a send waits for it rather than opening a second one. */
  private preparing: Promise<string | undefined> | undefined;
  /** Counts conversation changes (newThread), so a session opened for an earlier one is closed instead of kept. */
  private generation = 0;
  private loggedUnknown = new Set<string>();
  /** Tool calls of the current session, merged as updates arrive. */
  private calls = new Map<string, CallState>();

  constructor(private o: AcpRunnerOptions) {}

  get running() {
    return this.active !== undefined;
  }

  async send(text: string, attachments: readonly Attachment[] = []): Promise<void> {
    if (this.active) throw new Error("A run is already in progress; press Stop first");
    const run = { stopped: false as boolean };
    this.active = run;
    try {
      const conn = await this.connect();
      await this.preparing;
      const sessionId = await this.ensureSession(conn);
      if (run.stopped) return this.o.events.finished("stopped");
      // resource_link is the one attachment form every ACP agent must accept; the text lists them too.
      const links = attachments.filter((a) => a.kind === "file" || a.kind === "folder").map((a) => ({ type: "resource_link" as const, uri: pathToFileURL(join(this.o.cwd, a.path)).href, name: a.path }));
      const result = await conn.prompt({ sessionId, prompt: [{ type: "text", text: text + attachmentNote(attachments) }, ...links] });
      // Only our own Stop means "stopped": some agents (OpenCode) end the turn as "cancelled"
      // after the user rejects a permission request, which is a finished turn, not a Stop.
      if (result.stopReason === "cancelled" && !run.stopped) this.o.log?.(`${this.o.agentLabel}: turn ended as cancelled after a rejection`);
      if (!run.stopped) this.o.connection?.({ type: "runSucceeded" });
      this.o.events.finished(run.stopped ? "stopped" : "done");
    } catch (err: any) {
      if (run.stopped) this.o.events.finished("stopped");
      else if (err?.code === AUTH_REQUIRED) {
        const message = String(err?.message ?? "Authentication required");
        this.o.connection?.({ type: "authRequired", message });
        this.o.events.finished("error", `${this.o.agentLabel} needs you to log in (${message}).${this.o.loginHint ? ` ${this.o.loginHint}` : ""}`);
      } else this.o.events.finished("error", (await this.crashCause(err)) ?? `${this.o.agentLabel}: ${err?.message ?? String(err)}`);
    } finally {
      this.active = undefined;
    }
  }

  stop() {
    if (!this.active) return;
    this.active.stopped = true;
    this.o.onStop?.();
    if (this.connection && this.sessionId) void this.connection.cancel({ sessionId: this.sessionId }).catch(() => {});
  }

  /**
   * Ends the conversation: the agent's previous session is closed so a long-lived adapter does not
   * keep it. With `history` ({ sessionId } from exportHistory), the next send asks the agent to load
   * that session instead, if it can (ACP session/load); otherwise it starts fresh and says so.
   */
  newThread(history?: unknown) {
    this.stop();
    this.generation++;
    const previous = this.sessionId;
    this.sessionId = undefined;
    this.calls.clear();
    const id = (history as { sessionId?: unknown } | undefined)?.sessionId;
    this.resumeId = typeof id === "string" ? id : undefined;
    if (previous && this.connection) {
      this.closing = this.connection.closeSession({ sessionId: previous }).then(
        () => {},
        (e: any) => this.o.log?.(`${this.o.agentLabel}: could not close session ${previous}: ${e?.message ?? e}`),
      );
    }
  }

  async exportHistory(): Promise<unknown> {
    return this.sessionId ? { sessionId: this.sessionId } : undefined;
  }

  /** ACP session/fork (unstable): a copy of the whole session; this runner continues in the copy. */
  async forkSession(): Promise<unknown> {
    if (this.active) throw new Error("Stop the agent before forking.");
    if (!this.connection || !this.sessionId || !this.agentCapabilities?.sessionCapabilities?.fork) return undefined;
    const setup = await this.setup();
    const forked = await this.connection.unstable_forkSession({ sessionId: this.sessionId, cwd: this.o.cwd, mcpServers: setup.mcpServers, ...(setup.meta ? { _meta: setup.meta } : {}) });
    this.reportOptions(forked.configOptions);
    await this.forceMode(this.connection, forked as unknown as acp.NewSessionResponse);
    this.sessionId = forked.sessionId;
    return { sessionId: forked.sessionId };
  }

  dispose() {
    this.stop();
    this.child?.kill();
    this.child = undefined;
    this.connection = undefined;
    this.connecting = undefined;
    this.sessionId = undefined;
  }

  /**
   * Why the agent process died, for transport failures only. Our own refusal and a JSON-RPC error
   * from a live agent (numeric code) mean the agent is alive: nothing to wait for. Otherwise the
   * stream closes a moment before the process reports its exit, so wait briefly for the cause.
   */
  private crashCause(err: unknown): Promise<string | undefined> {
    if (!this.exitReason || err instanceof AskModeRefusal || typeof (err as any)?.code === "number") return Promise.resolve(undefined);
    return Promise.race([this.exitReason, new Promise<undefined>((r) => setTimeout(() => r(undefined), 1_000))]);
  }

  private connect(): Promise<acp.ClientSideConnection> {
    if (this.connection) return Promise.resolve(this.connection);
    this.connecting ??= this.spawnAndInitialize().finally(() => (this.connecting = undefined));
    return this.connecting;
  }

  private async spawnAndInitialize(): Promise<acp.ClientSideConnection> {
    const { command, args, env } = this.o.launch;
    const child = spawn(command, args, { cwd: this.o.cwd, env: { ...process.env, ...env }, stdio: ["pipe", "pipe", "pipe"] });
    this.child = child;
    this.stderrTail = "";
    child.stderr!.on("data", (d) => (this.stderrTail = (this.stderrTail + String(d)).slice(-4096)));
    const exitReason = new Promise<string>((resolve) => {
      const ended = (why: string) => {
        const last = this.stderrTail.trim().split("\n").pop() ?? "";
        if (this.child === child) {
          this.connection = undefined;
          this.sessionId = undefined;
        }
        resolve(`${this.o.agentLabel} stopped (${why})${last ? `: ${last}` : ""}`);
      };
      child.once("error", (e) => ended(`could not start '${command}': ${e.message}`));
      child.once("exit", (code, signal) => ended(signal ? `signal ${signal}` : `exit code ${code}`));
    });
    this.exitReason = exitReason;
    const stream = acp.ndJsonStream(Writable.toWeb(child.stdin!) as WritableStream<Uint8Array>, Readable.toWeb(child.stdout!) as ReadableStream<Uint8Array>);
    const connection = new acp.ClientSideConnection(() => this.client(), stream);
    const init = await Promise.race([
      // terminal_output_delta: an agent that runs commands in its own shell (Codex) streams their output to us.
      // session.configOptions.boolean: fast mode arrives as an on/off switch rather than an "on"/"off" select.
      connection.initialize({ protocolVersion: acp.PROTOCOL_VERSION, clientCapabilities: { fs: { readTextFile: false, writeTextFile: false }, terminal: false, session: { configOptions: { boolean: {} } }, _meta: { terminal_output_delta: true } } }),
      exitReason.then((message) => Promise.reject(new Error(message))),
    ]);
    this.agentCapabilities = init.agentCapabilities;
    this.connection = connection;
    return connection;
  }

  /** The servers and options for a session; an HTTP server is left out (with a log line) when the agent can't reach HTTP MCP servers. */
  private async setup(): Promise<SessionSetup> {
    const setup = (await this.o.sessionSetup?.()) ?? { mcpServers: [] };
    if (this.agentCapabilities?.mcpCapabilities?.http) return setup;
    const isHttp = (s: acp.McpServer) => "type" in s && s.type === "http";
    const http = setup.mcpServers.filter(isHttp);
    if (http.length) this.o.log?.(`${this.o.agentLabel}: can't use HTTP MCP servers; not given ${http.map((s) => s.name).join(", ")}`);
    return { ...setup, mcpServers: setup.mcpServers.filter((s) => !isHttp(s)) };
  }

  /**
   * Opens the session now, before any message, so the agent reports its model, thinking, and fast
   * options and they can be chosen first; the first send uses this session. Returns why it couldn't
   * (the first send then tries again and reports it). A prepare already running is shared.
   */
  prepare(): Promise<string | undefined> {
    if (this.active || this.sessionId) return Promise.resolve(undefined);
    this.preparing ??= (async () => {
      try {
        await this.ensureSession(await this.connect());
        return undefined;
      } catch (err: any) {
        return String(err?.message ?? err);
      } finally {
        this.preparing = undefined;
      }
    })();
    return this.preparing;
  }

  /** Opens a session if needed and confirms its ask mode before anything is sent. */
  private async ensureSession(conn: acp.ClientSideConnection): Promise<string> {
    if (this.sessionId) return this.sessionId;
    const generation = this.generation;
    const id = await this.openSession(conn);
    if (generation !== this.generation) {
      // The conversation changed while this session opened (New chat during a prepare): it belongs to no one.
      // Its close is the one the next session waits for, so the agent never holds both.
      this.sessionId = undefined;
      this.closing = conn.closeSession({ sessionId: id }).then(
        () => {},
        (e: any) => this.o.log?.(`${this.o.agentLabel}: could not close session ${id}: ${e?.message ?? e}`),
      );
      return this.ensureSession(conn);
    }
    return id;
  }

  private async openSession(conn: acp.ClientSideConnection): Promise<string> {
    await this.closing;
    this.closing = undefined;
    const resumeId = this.resumeId;
    this.resumeId = undefined;
    if (resumeId && this.agentCapabilities?.loadSession) {
      // The agent replays the old conversation as updates; the panel already shows it, so they're dropped.
      const failed = await this.load(conn, resumeId, "drop");
      if (!failed) return resumeId;
      this.o.notice?.(`${this.o.agentLabel} couldn't reload the earlier conversation; this message starts a new one.`);
    } else if (resumeId) {
      this.o.notice?.(`${this.o.agentLabel} can't reload earlier conversations; this message starts a new one.`);
    }
    const setup = await this.setup();
    const session = await conn.newSession({ cwd: this.o.cwd, mcpServers: setup.mcpServers, ...(setup.meta ? { _meta: setup.meta } : {}) });
    this.reportOptions(session.configOptions);
    // Before the mode: a model change can change which modes the agent allows (Claude Code clamps it).
    await this.applyRemembered(conn, session.sessionId);
    await this.forceMode(conn, session);
    this.sessionId = session.sessionId;
    return session.sessionId;
  }

  /** ACP session/load: the agent replays the session's history (dropped or shown) and continues it. Returns why it failed, or undefined. */
  private async load(conn: acp.ClientSideConnection, sessionId: string, replay: "drop" | "show"): Promise<string | undefined> {
    this.replaying = replay;
    try {
      const setup = await this.setup();
      const loaded = await conn.loadSession({ sessionId, cwd: this.o.cwd, mcpServers: setup.mcpServers, ...(setup.meta ? { _meta: setup.meta } : {}) });
      this.reportOptions(loaded.configOptions);
      await this.forceMode(conn, { ...loaded, sessionId } as acp.NewSessionResponse);
      this.sessionId = sessionId;
      return undefined;
    } catch (err: any) {
      if (err instanceof AskModeRefusal) throw err;
      this.o.log?.(`${this.o.agentLabel}: could not load session ${sessionId}: ${err?.message ?? err}`);
      return String(err?.message ?? err);
    } finally {
      this.replaying = false;
    }
  }

  /**
   * Loads the session newThread() named now, showing the agent's replay of its history: a session
   * opened from the agent's own list, which the panel has no transcript for. Returns why it couldn't
   * (the agent can't load sessions, or the load failed); the next send then starts a new session.
   */
  async loadNow(): Promise<string | undefined> {
    if (this.active) return "the agent is running";
    const conn = await this.connect();
    const id = this.resumeId;
    if (!id) return "no session to load";
    this.resumeId = undefined;
    if (!this.agentCapabilities?.loadSession) return `${this.o.agentLabel} can't load stored sessions`;
    await this.closing;
    this.closing = undefined;
    return this.load(conn, id, "show");
  }

  /**
   * The agent's stored sessions for this folder (ACP session/list), newest first as the agent sends
   * them; undefined when it can't list. Pages are followed up to `maxSessions` (Codex filters a page
   * by folder after fetching it, so a page can be short or empty while more follow).
   */
  async listSessions(maxSessions = 500): Promise<acp.SessionInfo[] | undefined> {
    const conn = await this.connect();
    if (!this.agentCapabilities?.sessionCapabilities?.list) return undefined;
    const out: acp.SessionInfo[] = [];
    let cursor: string | undefined;
    for (let page = 0; page < 50 && out.length < maxSessions; page++) {
      const res = await conn.listSessions({ cwd: this.o.cwd, ...(cursor ? { cursor } : {}) });
      out.push(...res.sessions);
      cursor = res.nextCursor ?? undefined;
      if (!cursor) break;
    }
    return out.slice(0, maxSessions);
  }

  /** Whether the agent's text is shown now: during a run that wasn't stopped (late text after Stop is dropped), or a shown replay. */
  private streaming() {
    return (this.active !== undefined && !this.active.stopped) || this.replaying === "show";
  }

  /** Keeps the session's chips and tells the workspace; a reply or update without options changes nothing. */
  private reportOptions(list: readonly acp.SessionConfigOption[] | null | undefined) {
    if (!list) return;
    this.options = chipOptions(list);
    this.o.events.agentOptions?.(this.options);
  }

  /** The user's remembered choices, applied in order (model first); one the agent no longer offers is skipped, one it refuses is logged. */
  private async applyRemembered(conn: acp.ClientSideConnection, sessionId: string) {
    const remembered = this.o.rememberedOptions?.() ?? {};
    const done = new Set<string>();
    for (let next = nextRemembered(this.options, remembered, done); next; next = nextRemembered(this.options, remembered, done)) {
      done.add(next.option.id);
      try {
        await this.sendOption(conn, sessionId, next.option, next.value);
      } catch (err: any) {
        this.o.log?.(`${this.o.agentLabel}: couldn't apply the remembered ${next.option.name} (${String(next.value)}): ${err?.message ?? err}`);
      }
    }
  }

  private async sendOption(conn: acp.ClientSideConnection, sessionId: string, option: AgentOptionView, value: string | boolean) {
    const wire = wireValue(option, value);
    const req = wire.boolean ? { sessionId, configId: option.id, type: "boolean" as const, value: wire.value as boolean } : { sessionId, configId: option.id, value: wire.value as string };
    const res = await conn.setSessionConfigOption(req);
    this.reportOptions(res.configOptions);
  }

  /**
   * Sets one of the live session's chips (model, thinking, fast) and reports the agent's new options
   * (a model change rebuilds the others). False when there's no session yet: the choice is applied to
   * the next one (rememberedOptions).
   */
  async setOption(id: string, value: string | boolean): Promise<boolean> {
    const option = this.options.find((o) => o.id === id);
    if (!this.connection || !this.sessionId || !option) return false;
    await this.sendOption(this.connection, this.sessionId, option, value);
    return true;
  }

  /**
   * Puts the live session into the current permission mode now (the user changed it). With no
   * session yet, the next session gets it. Throws when the agent doesn't confirm it.
   */
  async applyMode(): Promise<void> {
    if (!this.connection || !this.sessionId) return;
    await this.forceMode(this.connection, { sessionId: this.sessionId, modes: this.sessionModes } as acp.NewSessionResponse);
  }

  /** Sets the session's permission mode and confirms it from the agent's reply; nothing is sent to an unconfirmed session. */
  private async forceMode(conn: acp.ClientSideConnection, session: acp.NewSessionResponse) {
    const mode = this.o.mode();
    this.sessionModes = session.modes ?? this.sessionModes;
    const refuse = (why: string) => {
      throw new AskModeRefusal(`refusing to run: could not confirm its permission mode (${why})`);
    };
    if (mode.kind === "environment") return;
    if (mode.kind === "configOption" || mode.kind === "configOptions") {
      for (const { optionId, value } of mode.kind === "configOption" ? [mode] : mode.options) {
        const set = async () => {
          const res = await conn.setSessionConfigOption({ sessionId: session.sessionId, configId: optionId, value });
          this.reportOptions(res.configOptions);
          return ((res.configOptions ?? []).find((o: any) => o.id === optionId) as any)?.currentValue;
        };
        // OpenCode 2.0.27 replies with the previous value when leaving its plan mode; setting it again
        // returns the current one. Anything still unconfirmed after that is refused.
        let now = await set();
        if (now !== value) now = await set();
        if (now !== value) refuse(`${optionId} is '${now ?? "missing"}', expected '${value}'`);
      }
      return;
    }
    const available = (session.modes?.availableModes ?? []).map((m) => m.id);
    if (!available.includes(mode.modeId)) refuse(`mode '${mode.modeId}' not offered; available: ${available.join(", ") || "none"}`);
    if (session.modes?.currentModeId !== mode.modeId) {
      const confirmed = this.waitForMode(session.sessionId, mode.modeId, 3_000);
      await conn.setSessionMode({ sessionId: session.sessionId, modeId: mode.modeId });
      if (!(await confirmed)) refuse(`mode change to '${mode.modeId}' was not confirmed`);
    }
  }

  private modeWaiters: Array<(sessionId: string, modeId: string) => void> = [];
  private waitForMode(sessionId: string, modeId: string, timeoutMs: number): Promise<boolean> {
    return new Promise((resolve) => {
      const timer = setTimeout(() => done(false), timeoutMs);
      const waiter = (s: string, m: string) => s === sessionId && m === modeId && done(true);
      const done = (ok: boolean) => {
        clearTimeout(timer);
        this.modeWaiters = this.modeWaiters.filter((w) => w !== waiter);
        resolve(ok);
      };
      this.modeWaiters.push(waiter);
    });
  }

  /**
   * A tool call and its updates, merged into one state per id: the panel row shows its status
   * (pending, running) and kind, its files, and an edit's size; completion or failure ends it with
   * its output. An update carries only what changed.
   */
  private toolCallUpdate(u: any) {
    const id = String(u.toolCallId);
    const call = this.calls.get(id) ?? { title: "tool", status: "pending", rawInput: {} };
    // A call stays known after it ends: Claude Code's post-tool hook can update it after the result
    // (claude-agent-acp renderer.hookResult), and that must not turn it back into a blank, pending row.
    const ended = call.ended === true;
    if (u.title) call.title = String(u.title);
    else if (!this.calls.has(id) && u.kind) call.title = String(u.kind);
    if (u.kind) call.kind = String(u.kind);
    if (u.status && !ended) call.status = String(u.status);
    if (Array.isArray(u.locations)) call.locations = u.locations.filter((l: any) => l?.path).map((l: any) => ({ path: String(l.path), line: typeof l.line === "number" ? l.line : undefined }));
    if (u.rawInput !== undefined) call.rawInput = u.rawInput;
    // codex-acp reports an MCP server that failed to start as a tool call `mcp__<server>__startup`.
    const startup = /^mcp__(.+)__startup$/.exec(call.title);
    if (startup && u.status === "failed") {
      const error = (u.content ?? []).map((c: any) => textOf(c)).filter(Boolean).join(" ").replace(/^\[codex-acp forwarded startup error\]\s*/, "");
      this.o.connection?.({ type: "mcpStartupFailed", server: startup[1], error: error || "failed to start" });
    }
    if (typeof u._meta?.claudeCode?.toolName === "string") call.toolName = u._meta.claudeCode.toolName;
    // kernl's own terminal tools are commands: the row shows the command like the agent's own shell.
    if ([call.toolName, call.title].some((n) => isKernlTool(n) && /(run_in_terminal|start_background_job)$/.test(n!))) call.kind = "execute";
    call.kernlTool ??= [call.toolName, call.title].find(isKernlTool);
    // kernl's browser tools in plain words ("Browser: open developers.brevo.com"), not the agent's MCP title.
    const browser = call.kernlTool ? describeBrowserCall(call.kernlTool, call.rawInput) : undefined;
    if (browser) call.title = browserRowTitle(browser);
    // An old command in a shown replay isn't run again: no terminal for it.
    if (!this.replaying) this.commandOutput(id, call, u._meta);
    const diff = (u.content ?? []).find((c: any) => c?.type === "diff");
    if (diff) call.diff = { path: String(diff.path), before: diff.oldText ?? null, after: String(diff.newText ?? "") };
    this.calls.set(id, call);
    if (call.diff) this.o.events.toolDiff?.(id, call.diff);
    const info: ToolInfo = {
      kind: call.kind,
      // Completed or failed: no in-flight status; the result that follows ends the row.
      status: call.status === "in_progress" ? "running" : call.status === "pending" ? "pending" : undefined,
      locations: call.locations,
      diff: call.diff ? { path: call.diff.path, ...diffSize(call.diff.before, call.diff.after) } : undefined,
      ...(call.kind === "execute" ? describeCommand(call.rawInput, this.o.cwd) : {}),
    };
    this.o.events.toolCall(id, call.title, call.rawInput ?? {}, info);
    if (!ended && (call.status === "completed" || call.status === "failed")) {
      // A command's output may have come only as streamed chunks (Codex): then that is the result.
      const out = (u.content ?? []).map((c: any) => unfenced(textOf(c))).filter(Boolean).join("\n") || (call.output ? cleanTerminalOutput(call.output).text : "");
      // A read image (or any image a tool returns) comes as an ACP image block: base64 and its type.
      const images = (u.content ?? [])
        .map((c: any) => (c?.type === "content" ? c.content : c))
        .filter((b: any) => b?.type === "image" && typeof b.data === "string" && typeof b.mimeType === "string");
      // With an image, the preview is the output: no "completed" stand-in text.
      this.o.events.toolResult(id, call.title, out || (images.length ? "" : call.status), call.status === "failed");
      for (const b of images) this.o.events.toolImage?.(id, { mimeType: b.mimeType, data: b.data });
      call.ended = true;
    }
  }

  /** Codex's `_meta` on a command it runs itself: terminal_info (start), terminal_output_delta (output), terminal_exit (end). */
  private commandOutput(id: string, call: CallState, meta: any) {
    if (!meta || typeof meta !== "object") return;
    const info = meta.terminal_info;
    const delta = meta.terminal_output_delta;
    const exit = meta.terminal_exit;
    if (!info && !delta && !exit) return;
    if (typeof delta?.data === "string") call.output = (call.output ?? "") + delta.data;
    const command = describeCommand(call.rawInput, this.o.cwd).command;
    this.o.commandOutput?.({
      id,
      ...(info ? { command, cwd: typeof info.cwd === "string" ? info.cwd : undefined } : {}),
      ...(typeof delta?.data === "string" ? { data: delta.data } : {}),
      ...(exit ? { exitCode: typeof exit.exit_code === "number" ? exit.exit_code : null } : {}),
    });
  }

  private client(): acp.Client {
    return {
      requestPermission: async (params) => {
        const run = this.active;
        if (!run || run.stopped) return toPermissionResponse(params.options, false, true);
        const call = params.toolCall as any;
        const known = this.calls.get(String(call.toolCallId));
        const kernlTool = [call._meta?.claudeCode?.toolName, known?.kernlTool, known?.toolName, known?.title, call.title].some(isKernlTool);
        if (kernlTool && !this.o.agentDecidesKernlTools?.()) return toPermissionResponse(params.options, true, false);
        const decision = await this.o.gate.decide(toGateRequest(this.o.agentLabel, params));
        return toPermissionResponse(params.options, decision, run.stopped);
      },
      sessionUpdate: async ({ sessionId, update }) => {
        const u: any = update;
        if (this.replaying === "drop" && u.sessionUpdate !== "current_mode_update") return;
        switch (u.sessionUpdate) {
          case "user_message_chunk":
            // Only a shown replay has the user's own messages in it; a live turn's are the panel's.
            if (this.replaying === "show") this.o.events.replayedUserMessage?.(textOf(u.content));
            return;
          case "agent_message_chunk":
            if (this.streaming()) this.o.events.text(textOf(u.content));
            return;
          case "agent_thought_chunk":
            if (this.streaming()) this.o.events.thinking?.(textOf(u.content));
            return;
          case "tool_call":
          case "tool_call_update":
            return this.toolCallUpdate(u);
          case "plan":
            this.o.events.plan?.((u.entries ?? []).map((e: any) => ({ content: String(e.content ?? ""), status: String(e.status ?? "pending"), priority: e.priority })));
            return;
          case "usage_update":
            if (typeof u.used === "number" && typeof u.size === "number" && u.size > 0) this.o.events.context?.({ used: u.used, size: u.size, cost: u.cost ?? undefined });
            return;
          case "available_commands_update":
            this.o.events.commands?.((u.availableCommands ?? []).map((c: any) => ({ name: String(c.name), description: String(c.description ?? ""), ...(typeof c.input?.hint === "string" && c.input.hint.trim() ? { hint: c.input.hint.trim() } : {}) })));
            return;
          case "session_info_update":
            if (typeof u.title === "string" && u.title.trim()) this.o.events.title?.(u.title.trim());
            return;
          case "config_option_update":
            this.reportOptions(u.configOptions);
            this.o.events.configChanged?.(Object.fromEntries((u.configOptions ?? []).map((o: any) => [String(o.id), String(o.currentValue)])));
            return;
          case "current_mode_update":
            for (const w of [...this.modeWaiters]) w(sessionId, u.currentModeId);
            return;
          default:
            if (!this.loggedUnknown.has(u.sessionUpdate)) {
              this.loggedUnknown.add(u.sessionUpdate);
              this.o.log?.(`${this.o.agentLabel}: ignoring session update '${u.sessionUpdate}'`);
            }
        }
      },
      // The adapters' login status pushes (claude-agent-acp, codex-acp), sent as `_auth/status_update`.
      extNotification: async (method, params) => {
        if (method.replace(/^_/, "") !== "auth/status_update") return;
        const status = (params as any)?.authStatus;
        if (typeof status?.kind === "string") this.o.connection?.({ type: "authStatus", kind: status.kind, label: typeof status.label === "string" ? status.label : undefined });
      },
      readTextFile: async () => {
        throw new Error("This client does not provide file reads; the agent reads files itself");
      },
      writeTextFile: async () => {
        throw new Error("This client does not provide file writes; the agent writes files itself after approval");
      },
    };
  }
}
