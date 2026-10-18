import { type ChildProcess, spawn } from "node:child_process";
import { Readable, Writable } from "node:stream";
import * as acp from "@agentclientprotocol/sdk";
import type { Runner } from "../agent/runner";
import type { SessionEvents } from "../agent/session";
import type { ApprovalGate } from "../gate/approvalGate";
import type { AskMode, Launch } from "./agents";
import { toGateRequest, toPermissionResponse } from "./permission";
import { join } from "node:path";
import { pathToFileURL } from "node:url";
import { type Attachment, attachmentNote } from "../ui/protocol";

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
}

/** The session could not be confirmed to ask before every action; nothing was sent. */
class AskModeRefusal extends Error {}

const textOf = (content: any): string => (content?.type === "text" ? String(content.text ?? "") : content?.type === "content" ? textOf(content.content) : "");

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
  /** A stored session to load on the next send, and whether its replayed history is arriving now. */
  private resumeId: string | undefined;
  private replaying = false;
  /** The previous session's close; the next session waits for it, so the agent never holds both. */
  private closing: Promise<void> | undefined;
  private agentCapabilities: acp.AgentCapabilities | undefined;
  /** The current session's modes (for agents that use session modes rather than config options). */
  private sessionModes: acp.NewSessionResponse["modes"];
  private loggedUnknown = new Set<string>();

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
      const sessionId = await this.ensureSession(conn);
      if (run.stopped) return this.o.events.finished("stopped");
      // resource_link is the one attachment form every ACP agent must accept; the text lists them too.
      const links = attachments.filter((a) => a.kind !== "text").map((a) => ({ type: "resource_link" as const, uri: pathToFileURL(join(this.o.cwd, a.path)).href, name: a.path }));
      const result = await conn.prompt({ sessionId, prompt: [{ type: "text", text: text + attachmentNote(attachments) }, ...links] });
      // Only our own Stop means "stopped": some agents (OpenCode) end the turn as "cancelled"
      // after the user rejects a permission request, which is a finished turn, not a Stop.
      if (result.stopReason === "cancelled" && !run.stopped) this.o.log?.(`${this.o.agentLabel}: turn ended as cancelled after a rejection`);
      this.o.events.finished(run.stopped ? "stopped" : "done");
    } catch (err: any) {
      if (run.stopped) this.o.events.finished("stopped");
      else this.o.events.finished("error", (await this.crashCause(err)) ?? `${this.o.agentLabel}: ${err?.message ?? String(err)}`);
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
    const previous = this.sessionId;
    this.sessionId = undefined;
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
    const forked = await this.connection.unstable_forkSession({ sessionId: this.sessionId, cwd: this.o.cwd, mcpServers: [] });
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
      connection.initialize({ protocolVersion: acp.PROTOCOL_VERSION, clientCapabilities: { fs: { readTextFile: false, writeTextFile: false }, terminal: false } }),
      exitReason.then((message) => Promise.reject(new Error(message))),
    ]);
    this.agentCapabilities = init.agentCapabilities;
    this.connection = connection;
    return connection;
  }

  /** Opens a session if needed and confirms its ask mode before anything is sent. */
  private async ensureSession(conn: acp.ClientSideConnection): Promise<string> {
    if (this.sessionId) return this.sessionId;
    await this.closing;
    this.closing = undefined;
    const resumeId = this.resumeId;
    this.resumeId = undefined;
    if (resumeId && this.agentCapabilities?.loadSession) {
      // The agent replays the old conversation as updates; the panel already shows it, so they're dropped.
      this.replaying = true;
      try {
        const loaded = await conn.loadSession({ sessionId: resumeId, cwd: this.o.cwd, mcpServers: [] });
        const session = { ...loaded, sessionId: resumeId } as acp.NewSessionResponse;
        await this.forceMode(conn, session);
        this.sessionId = resumeId;
        return resumeId;
      } catch (err: any) {
        if (err instanceof AskModeRefusal) throw err;
        this.o.log?.(`${this.o.agentLabel}: could not load session ${resumeId}: ${err?.message ?? err}`);
        this.o.notice?.(`${this.o.agentLabel} couldn't reload the earlier conversation; this message starts a new one.`);
      } finally {
        this.replaying = false;
      }
    } else if (resumeId) {
      this.o.notice?.(`${this.o.agentLabel} can't reload earlier conversations; this message starts a new one.`);
    }
    const session = await conn.newSession({ cwd: this.o.cwd, mcpServers: [] });
    await this.forceMode(conn, session);
    this.sessionId = session.sessionId;
    return session.sessionId;
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

  private client(): acp.Client {
    return {
      requestPermission: async (params) => {
        const run = this.active;
        if (!run || run.stopped) return toPermissionResponse(params.options, false, true);
        const approved = await this.o.gate.request(toGateRequest(this.o.agentLabel, params));
        return toPermissionResponse(params.options, approved, run.stopped);
      },
      sessionUpdate: async ({ sessionId, update }) => {
        const u: any = update;
        if (this.replaying && u.sessionUpdate !== "current_mode_update") return;
        switch (u.sessionUpdate) {
          case "agent_message_chunk":
            if (this.active && !this.active.stopped) this.o.events.text(textOf(u.content));
            return;
          case "tool_call":
            this.o.events.toolCall(u.toolCallId, u.title ?? u.kind ?? "tool", u.rawInput ?? {});
            return;
          case "tool_call_update":
            if (u.status === "completed" || u.status === "failed") {
              const out = (u.content ?? []).map(textOf).filter(Boolean).join("\n");
              this.o.events.toolResult(u.toolCallId, u.title ?? "", out || u.status, u.status === "failed");
            }
            return;
          case "plan":
            this.o.events.toolResult(`plan-${sessionId}`, "plan", (u.entries ?? []).map((e: any) => `[${e.status}] ${e.content}`).join("\n"));
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
      readTextFile: async () => {
        throw new Error("This client does not provide file reads; the agent reads files itself");
      },
      writeTextFile: async () => {
        throw new Error("This client does not provide file writes; the agent writes files itself after approval");
      },
    };
  }
}
