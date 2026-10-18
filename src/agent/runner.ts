import type { Attachment } from "../ui/protocol";

/**
 * What the panel drives, whatever the harness: our Deep Agents loop (AgentSession) or an
 * external CLI agent over ACP (AcpRunner). Both report through SessionEvents and ask the same gate.
 */
export interface Runner {
  readonly running: boolean;
  /** Claims the run before any await; throws if a run is already in progress. */
  send(text: string, attachments?: readonly Attachment[]): Promise<void>;
  stop(): void;
  /**
   * Start another conversation. With `history` (from exportHistory, e.g. a stored session), the
   * next send continues it; without, it starts fresh.
   */
  newThread(history?: unknown): void;
  /** What's needed to continue this conversation later (stored with the session), or undefined. */
  exportHistory(): Promise<unknown>;
  /**
   * CLI agents that support it (ACP session/fork): switch to a copy of the whole current session
   * and return its history; undefined when the agent can't fork.
   */
  forkSession?(): Promise<unknown>;
  /** CLI agents: put the live session into the current permission mode now (throws if not confirmed). */
  applyMode?(): Promise<void>;
  dispose(): void;
}
