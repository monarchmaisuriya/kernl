import type { ApprovalPrompter, GateRequest } from "./approvalGate";

/**
 * Tracks approval requests waiting on the user. Each id resolves exactly once; unknown or
 * already-answered ids are ignored, so a stale or duplicated click cannot approve anything else.
 */
export class PendingApprovals implements ApprovalPrompter {
  private waiting = new Map<string, (approved: boolean) => void>();

  constructor(private show: (id: string, request: GateRequest) => void, private retract: (id: string) => void) {}

  ask(id: string, request: GateRequest): Promise<boolean> {
    return new Promise((resolve) => {
      this.waiting.set(id, resolve);
      this.show(id, request);
    });
  }

  /** Returns false when `id` is not waiting (unknown, or already answered). */
  answer(id: string, approved: boolean): boolean {
    const resolve = this.waiting.get(id);
    if (!resolve) return false;
    this.waiting.delete(id);
    resolve(approved === true);
    return true;
  }

  /** Stop pressed or panel gone: every open request is denied. */
  denyAll() {
    for (const id of [...this.waiting.keys()]) {
      this.answer(id, false);
      this.retract(id);
    }
  }

  get size() {
    return this.waiting.size;
  }
}
