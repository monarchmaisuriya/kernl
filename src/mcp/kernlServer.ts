// kernl's own tools for the CLI agents (Claude Code, Codex, OpenCode), as an MCP server on this
// machine. One server per window; each workspace registers its tools and gets its own token, so a
// session only ever reaches the tools (terminal, jobs, approvals) of the workspace that started it.
// Every tool still asks through that workspace's approval gate.
import { randomBytes, timingSafeEqual } from "node:crypto";
import { createServer, type IncomingMessage, type Server, type ServerResponse } from "node:http";
import type { AddressInfo } from "node:net";
import { Readable } from "node:stream";
import type { StructuredToolInterface } from "@langchain/core/tools";
import { createMcpHandler, hostHeaderValidationResponse, localhostAllowedHostnames, localhostAllowedOrigins, McpServer, originValidationResponse } from "@modelcontextprotocol/server";

/** The name CLI agents know the server by: Claude Code calls its tools `mcp__kernl__<tool>`. */
export const KERNL_SERVER_NAME = "kernl";

/** How a CLI agent reaches one workspace's tools: an HTTP MCP server and its bearer token. */
export interface KernlServerAccess {
  url: string;
  headers: Record<string, string>;
}

type ContentBlock = { type: "text"; text: string } | { type: "image"; data: string; mimeType: string };

/** A LangChain tool's result as MCP content: a string is text; an array of text and image blocks is kept. */
export function toContent(result: unknown): ContentBlock[] {
  if (typeof result === "string") return [{ type: "text", text: result }];
  if (Array.isArray(result)) {
    return result.map((b: any): ContentBlock =>
      b?.type === "image" && typeof b.data === "string" ? { type: "image", data: b.data, mimeType: String(b.mimeType ?? "image/png") } : { type: "text", text: typeof b?.text === "string" ? b.text : JSON.stringify(b) },
    );
  }
  return [{ type: "text", text: JSON.stringify(result) }];
}

/** An MCP server offering these tools (one per request: the transport is stateless). */
function mcpServerFor(tools: readonly StructuredToolInterface[]): McpServer {
  const server = new McpServer({ name: KERNL_SERVER_NAME, version: "1.0.0" });
  for (const t of tools) {
    server.registerTool(t.name, { description: t.description, inputSchema: t.schema as any }, async (args: any, ctx: any) => {
      try {
        return { content: toContent(await t.invoke(args, { signal: ctx?.mcpReq?.signal })) };
      } catch (err: any) {
        return { content: [{ type: "text", text: `Error from ${t.name}: ${err?.message ?? String(err)}` }], isError: true };
      }
    });
  }
  return server;
}

const sameToken = (a: string, b: string) => a.length === b.length && timingSafeEqual(Buffer.from(a), Buffer.from(b));

export class KernlToolServer {
  private http: Server | undefined;
  private listening: Promise<string> | undefined;
  /** token -> the workspace's tools (read on each request, so they follow the workspace's current terminal and gate). */
  private workspaces = new Map<string, () => readonly StructuredToolInterface[]>();
  private handler = createMcpHandler((ctx) => mcpServerFor(this.workspaces.get(ctx.authInfo?.token ?? "")?.() ?? []), {
    onerror: (err) => this.log?.(`kernl tools server: ${err.message}`),
  });

  constructor(private log?: (line: string) => void) {}

  /** Starts the server on first use (127.0.0.1, a free port); resolves with its URL. */
  private start(): Promise<string> {
    this.listening ??= new Promise((resolve, reject) => {
      const http = createServer((req, res) => void this.serve(req, res));
      http.once("error", reject);
      http.listen(0, "127.0.0.1", () => resolve(`http://127.0.0.1:${(http.address() as AddressInfo).port}/mcp`));
      this.http = http;
    });
    return this.listening;
  }

  /** Makes a workspace's tools reachable; the token stays the same until `unregister`. */
  async register(tools: () => readonly StructuredToolInterface[]): Promise<KernlServerAccess & { unregister: () => void }> {
    const url = await this.start();
    const token = randomBytes(32).toString("hex");
    this.workspaces.set(token, tools);
    return { url, headers: { Authorization: `Bearer ${token}` }, unregister: () => this.workspaces.delete(token) };
  }

  private async serve(req: IncomingMessage, res: ServerResponse) {
    try {
      const request = toRequest(req);
      // Only this machine, only a known workspace's token. Browsers send an Origin; a page on any other origin is refused.
      const rejected = hostHeaderValidationResponse(request, localhostAllowedHostnames()) ?? originValidationResponse(request, localhostAllowedOrigins());
      if (rejected) return await send(res, rejected);
      const token = /^Bearer (\S+)$/.exec(request.headers.get("authorization") ?? "")?.[1] ?? "";
      const known = [...this.workspaces.keys()].find((t) => sameToken(t, token));
      if (!known) return await send(res, new Response(JSON.stringify({ error: "unknown or missing token" }), { status: 401, headers: { "content-type": "application/json" } }));
      await send(res, await this.handler.fetch(request, { authInfo: { token: known, clientId: "kernl", scopes: [] } }));
    } catch (err: any) {
      this.log?.(`kernl tools server: ${err?.message ?? err}`);
      if (!res.headersSent) res.writeHead(500).end();
      else res.end();
    }
  }

  async dispose() {
    this.workspaces.clear();
    await this.handler.close();
    await new Promise<void>((resolve) => (this.http ? this.http.close(() => resolve()) : resolve()));
    this.http?.closeAllConnections();
  }
}

/** A Node request as a web-standard Request (the MCP handler's face). */
function toRequest(req: IncomingMessage): Request {
  const headers = new Headers();
  for (const [name, value] of Object.entries(req.headers)) {
    if (Array.isArray(value)) for (const v of value) headers.append(name, v);
    else if (value !== undefined) headers.set(name, value);
  }
  const body = req.method === "GET" || req.method === "HEAD" ? undefined : (Readable.toWeb(req) as ReadableStream);
  return new Request(`http://${req.headers.host ?? "127.0.0.1"}${req.url ?? "/"}`, { method: req.method, headers, body, duplex: "half" } as RequestInit);
}

/** Writes a web Response (JSON or an SSE stream) to the Node response. */
async function send(res: ServerResponse, response: Response) {
  res.writeHead(response.status, Object.fromEntries(response.headers.entries()));
  if (!response.body) return void res.end();
  await new Promise<void>((resolve, reject) => {
    Readable.fromWeb(response.body as any).on("error", reject).pipe(res).on("finish", resolve).on("error", reject);
  });
}
