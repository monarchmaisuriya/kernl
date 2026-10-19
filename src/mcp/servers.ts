import { MultiServerMCPClient } from "@langchain/mcp-adapters";
import type { ApprovalGate } from "../gate/approvalGate";
import { gatedTool } from "../gate/gatedTool";
import type { ImportedMcpServer, McpConnection, Skipped } from "../sources/types";

/** Shape of the kernl.mcpServers setting: name -> local command or remote URL (with optional headers). */
export type McpServerSetting = { command: string; args?: string[]; env?: Record<string, string> } | { url: string; headers?: Record<string, string> };

/** One server kernl's own agent may connect to, from kernl.mcpServers or another agent's setup. */
export interface McpServer {
  name: string;
  connection: McpConnection;
  /** "kernl.mcpServers", or where it was imported from. */
  origin: string;
  /** From a file in the project: asks once before it first starts. */
  project: boolean;
}

/** kernl.mcpServers as servers. Fails fast with the offending server name instead of a deep adapter error. */
export function settingServers(setting: unknown): McpServer[] {
  if (setting === null || typeof setting !== "object" || Array.isArray(setting)) {
    throw new Error(`Expected kernl.mcpServers to be an object of servers, got ${JSON.stringify(setting)}`);
  }
  return Object.entries(setting as Record<string, any>).map(([name, server]) => {
    const origin = "kernl.mcpServers";
    if (typeof server?.command === "string") return { name, origin, project: false, connection: { command: server.command, args: server.args ?? [], env: server.env } };
    if (typeof server?.url === "string") return { name, origin, project: false, connection: { url: server.url, transport: "http", headers: server.headers } };
    throw new Error(`Expected kernl.mcpServers.${name} to have a "command" or a "url", got ${JSON.stringify(server)}`);
  });
}

/** kernl.mcpServers first, then the imported servers; on the same name the first wins and the rest are reported. */
export function mergeServers(own: McpServer[], imported: readonly ImportedMcpServer[]): { servers: McpServer[]; skipped: Skipped[] } {
  const servers = [...own];
  const skipped: Skipped[] = [];
  for (const s of imported) {
    const first = servers.find((o) => o.name === s.name);
    if (first) skipped.push({ item: `MCP server ${s.name}`, origin: s.origin, reason: `same name as the one from ${first.origin}` });
    else servers.push(s);
  }
  return { servers, skipped };
}

/** The adapter's connection for one server. */
export function adapterConnection(c: McpConnection): Record<string, unknown> {
  if ("command" in c) return { transport: "stdio", command: c.command, args: c.args, env: c.env };
  return { transport: c.transport, url: c.url, headers: c.headers };
}

/** Whether a connection error means "sign in first": an HTTP 401 or the SDK's UnauthorizedError, on the error or its causes (the adapter wraps it). */
export function needsSignIn(err: unknown): boolean {
  let current: any = err;
  for (let depth = 0; depth < 4 && current; depth++, current = current.cause) {
    if (current.name === "UnauthorizedError" || current.status === 401) return true;
  }
  return false;
}

/**
 * Remote servers that answered "sign in first" in this window (an OAuth server Claude Code signs in
 * to itself). kernl's agent doesn't sign in to them: they aren't tried again until the window
 * reloads, and the Sources view lists them.
 */
export class SignInRequired {
  private servers = new Map<string, McpServer>();
  private key = (s: McpServer) => `${s.name}\0${"url" in s.connection ? s.connection.url : s.connection.command}`;
  has(s: McpServer) {
    return this.servers.has(this.key(s));
  }
  add(s: McpServer) {
    this.servers.set(this.key(s), s);
  }
  list(): McpServer[] {
    return [...this.servers.values()];
  }
}

/** Why an OAuth server isn't used, as the Sources view says it. */
export const SIGN_IN_REASON = "needs a sign-in (OAuth): use it in its own agent";

export interface McpLoadOptions {
  /** How long one tool call (and connecting to a server) may take. */
  timeoutMs: number;
  /** Asked before a project server first starts; false leaves it out. */
  allowProjectServer: (server: McpServer) => Promise<boolean>;
  log?: (line: string) => void;
}

/**
 * Connects to each server on its own, so one that fails or hangs doesn't stop the others. Every MCP
 * tool asks before it runs. Servers that can't connect are returned in `failures` with the reason;
 * `signIn` marks one that wants a sign-in first.
 */
export async function loadMcpTools(servers: readonly McpServer[], gate: ApprovalGate, opts: McpLoadOptions) {
  const clients: MultiServerMCPClient[] = [];
  const tools: ReturnType<typeof gatedTool>[] = [];
  const failures: { server: McpServer; reason: string; signIn: boolean }[] = [];
  for (const server of servers) {
    if (server.project && !(await opts.allowProjectServer(server))) {
      failures.push({ server, reason: "not allowed to start in this workspace", signIn: false });
      continue;
    }
    const client = new MultiServerMCPClient({
      mcpServers: { [server.name]: adapterConnection(server.connection) },
      prefixToolNameWithServerName: true,
      throwOnLoadError: true,
      defaultToolTimeout: opts.timeoutMs,
    } as any);
    let timer: NodeJS.Timeout | undefined;
    try {
      const timeout = new Promise<never>((_, reject) => {
        timer = setTimeout(() => reject(new Error(`didn't answer within ${Math.round(opts.timeoutMs / 1000)} s`)), opts.timeoutMs);
      });
      const loaded = await Promise.race([client.getTools(), timeout]);
      tools.push(...loaded.map((t) => gatedTool(t, gate, "ask")));
      clients.push(client);
    } catch (err: any) {
      const signIn = needsSignIn(err);
      failures.push({ server, reason: signIn ? SIGN_IN_REASON : (err?.message ?? String(err)), signIn });
      // Not awaited: for a server that never answered, the adapter's close waits for the connection
      // attempt to end (the MCP SDK's own request timeout), then stops the server.
      void client.close().catch((e: any) => opts.log?.(`MCP server ${server.name}: couldn't stop it: ${e?.message ?? e}`));
    } finally {
      clearTimeout(timer);
    }
  }
  return { tools, failures, close: async () => void (await Promise.all(clients.map((c) => c.close()))) };
}
