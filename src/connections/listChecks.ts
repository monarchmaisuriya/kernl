// Each CLI agent's MCP servers (claude.ai connectors arrive as Claude Code MCP servers) and Claude
// Code's plugins, from the agents' own list commands, run the way kernl launches the agent. `claude
// mcp list` connects to every server, so these run only when the Connections view opens or on Check
// now, never on a timer.
import { existsSync } from "node:fs";
import type { CliAgentId } from "../acp/agents";
import { type AgentCheckDeps, agentBinary, agentLabel } from "./agentChecks";
import { type ListedItem, type Parsed, parseClaudeMcpList, parseClaudePlugins, parseCodexMcpList, parseOpencodeMcpList } from "./parsers";
import type { CommandTarget, StatusCommand } from "./statusCommands";
import type { ConnectionStatus } from "./types";

const MCP_COMMAND: Record<CliAgentId, StatusCommand> = { "claude-code": "claudeMcpList", codex: "codexMcpList", opencode: "opencodeMcpList" };
const MCP_PARSER: Record<CliAgentId, (r: any) => ListedItem[] | Parsed> = { "claude-code": parseClaudeMcpList, codex: parseCodexMcpList, opencode: parseOpencodeMcpList };
const MCP_SOURCE: Record<CliAgentId, string> = { "claude-code": "claude mcp list", codex: "codex mcp list", opencode: "opencode mcp list" };

/** The agent's binary and launch environment, or undefined when it can't be run (then there's nothing to list). */
async function target(id: CliAgentId, deps: AgentCheckDeps): Promise<CommandTarget | undefined> {
  const launch = await deps.launch(id);
  if ("error" in launch) return undefined;
  const path = agentBinary(id, launch, deps.launchOverride(id), deps.find);
  return path ? { path, env: { ...process.env, ...launch.env }, cwd: deps.cwd } : undefined;
}

/** One row per server; a list that can't be read is one "unknown" row for the agent's MCP servers. */
export async function checkAgentMcp(id: CliAgentId, deps: AgentCheckDeps): Promise<ConnectionStatus[]> {
  const t = await target(id, deps);
  if (!t) return [];
  const owner = agentLabel(id);
  const parsed = MCP_PARSER[id](await deps.run(MCP_COMMAND[id], t));
  const now = deps.now();
  if (!Array.isArray(parsed)) return [{ id: `mcp:${id}`, kind: "mcp", owner, label: "MCP servers", state: parsed.state, detail: parsed.detail, source: MCP_SOURCE[id], checkedAt: now }];
  return parsed.map((item) => ({
    id: `mcp:${id}:${item.name}`,
    kind: "mcp" as const,
    owner,
    label: item.name,
    state: item.state,
    detail: item.detail,
    source: MCP_SOURCE[id],
    checkedAt: now,
    // A server that needs a sign-in signs in inside the agent itself (Claude Code: /mcp).
    ...(item.state === "needsAction" && id === "claude-code" ? { fix: { label: "How to sign in", action: "login" as const, target: `mcp:${id}:${item.name}` } } : {}),
  }));
}

/** Claude Code's installed plugins; an enabled plugin whose folder is gone has failed. */
export async function checkClaudePlugins(deps: AgentCheckDeps): Promise<ConnectionStatus[]> {
  const t = await target("claude-code", deps);
  if (!t) return [];
  const parsed = parseClaudePlugins(await deps.run("claudePluginList", t));
  const now = deps.now();
  if (!Array.isArray(parsed)) return [{ id: "plugin:claude-code", kind: "plugin", owner: "Claude Code", label: "Plugins", state: parsed.state, detail: parsed.detail, source: "claude plugin list", checkedAt: now }];
  return parsed.map((p) => {
    const missing = p.state === "ready" && p.installPath !== undefined && !existsSync(p.installPath);
    return {
      id: `plugin:claude-code:${p.name}`,
      kind: "plugin" as const,
      owner: "Claude Code",
      label: p.name.replace(/@.*$/, ""),
      state: missing ? ("failed" as const) : p.state,
      detail: missing ? "Enabled, but its folder is missing: reinstall it in Claude Code" : p.detail,
      source: "claude plugin list",
      checkedAt: now,
    };
  });
}
