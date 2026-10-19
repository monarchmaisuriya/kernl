import { dirname } from "node:path";
import { KERNL_SERVER_NAME } from "../mcp/kernlServer";
import type { PermissionMode } from "../modes";
import { resolveCommand } from "./commands";

export const CLI_AGENT_IDS = ["claude-code", "codex", "opencode"] as const;
export type CliAgentId = (typeof CLI_AGENT_IDS)[number];

/** How a session is put into a permission mode, and how that is confirmed. */
export type AskMode =
  /** Set config option `optionId` to `value`; the response's configOptions must report it. */
  | { kind: "configOption"; optionId: string; value: string }
  /** Several config options set together (each confirmed), e.g. Codex's mode and collaboration_mode. */
  | { kind: "configOptions"; options: { optionId: string; value: string }[] }
  /** Set the session mode; the session's current mode must report it. */
  | { kind: "sessionMode"; modeId: string }
  /** The agent asks because of the launch environment; nothing to set per session. */
  | { kind: "environment" };

export interface Launch {
  command: string;
  args: string[];
  env: Record<string, string>;
}

/** One permission mode of a CLI agent: what to set on the session, any launch environment it needs, and what it means. */
export interface AgentMode {
  session: AskMode;
  /** Launch environment this mode needs (OpenCode's permission config); a change relaunches the agent. */
  env?: Record<string, string>;
  /** One sentence for the panel: what the agent may do without a card in this mode. */
  disclosure: string;
}

