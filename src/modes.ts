/**
 * Permission modes: how much an agent may do without asking. Each agent supports some of them
 * (see CLI_AGENTS[...].modes and KERNL_MODES); the panel offers only those.
 */
export const PERMISSION_MODES = ["ask", "acceptEdits", "plan", "auto", "bypass"] as const;
export type PermissionMode = (typeof PERMISSION_MODES)[number];

export interface ModeInfo {
  label: string;
  /** Icon name in the panel's icon set. */
  icon: "shield" | "pencil" | "bulb" | "kernl" | "warning";
}

export const MODE_INFO: Record<PermissionMode, ModeInfo> = {
  ask: { label: "Ask before edits", icon: "shield" },
  acceptEdits: { label: "Edit automatically", icon: "pencil" },
  plan: { label: "Plan mode", icon: "bulb" },
  auto: { label: "Auto mode", icon: "kernl" },
  bypass: { label: "Bypass permissions", icon: "warning" },
};

export function isPermissionMode(value: unknown): value is PermissionMode {
  return typeof value === "string" && (PERMISSION_MODES as readonly string[]).includes(value);
}

/** The kernl agent's modes, enforced by its approval gate. It has no skip-all mode (an earlier decision). */
export const KERNL_MODES: Partial<Record<PermissionMode, string>> = {
  ask: "kernl asks before every edit, command, browser action, and MCP tool call.",
  acceptEdits: "kernl edits and creates files in this folder without asking; commands, deletes, and other tools still ask.",
  plan: "kernl reads and searches only and answers with a plan; every change is refused.",
};

/** Told to the kernl agent with each message in plan mode (the transcript shows the user's text as typed). */
export const PLAN_NOTE = "[Plan mode: you may read and search files, but must not edit, write, delete, or run commands. Answer with a step-by-step plan.]\n\n";
