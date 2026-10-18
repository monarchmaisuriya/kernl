import { MultiServerMCPClient } from "@langchain/mcp-adapters";
import type { ApprovalGate } from "../gate/approvalGate";
import { gatedTool } from "../gate/gatedTool";

/** Shape of the yourstack.mcpServers setting: name -> local command or remote URL. */
export type McpServerSetting = { command: string; args?: string[]; env?: Record<string, string> } | { url: string };

/** Fails fast with the offending server name instead of a deep adapter error. */
export function toMcpConnections(setting: unknown): Record<string, any> {
  if (setting === null || typeof setting !== "object" || Array.isArray(setting)) {
    throw new Error(`Expected yourstack.mcpServers to be an object of servers, got ${JSON.stringify(setting)}`);
  }
  const out: Record<string, any> = {};
  for (const [name, server] of Object.entries(setting as Record<string, any>)) {
    if (typeof server?.command === "string") out[name] = { transport: "stdio", command: server.command, args: server.args ?? [], env: server.env };
    else if (typeof server?.url === "string") out[name] = { url: server.url };
    else throw new Error(`Expected yourstack.mcpServers.${name} to have a "command" or a "url", got ${JSON.stringify(server)}`);
  }
  return out;
}

/** Connects to the configured MCP servers. Every MCP tool asks before it runs. */
export async function loadMcpTools(setting: unknown, gate: ApprovalGate) {
  const connections = toMcpConnections(setting);
  if (Object.keys(connections).length === 0) return { tools: [], close: async () => {} };
  const client = new MultiServerMCPClient({ mcpServers: connections, prefixToolNameWithServerName: true, throwOnLoadError: true } as any);
  const tools = await client.getTools();
  return { tools: tools.map((t) => gatedTool(t, gate, "ask")), close: () => client.close() };
}
