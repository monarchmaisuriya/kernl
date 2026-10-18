import { randomUUID } from "node:crypto";
import type { PermissionMode } from "../modes";
import { decide, type Rule } from "./rules";

/** Everything the agent can ask permission for. One shape per kind of side effect. */
export type GateRequest =
  | { kind: "edit"; path: string; before: string; after: string }
  | { kind: "write"; path: string; before: string | null; after: string }
  | { kind: "delete"; path: string }
  | { kind: "read"; path: string }
  | { kind: "execute"; command: string }
  | { kind: "tool"; tool: string; args: unknown }
  /** An external CLI agent (Claude Code, Codex, OpenCode) asking over ACP. */
  | { kind: "agent"; agent: string; title: string; toolKind: string; detail: string; diff?: { path: string; before: string | null; after: string }; alwaysLabel?: string };

/** The user's answer: once, "always" (only where the agent offers it), or no. */
export type Decision = boolean | "always";

/** Shows one request to the user and resolves true only on an explicit approve. */
export interface ApprovalPrompter {
  ask(id: string, request: GateRequest): Promise<Decision>;
}

export interface GatePolicy {
  /** The user's approval rules, read on every request so settings changes apply at once. */
  rules(): readonly Rule[];
  /** A deny rule refused `request` without asking. */
  denied?(request: GateRequest, rule: string): void;
  /** The permission mode, read on every request (absent: ask before edits). */
  mode?(): PermissionMode;
  /** Plan mode refused `request` without asking. */
  refusedInPlan?(request: GateRequest): void;
}

// Files whose contents would hand credentials to the model provider.
const SENSITIVE_NAME = /^(\.env(\..*)?|.*\.pem|.*\.key|id_[^/]*)$/i;

export function isSensitivePath(path: string): boolean {
  const name = path.split(/[\\/]/).pop() ?? "";
  return SENSITIVE_NAME.test(name);
}

/**
 * The single owner of allow/deny. The gated backend and every custom tool call request();
 * nothing else decides whether a side effect may happen.
 */
export class ApprovalGate {
  constructor(private prompter: ApprovalPrompter, private policy: GatePolicy) {}

  /**
   * A deny rule always wins. Plan mode refuses every change (reads still follow the rules). Then
   * allow rules apply, and in "Edit automatically" edits and new files (not credential files) are
   * allowed; everything else asks.
   */
  async request(request: GateRequest): Promise<boolean> {
    return (await this.decide(request)) !== false;
  }

  /** Like request(), but keeps "always" (a CLI agent's own allow-always option, when the user picks it). */
  async decide(request: GateRequest): Promise<Decision> {
    const { verdict, rule } = decide(request, this.policy.rules());
    if (verdict === "deny") {
      this.policy.denied?.(request, rule!.text);
      return false;
    }
    const mode = this.policy.mode?.() ?? "ask";
    if (mode === "plan" && request.kind !== "read") {
      this.policy.refusedInPlan?.(request);
      return false;
    }
    if (verdict === "allow") return true;
    if (mode === "acceptEdits" && (request.kind === "edit" || request.kind === "write") && !isSensitivePath(request.path)) return true;
    return this.prompter.ask(randomUUID(), request);
  }
}
