// Each CLI agent's connection: installed, and logged in, checked the way kernl will launch it (same
// binary, same environment, including a key stored in kernl or a kernl.agentCommands override).
import { basename } from "node:path";
import { CLI_AGENTS, type CliAgentId, type Launch } from "../acp/agents";
import { parseClaudeAuth, parseCodexLogin, parseOpencodeAuth, type Parsed } from "./parsers";
import type { CommandResult, CommandTarget, StatusCommand } from "./statusCommands";
import type { ConnectionStatus } from "./types";

export interface AgentCheckDeps {
  /** The agent's launch (resolveLaunch with its stored credential), or why it can't start. */
  launch(id: CliAgentId): Promise<Launch | { error: string }>;
  /** A key for the agent is stored in kernl (then its own login isn't used). */
  hasStoredKey(id: CliAgentId): Promise<boolean>;
  /** The user's kernl.agentCommands entry for the agent, if any. */
  launchOverride(id: CliAgentId): { command: string } | undefined;
  /** Absolute path of a command in an environment, or undefined. */
  find(command: string, env: Record<string, string | undefined>): string | undefined;
  run(name: StatusCommand, target: CommandTarget): Promise<CommandResult>;
  /** The folder the status commands run in. */
  cwd?: string;
  now(): number;
}

const BINARY: Record<CliAgentId, string> = { "claude-code": "claude", codex: "codex", opencode: "opencode" };

/** What to run in a terminal to log the agent in (the CLI's own login). */
export const LOGIN_ARGS: Record<CliAgentId, string[]> = { "claude-code": ["auth", "login"], codex: ["login"], opencode: ["auth", "login"] };

/** The login as a command line, for messages: "claude auth login". */
export const loginCommand = (id: CliAgentId) => [BINARY[id], ...LOGIN_ARGS[id]].join(" ");

/** What the agent chip and menu say about a connection that blocks: the status, then how to fix it. */
export function agentProblem(id: CliAgentId, s: ConnectionStatus): string {
  const detail = s.detail.replace(/[.:]?\s*$/, "");
  if (s.fix?.action === "login") return `${detail}. Run \`${loginCommand(id)}\` in a terminal, or add an API key in Agent logins.`;
  return `${detail}.`;
}

export const agentLabel = (id: CliAgentId) => CLI_AGENTS[id].label.replace(/ \(experimental\)$/, "");

/** The binary the agent's status commands (and its login) run: the one the launch uses, or the user's override when it's the CLI itself. */
export function agentBinary(id: CliAgentId, launch: Launch, override: { command: string } | undefined, find: AgentCheckDeps["find"]): string | undefined {
  const env = { ...process.env, ...launch.env };
  if (override) return basename(override.command) === BINARY[id] ? override.command : undefined;
  if (id === "claude-code" && launch.env.CLAUDE_CODE_EXECUTABLE) return launch.env.CLAUDE_CODE_EXECUTABLE;
  if (id === "opencode") return launch.command;
  return find(BINARY[id], env);
}

export async function checkAgent(id: CliAgentId, deps: AgentCheckDeps): Promise<ConnectionStatus> {
  const label = agentLabel(id);
  const status = (p: Parsed, source: string, fix?: ConnectionStatus["fix"]): ConnectionStatus => ({
    id: `agent:${id}`,
    kind: "agent",
    owner: label,
    label,
    state: p.state,
    detail: p.detail,
    source,
    checkedAt: deps.now(),
    ...(fix ? { fix } : {}),
  });
  const launch = await deps.launch(id);
  if ("error" in launch) return status({ state: "needsAction", detail: launch.error }, "kernl", { label: "Check again", action: "check", target: `agent:${id}` });
  const override = deps.launchOverride(id);
  const binary = agentBinary(id, launch, override, deps.find);
  if (!binary) {
    if (override) return status({ state: "unknown", detail: "Starts with your command (kernl.agentCommands); its login isn't checked" }, "kernl.agentCommands");
    return status({ state: "needsAction", detail: `${label} isn't installed (no '${BINARY[id]}' command found)` }, "kernl", { label: "Check again", action: "check", target: `agent:${id}` });
  }
  if (await deps.hasStoredKey(id)) return status({ state: "ready", detail: "Uses the API key stored in kernl" }, "kernl");
  const target: CommandTarget = { path: binary, env: { ...process.env, ...launch.env }, cwd: deps.cwd };
  const login = { label: "Log in", action: "login" as const, target: id };
  if (id === "claude-code") {
    const [json, text] = await Promise.all([deps.run("claudeAuthJson", target), deps.run("claudeAuthText", target)]);
    const p = parseClaudeAuth(json, text);
    return status(p, "claude auth status", p.state === "needsAction" ? login : undefined);
  }
  if (id === "codex") {
    const p = parseCodexLogin(await deps.run("codexLoginStatus", target));
    return status(p, "codex login status", p.state === "needsAction" ? login : undefined);
  }
  return status(parseOpencodeAuth(await deps.run("opencodeAuthList", target)), "opencode auth list");
}
