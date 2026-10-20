// CLI agents' own sessions read for thread tags, shared by every tab of the window. Reading one starts a
// short-lived agent process (up to 30 s), so a session is read once per version: the key carries the
// session's last change as the agent listed it, and a newer one is read again. A read in progress is
// shared by everyone who asks; a failed read isn't kept; the sessions used longest ago go past the limit.
import type { TranscriptEvent } from "./sessions";

/** How many sessions are kept: a tag reads a session's whole replay. */
const MAX_SESSIONS = 20;

export class AgentThreadCache {
  private read = new Map<string, TranscriptEvent[]>();
  private reading = new Map<string, Promise<TranscriptEvent[] | string>>();

  constructor(private readonly max = MAX_SESSIONS) {}

  /** The session's events for `key` (`<handle>@<updatedAt>`), read with `load` unless kept or being read; a string says why it couldn't be. */
  get(key: string, load: () => Promise<TranscriptEvent[] | string>): Promise<TranscriptEvent[] | string> {
    const kept = this.read.get(key);
    if (kept) {
      // Used again: it's now the newest, last to go past the limit.
      this.read.delete(key);
      this.read.set(key, kept);
      return Promise.resolve(kept);
    }
    const pending = this.reading.get(key);
    if (pending) return pending;
    const started = load()
      .then((events) => {
        if (typeof events !== "string") this.keep(key, events);
        return events;
      })
      .finally(() => this.reading.delete(key));
    this.reading.set(key, started);
    return started;
  }

  private keep(key: string, events: TranscriptEvent[]) {
    this.read.set(key, events);
    for (const oldest of this.read.keys()) {
      if (this.read.size <= this.max) break;
      this.read.delete(oldest);
    }
  }
}