export interface CliAgentSpec {
  id: CliAgentId;
  label: string;
  experimental: boolean;
  /** The modes this agent supports; "ask" is required and is the default. */
  modes: Partial<Record<PermissionMode, AgentMode>> & { ask: AgentMode };
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
/** OpenCode's "Edit automatically": edits allowed; commands, fetches, and outside-folder access still ask. */
export const OPENCODE_EDIT_CONFIG = JSON.stringify({
  permission: { edit: "allow", bash: "ask", webfetch: "ask", external_directory: "ask" },
});

const claudeMode = (value: string, disclosure: string): AgentMode => ({ session: { kind: "configOption", optionId: "mode", value }, disclosure });
const codexMode = (mode: string, collaboration: string, disclosure: string): AgentMode => ({
  session: { kind: "configOptions", options: [{ optionId: "mode", value: mode }, { optionId: "collaboration_mode", value: collaboration }] },
  disclosure,
});
const opencodeMode = (mode: string, config: string, disclosure: string): AgentMode => ({
  session: { kind: "configOption", optionId: "mode", value: mode },
  env: { OPENCODE_CONFIG_CONTENT: config },
  disclosure,
});

function npxLaunch(pkg: string, extraEnv: Record<string, string>): Launch | { error: string } {
  const npx = resolveCommand("npx");
  if (!npx) return { error: "npx was not found. Install Node.js (it provides npx), or set a command in kernl.agentCommands." };
  // The adapter runs under the same Node that provides npx, even when VS Code's PATH lacks it.
  return { command: npx, args: ["-y", pkg], env: { PATH: `${dirname(npx)}:${process.env.PATH ?? ""}`, ...extraEnv } };
}

export const CLI_AGENTS: Record<CliAgentId, CliAgentSpec> = {
  "claude-code": {
    id: "claude-code",
    label: "Claude Code",
    experimental: false,
    modes: {
      ask: claudeMode("default", "Claude Code runs approved actions itself, in Manual mode: every edit and command asks first."),
      acceptEdits: claudeMode("acceptEdits", "Claude Code edits files without asking; commands and other tools still ask."),
      plan: claudeMode("plan", "Claude Code explores and plans before making changes."),
      auto: claudeMode("auto", "Claude Code decides for each tool call whether to ask."),
      bypass: claudeMode("bypassPermissions", "Claude Code runs every tool without asking."),
    },
    launch() {
      const claude = resolveCommand("claude");
      if (!claude) return { error: "Claude Code (claude) was not found. Install it and sign in, or set a command in kernl.agentCommands." };
      return npxLaunch(CLAUDE_ADAPTER, { CLAUDE_CODE_EXECUTABLE: claude });
    },
  },
  codex: {
    id: "codex",
    label: "Codex (experimental)",
    experimental: true,
    // codex-acp 2.2.2 accepts session/set_mode without ever confirming it; its config options confirm in the reply.
    modes: {
      ask: codexMode("read-only", "default", "Codex runs approved actions itself, in Read-only mode: edits and network ask first; read-only commands run in its sandbox without a card."),
      acceptEdits: codexMode("workspace-write", "default", "Codex edits files in this folder without asking; writing outside it or using the network asks."),
      plan: codexMode("read-only", "plan", "Codex plans before making changes, in Read-only mode."),
      auto: codexMode("agent", "default", "Codex asks only for actions it detects as potentially unsafe (Auto review)."),
      bypass: codexMode("agent-full-access", "default", "Codex runs everything without asking, with full access to files and the internet."),
    },
    launch() {
      return npxLaunch(CODEX_ADAPTER, {});
    },
  },
  opencode: {
    id: "opencode",
    label: "OpenCode",
    experimental: false,
    modes: {
      ask: opencodeMode("build", OPENCODE_ASK_CONFIG, "OpenCode runs approved actions itself; edits, commands, web fetches, and outside-folder access ask first."),
      acceptEdits: opencodeMode("build", OPENCODE_EDIT_CONFIG, "OpenCode edits files without asking; commands, web fetches, and outside-folder access still ask."),
      plan: opencodeMode("plan", OPENCODE_ASK_CONFIG, "OpenCode's read-only Plan agent explores and plans; changes still ask."),
    },
    launch() {
      const opencode = resolveCommand("opencode");
      if (!opencode) return { error: "OpenCode (opencode) was not found. Install it, or set a command in kernl.agentCommands." };
      return { command: opencode, args: ["acp"], env: {} };
    },
  },
};

export function isCliAgentId(value: unknown): value is CliAgentId {
  return typeof value === "string" && (CLI_AGENT_IDS as readonly string[]).includes(value);
}

/** How a CLI agent uses kernl's tools (the Terminal and Browser settings). */
export interface KernlToolUse {
  /** kernl's tools are offered to the agent at all (an MCP server named "kernl"). */
  tools: boolean;
  /** Commands go through kernl's run_in_terminal: the agent's own shell tool is off (Claude Code, OpenCode; Codex keeps its shell). */
  terminal: boolean;
}

/**
 * Claude Code's session options: kernl's tools run without Claude Code's own prompt (kernl's gate
 * asks, so you see one card), and with kernl's terminal its Bash tool is off. Other agents: none.
 */
export function sessionMeta(id: CliAgentId, use: KernlToolUse): Record<string, unknown> | undefined {
  if (id !== "claude-code" || !use.tools) return undefined;
  return { claudeCode: { options: { allowedTools: [`mcp__${KERNL_SERVER_NAME}`], ...(use.terminal ? { disallowedTools: ["Bash"] } : {}) } } };
}

/** OpenCode's permission config with its bash tool denied, so its commands go through kernl's terminal. */
export function denyOpencodeBash(config: string | undefined): string {
  const parsed = config ? JSON.parse(config) : {};
  return JSON.stringify({ ...parsed, permission: { ...(parsed.permission ?? {}), bash: "deny" } });
}

/**
 * The launch for an agent: the user's override from kernl.agentCommands, else the default.
 * `credentialEnv` (a stored API key) is layered on top of either; nothing overrides the
 * permission mode's environment (OpenCode's ask-forcing config, with bash denied when its
 * commands go through kernl's terminal).
 */
export function resolveLaunch(id: CliAgentId, overrides: unknown, credentialEnv: Record<string, string> = {}, mode: PermissionMode = "ask", use?: KernlToolUse): Launch | { error: string } {
  const spec = CLI_AGENTS[id];
  const override = (overrides as Record<string, any> | undefined)?.[id];
  const forced: Record<string, string> = { ...((spec.modes[mode] ?? spec.modes.ask).env ?? {}) };
  if (id === "opencode" && use?.tools && use.terminal) forced.OPENCODE_CONFIG_CONTENT = denyOpencodeBash(forced.OPENCODE_CONFIG_CONTENT);
  let base: Launch | { error: string };
  if (override === undefined) base = spec.launch();
  else if (typeof override?.command !== "string" || (override.args !== undefined && !Array.isArray(override.args))) {
    return { error: `Expected kernl.agentCommands.${id} to be { "command": string, "args"?: string[] }, got ${JSON.stringify(override)}` };
  } else base = { command: override.command, args: override.args ?? [], env: override.env ?? {} };
  if ("error" in base) return base;
  return { ...base, env: { ...base.env, ...credentialEnv, ...forced } };
}
