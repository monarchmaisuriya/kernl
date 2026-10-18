// Bundles the extension (Node, CommonJS), the webview script (browser), and, with --tests, every test entry.
import { build } from "esbuild";
import { readdirSync } from "node:fs";
import { join } from "node:path";

const production = process.argv.includes("--production");
const withTests = process.argv.includes("--tests");
const node = { bundle: true, platform: "node", format: "cjs", target: "node20", external: ["vscode"], logLevel: "warning", sourcemap: !production, minify: production };

await build({ ...node, entryPoints: ["src/extension.ts"], outfile: "out/extension.cjs" });
await build({ bundle: true, platform: "browser", format: "iife", target: "es2022", logLevel: "warning", minify: production, entryPoints: ["src/webview/main.ts"], outfile: "out/webview/main.js" });

if (withTests) {
  const ts = (dir) => readdirSync(dir).filter((f) => f.endsWith(".ts")).map((f) => join(dir, f));
  for (const file of [...ts("test/unit"), ...ts("test/vscode"), ...ts("test/live"), "test/backendMethods.ts", "test/runVscode.ts", "test/smoke.ts", "test/probeAgents.ts", "test/fixtures/fakeAcpAgent.ts"]) {
    // jsdom loads its own files at runtime, so tests require it from node_modules instead of bundling it.
    await build({ ...node, external: ["vscode", "jsdom"], entryPoints: [file], outfile: join("out/test", file.split("/").pop().replace(/\.ts$/, ".cjs")) });
  }
  // The MCP fixture server uses top-level await, so it is an ES module.
  await build({
    ...node,
    format: "esm",
    entryPoints: ["test/fixtures/mcpShoutServer.ts"],
    outfile: "out/test/mcpShoutServer.mjs",
    banner: { js: "import { createRequire } from 'node:module'; const require = createRequire(import.meta.url);" },
  });
}
