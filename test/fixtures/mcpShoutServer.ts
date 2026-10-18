// Test-only MCP server over stdio with one tool, "shout". Each call is appended to the file named
// by SHOUT_CALL_LOG, so a test can prove whether the server was ever reached.
import { appendFileSync } from "node:fs";
import { McpServer } from "@modelcontextprotocol/server";
import { StdioServerTransport } from "@modelcontextprotocol/server/stdio";
import { z } from "zod";

const server = new McpServer({ name: "shout", version: "1.0.0" });
server.registerTool("shout", { description: "Uppercase the given text", inputSchema: z.object({ text: z.string() }) }, async ({ text }) => {
  if (process.env.SHOUT_CALL_LOG) appendFileSync(process.env.SHOUT_CALL_LOG, `${text}\n`);
  return { content: [{ type: "text", text: text.toUpperCase() }] };
});
await server.connect(new StdioServerTransport());
