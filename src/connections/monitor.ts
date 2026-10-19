// The single owner of connection statuses. Checks are grouped by what one check covers ("agent:codex",
// "mcp:claude-code"); a check already running for a group is joined, never started twice. A failure
// reported by a real run (an agent answering "authentication required") holds until something that
// could have fixed it happens: a forced check (a credential file or key changed, the login terminal
// closed, Check now) or a successful run. Routine rechecks (focus, the poll) don't clear it, because
// a status command can say "logged in" while runs still fail.
import { blocks, type ConnectionStatus } from "./types";

type Listener = () => void;

const KIND_ORDER = ["agent", "providerKey", "agentKey", "mcp", "plugin"];

/** Whether `id` is `group` itself or inside it ("mcp:claude-code" holds "mcp:claude-code:notion"). */
export const inGroup = (id: string, group: string) => id === group || id.startsWith(`${group}:`);

export class ConnectionMonitor {
  private statuses = new Map<string, ConnectionStatus>();
  private running = new Map<string, Promise<void>>();
  /** A check asked for while one was running, after something changed: it runs once the current one ends. */
  private queued = new Map<string, { check: () => Promise<ConnectionStatus[]>; options: { force?: boolean; changed?: boolean }; promise: Promise<void> }>();
  /** Groups whose running check started before their inputs changed: its answer is dropped. */
  private outdated = new Set<string>();
  /** Ids a run reported as failing; routine checks leave them as they are. */
  private fromRuns = new Set<string>();
  private listeners = new Set<Listener>();

  constructor(private now: () => number = Date.now) {}

  onDidChange(listener: Listener): { dispose(): void } {
    this.listeners.add(listener);
    return { dispose: () => void this.listeners.delete(listener) };
  }

  get(id: string): ConnectionStatus | undefined {
    return this.statuses.get(id);
  }

  /** Every status: agents, keys, MCP servers, plugins; then by owner and name. */
  list(): ConnectionStatus[] {
    return [...this.statuses.values()].sort(
      (a, b) => KIND_ORDER.indexOf(a.kind) - KIND_ORDER.indexOf(b.kind) || a.owner.localeCompare(b.owner) || a.label.localeCompare(b.label),
    );
  }

  /**
   * Runs `check` for `group` (joining one already running) and replaces the group's statuses with
   * its result. `force`: something that could fix a run's failure happened, so that failure is cleared too.
   * While it runs, the group's rows are flagged `checking` and keep their last known state, unless
   * `changed`: what the connection depends on changed (its launch command, its key, its login files, a
   * login just finished), so the last state no longer describes it and reads "unknown" until the
   * check answers. `changed` implies `force`. A check that throws leaves its rows "unknown".
   */
  check(group: string, check: () => Promise<ConnectionStatus[]>, options: { force?: boolean; changed?: boolean } = {}): Promise<void> {
    const current = this.running.get(group);
    if (current) {
      // A routine request takes the running check's answer. A forced or changed one needs a check that
      // starts after the change: one is queued (shared by every such request until it starts).
      if (!options.force && !options.changed) return current;
      if (options.changed) {
        this.outdated.add(group);
        this.mark(group, true);
      }
      const waiting = this.queued.get(group);
      if (waiting) {
        waiting.check = check;
        waiting.options = { force: waiting.options.force || options.force, changed: waiting.options.changed || options.changed };
        return waiting.promise;
      }
      const entry = { check, options, promise: Promise.resolve() };
      entry.promise = current.then(() => {
        this.queued.delete(group);
        return this.check(group, entry.check, entry.options);
      });
      this.queued.set(group, entry);
      return entry.promise;
    }
    const force = options.force === true || options.changed === true;
    const run = (async () => {
      this.mark(group, options.changed === true);
      let result: ConnectionStatus[];
      try {
        result = await check();
      } catch (err: any) {
        result = this.rows(group).map((s) => ({ ...s, checking: false, state: "unknown" as const, detail: `The check failed: ${err?.message ?? err}`, checkedAt: this.now() }));
      }
      if (this.outdated.delete(group)) return;
      this.replace(group, result, force);
    })().finally(() => this.running.delete(group));
    this.running.set(group, run);
    return run;
  }

  /** A real run's signal (auth required, an MCP server that failed to start): applied at once. */
  report(status: ConnectionStatus) {
    if (blocks(status)) this.fromRuns.add(status.id);
    else this.fromRuns.delete(status.id);
    this.statuses.set(status.id, status);
    this.changed();
  }

  /** A run succeeded with this connection: a failure reported by an earlier run no longer holds. */
  clearRunFailure(id: string) {
    if (!this.fromRuns.delete(id)) return;
    const s = this.statuses.get(id);
    if (s && s.source === "last run") {
      this.statuses.set(id, { ...s, state: "ready", detail: "Worked in the last run", checkedAt: this.now() });
      this.changed();
    }
  }

  private rows(group: string) {
    return [...this.statuses.values()].filter((s) => inGroup(s.id, group));
  }

  private mark(group: string, inputsChanged: boolean) {
    let changed = false;
    for (const s of this.rows(group)) {
      if (inputsChanged) {
        this.fromRuns.delete(s.id);
        this.statuses.set(s.id, { ...s, checking: true, state: "unknown", detail: "Checking again after a change" });
        changed = true;
        continue;
      }
      if (s.checking || this.fromRuns.has(s.id)) continue;
      this.statuses.set(s.id, { ...s, checking: true });
      changed = true;
    }
    if (changed) this.changed();
  }

  private replace(group: string, result: ConnectionStatus[], force: boolean) {
    const kept = new Map<string, ConnectionStatus>();
    for (const s of this.rows(group)) {
      if (this.fromRuns.has(s.id) && !force) kept.set(s.id, s);
      this.statuses.delete(s.id);
    }
    if (force) for (const s of result) this.fromRuns.delete(s.id);
    for (const s of result) this.statuses.set(s.id, kept.get(s.id) ?? s);
    // A run's failure for a connection the check no longer lists stays visible until forced.
    for (const [id, s] of kept) if (!this.statuses.has(id)) this.statuses.set(id, s);
    for (const [id, s] of this.statuses) if (s.checking && inGroup(id, group)) this.statuses.set(id, { ...s, checking: false });
    this.changed();
  }

  private changed() {
    for (const l of [...this.listeners]) l();
  }
}
