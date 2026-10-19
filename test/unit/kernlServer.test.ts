// kernl's MCP server for the CLI agents: only a registered workspace's token gets in, each token
// reaches only its own workspace's tools, a web page's Origin is refused, and results keep images.
import { strict as assert } from "node:assert";
import { test } from "node:test";
import { tool } from "@langchain/core/tools";
import { MultiServerMCPClient } from "@langchain/mcp-adapters";
import { z } from "zod";
import { KernlToolServer, toContent } from "../../src/mcp/kernlServer";

const echo = (label: string) =>
  tool(async ({ text }: { text: string }) => `${label}: ${text}`, { name: "echo", description: "Echo text", schema: z.object({ text: z.string() }) as any });

async function connect(url: string, headers: Record<string, string>) {
  const client = new MultiServerMCPClient({ mcpServers: { kernl: { transport: "http", url, headers } }, throwOnLoadError: true, prefixToolNameWithServerName: false } as any);
  return { client, tools: await client.getTools() };
}

test("each workspace's token reaches only that workspace's tools", async () => {
  const server = new KernlToolServer();
  try {
    const a = await server.register(() => [echo("A")]);
    const b = await server.register(() => [echo("B")]);
    assert.equal(a.url, b.url, "one server per window");
    assert.notEqual(a.headers.Authorization, b.headers.Authorization);
    for (const [access, label] of [[a, "A"], [b, "B"]] as const) {
      const { client, tools } = await connect(access.url, access.headers);
      try {
        assert.deepEqual(tools.map((t) => t.name), ["echo"]);
        assert.match(JSON.stringify(await tools[0].invoke({ text: "hi" })), new RegExp(`${label}: hi`));
      } finally {
        await client.close();
      }
    }
  } finally {
    await server.dispose();
  }
});

test("a missing or unknown token, or an unregistered workspace's, is refused", async () => {
  const server = new KernlToolServer();
  try {
    const a = await server.register(() => [echo("A")]);
    const body = JSON.stringify({ jsonrpc: "2.0", id: 1, method: "tools/list", params: {} });
    const post = (headers: Record<string, string>) => fetch(a.url, { method: "POST", headers: { "content-type": "application/json", accept: "application/json, text/event-stream", ...headers }, body });
    assert.equal((await post({})).status, 401);
    assert.equal((await post({ Authorization: "Bearer not-the-token" })).status, 401);
    a.unregister();
    assert.equal((await post(a.headers)).status, 401);
  } finally {
    await server.dispose();
  }
});

test("a request from a web page (a foreign Origin) is refused even with the token", async () => {
  const server = new KernlToolServer();
  try {
    const a = await server.register(() => [echo("A")]);
    const res = await fetch(a.url, {
      method: "POST",
      headers: { "content-type": "application/json", accept: "application/json, text/event-stream", origin: "https://evil.example.com", ...a.headers },
      body: JSON.stringify({ jsonrpc: "2.0", id: 1, method: "tools/list", params: {} }),
    });
    assert.equal(res.status, 403);
  } finally {
    await server.dispose();
  }
});

test("a tool's text and image results become MCP content; a failing tool is an error result, not a crash", async () => {
  assert.deepEqual(toContent("plain"), [{ type: "text", text: "plain" }]);
  assert.deepEqual(toContent([{ type: "text", text: "shot:" }, { type: "image", mimeType: "image/png", data: "AAA" }]), [
    { type: "text", text: "shot:" },
    { type: "image", data: "AAA", mimeType: "image/png" },
  ]);
  const server = new KernlToolServer();
  try {
    const failing = tool(async () => {
      throw new Error("no page open");
    }, { name: "broken", description: "Fails", schema: z.object({}) as any });
    const a = await server.register(() => [failing]);
    const { client, tools } = await connect(a.url, a.headers);
    try {
      const out = await tools[0].invoke({}).catch((err: any) => String(err?.message ?? err));
      assert.match(JSON.stringify(out), /Error from broken: no page open/);
    } finally {
      await client.close();
    }
  } finally {
    await server.dispose();
  }
});
