import { dirname } from "node:path";
import { resolveCommand } from "./commands";

export const CLI_AGENT_IDS = ["claude-code", "codex", "opencode"] as const;
export type CliAgentId = (typeof CLI_AGENT_IDS)[number];

/** How a session is put into the mode that asks before every edit and command, and how that is confirmed. */
export type AskMode =
  /** Set config option `optionId` to `value`; the response's configOptions must report it. */
  | { kind: "configOption"; optionId: string; value: string }
  /** Set the session mode; the session's current mode must report it. */
  | { kind: "sessionMode"; modeId: string }
  /** The agent asks because of the launch environment; nothing to set per session. */
  | { kind: "environment" };

export interface Launch {
  command: string;
  args: string[];
  env: Record<string, string>;
}

export interface CliAgentSpec {
  id: CliAgentId;
  label: string;
  experimental: boolean;
  askMode: AskMode;
  /** One sentence for the panel: what the agent may still do without a card in this mode. */
  disclosure: string;
  /** The default launch, or an error explaining what is missing. */
  launch(): Launch | { error: string };
}

// Pinned so behavior (modes, events) cannot change underneath us.
const CLAUDE_ADAPTER = "@agentclientprotocol/claude-agent-acp@0.93.0";
const CODEX_ADAPTER = "@agentclientprotocol/codex-acp@2.2.2";

/** OpenCode only asks when its permission config says "ask"; default OpenCode wrote files without asking. */
export const OPENCODE_ASK_CONFIG = JSON.stringify({
  permission: { edit: "ask", bash: "ask", webfetch: "ask", external_directory: "ask" },
});

function npxLaunch(pkg: string, extraEnv: Record<string, string>): Launch | { error: string } {
  const npx = resolveCommand("npx");
  if (!npx) return { error: "npx was not found. Install Node.js (it provides npx), or set a command in yourstack.agentCommands." };
  // The adapter runs under the same Node that provides npx, even when VS Code's PATH lacks it.
  return { command: npx, args: ["-y", pkg], env: { PATH: `${dirname(npx)}:${process.env.PATH ?? ""}`, ...extraEnv } };
}

export const CLI_AGENTS: Record<CliAgentId, CliAgentSpec> = {
  "claude-code": {
    id: "claude-code",
    label: "Claude Code",
    experimental: false,
    askMode: { kind: "configOption", optionId: "mode", value: "default" },
    disclosure: "Claude Code runs approved actions itself, in Manual mode: every edit and command asks first.",
    launch() {
      const claude = resolveCommand("claude");
      if (!claude) return { error: "Claude Code (claude) was not found. Install it and sign in, or set a command in yourstack.agentCommands." };
      return npxLaunch(CLAUDE_ADAPTER, { CLAUDE_CODE_EXECUTABLE: claude });
    },
  },
  codex: {
    id: "codex",
    label: "Codex (experimental)",
    experimental: true,
    // codex-acp 2.2.2 accepts session/set_mode without ever confirming it; its "mode" config option confirms in the reply.
    askMode: { kind: "configOption", optionId: "mode", value: "read-only" },
    disclosure: "Codex runs approved actions itself, in Read-only mode: edits and network ask first; read-only commands run in its sandbox without a card.",
    launch() {
      return npxLaunch(CODEX_ADAPTER, {});
    },
  },
  opencode: {
    id: "opencode",
    label: "OpenCode",
    experimental: false,
    askMode: { kind: "environment" },
    disclosure: "OpenCode runs approved actions itself; edits, commands, web fetches, and outside-folder access ask first.",
    launch() {
      const opencode = resolveCommand("opencode");
      if (!opencode) return { error: "OpenCode (opencode) was not found. Install it, or set a command in yourstack.agentCommands." };
      return { command: opencode, args: ["acp"], env: { OPENCODE_CONFIG_CONTENT: OPENCODE_ASK_CONFIG } };
    },
  },
};

export function isCliAgentId(value: unknown): value is CliAgentId {
  return typeof value === "string" && (CLI_AGENT_IDS as readonly string[]).includes(value);
}

/**
 * The launch for an agent: the user's override from yourstack.agentCommands, else the default.
 * `credentialEnv` (a stored API key) is layered on top of either; nothing overrides the
 * agent's ask-forcing environment.
 */
export function resolveLaunch(id: CliAgentId, overrides: unknown, credentialEnv: Record<string, string> = {}): Launch | { error: string } {
  const spec = CLI_AGENTS[id];
  const override = (overrides as Record<string, any> | undefined)?.[id];
  const forced: Record<string, string> = id === "opencode" ? { OPENCODE_CONFIG_CONTENT: OPENCODE_ASK_CONFIG } : {};
  let base: Launch | { error: string };
  if (override === undefined) base = spec.launch();
  else if (typeof override?.command !== "string" || (override.args !== undefined && !Array.isArray(override.args))) {
    return { error: `Expected yourstack.agentCommands.${id} to be { "command": string, "args"?: string[] }, got ${JSON.stringify(override)}` };
  } else base = { command: override.command, args: override.args ?? [], env: override.env ?? {} };
  if ("error" in base) return base;
  return { ...base, env: { ...base.env, ...credentialEnv, ...forced } };
}
