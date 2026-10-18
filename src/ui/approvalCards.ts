import type { GateRequest } from "../gate/approvalGate";
import type { ApprovalCard, HostToPanel } from "./protocol";

const clip = (s: string, n = 4000) => (s.length > n ? `${s.slice(0, n)}\n... (${s.length - n} more characters)` : s);

/** How each gate request is shown to the user. The detail is the exact thing being approved. */
export function toApprovalCard(id: string, ws: { id: string; label: string }, r: GateRequest): ApprovalCard {
  const card = (c: Omit<ApprovalCard, "id" | "workspaceId" | "workspace">): ApprovalCard => ({ id, workspaceId: ws.id, workspace: ws.label, ...c });
  switch (r.kind) {
    case "edit":
      return card({ title: "Edit file", detail: r.path, hasDiff: true });
    case "write":
      return card({ title: r.before === null ? "Create file" : "Overwrite file", detail: r.path, hasDiff: true });
    case "delete":
      return card({ title: "Delete (to trash)", detail: r.path, hasDiff: false });
    case "read":
      return card({ title: "Read a credential-like file (its contents go to your model provider)", detail: r.path, hasDiff: false });
    case "execute":
      return card({ title: "Run command in the kernl terminal", detail: r.command, hasDiff: false });
    case "tool":
      return card({ title: `Use tool ${r.tool}`, detail: clip(JSON.stringify(r.args, null, 2)), hasDiff: false });
    case "agent":
      return card({ title: `${r.agent}: ${r.title}`, detail: clip(r.detail), hasDiff: r.diff !== undefined, ...(r.alwaysLabel ? { always: r.alwaysLabel } : {}) });
  }
}

/** Every card still waiting for an answer, for a freshly loaded webview. */
export function panelSnapshot(pending: Iterable<[string, { workspace: { id: string; label: string }; request: GateRequest }]>): HostToPanel {
  return { type: "snapshot", cards: [...pending].map(([id, p]) => toApprovalCard(id, p.workspace, p.request)) };
}
