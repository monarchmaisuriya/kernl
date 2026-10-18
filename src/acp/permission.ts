import type { PermissionOption, RequestPermissionRequest, RequestPermissionResponse } from "@agentclientprotocol/sdk";
import type { Decision, GateRequest } from "../gate/approvalGate";

const textOf = (content: unknown): string => {
  const c = content as any;
  if (!c) return "";
  if (c.type === "content") return textOf(c.content);
  if (c.type === "text") return String(c.text ?? "");
  return "";
};

/** What the user sees for an ACP permission request: title, kind, the raw input, and a diff when the agent sent one. */
export function toGateRequest(agent: string, params: RequestPermissionRequest): GateRequest {
  const call = params.toolCall as any;
  const diffItem = (call.content ?? []).find((c: any) => c?.type === "diff");
  const locations = (call.locations ?? []).map((l: any) => l.path).filter(Boolean);
  const detail = [
    ...locations,
    call.rawInput !== undefined ? JSON.stringify(call.rawInput, null, 2) : "",
    ...(call.content ?? []).map(textOf).filter(Boolean),
  ]
    .filter(Boolean)
    .join("\n");
  return {
    kind: "agent",
    agent,
    title: String(call.title ?? "Permission request"),
    toolKind: String(call.kind ?? "other"),
    detail: detail || String(call.title ?? ""),
    diff: diffItem ? { path: String(diffItem.path), before: diffItem.oldText ?? null, after: String(diffItem.newText ?? "") } : undefined,
    alwaysLabel: params.options.find((o) => o.kind === "allow_always")?.name,
  };
}

/**
 * The ACP answer for the user's decision. Approve picks "allow_once"; "allow_always" only when the
 * user chose the card's separate "always" button (offered only when the agent has that option),
 * never as a fallback. If the agent offers no one-time allow, a plain approve is rejected rather
 * than widened.
 */
export function toPermissionResponse(options: PermissionOption[], decision: Decision, stopped: boolean): RequestPermissionResponse {
  if (stopped) return { outcome: { outcome: "cancelled" } };
  const pick = (kind: string) => options.find((o) => o.kind === kind)?.optionId;
  const optionId = decision === "always" ? pick("allow_always") ?? pick("reject_once") : decision ? pick("allow_once") ?? pick("reject_once") : pick("reject_once") ?? pick("reject_always");
  if (!optionId) return { outcome: { outcome: "cancelled" } };
  return { outcome: { outcome: "selected", optionId } };
}
