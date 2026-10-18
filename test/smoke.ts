// Real-model smoke test (needs your keys; costs a few cents). For each provider whose env vars are
// set, runs the agent in a temp folder: list files, read package.json, report its name. Mutations
// are rejected. Prints the transcript of tool calls and the final answer; never prints keys.
//   ANTHROPIC_API_KEY + SMOKE_ANTHROPIC_MODEL
//   OPENAI_API_KEY    + SMOKE_OPENAI_MODEL
//   GOOGLE_API_KEY    + SMOKE_GOOGLE_MODEL
//   SMOKE_COMPAT_BASE_URL + SMOKE_COMPAT_MODEL (e.g. http://localhost:11434/v1, llama3.1)
import { mkdtempSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { buildAgent } from "../src/agent/createAgent";
import { AgentSession } from "../src/agent/session";
import { GatedBackend } from "../src/backend/gatedBackend";
import { NodeWorkspaceFiles } from "../src/backend/workspaceFiles";
import { ApprovalGate } from "../src/gate/approvalGate";
import { createChatModel, type ProviderSettings } from "../src/providers/registry";

const candidates: Array<{ settings: ProviderSettings; key?: string }> = [
  { settings: { provider: "anthropic", model: process.env.SMOKE_ANTHROPIC_MODEL ?? "", baseUrl: "" }, key: process.env.ANTHROPIC_API_KEY },
  { settings: { provider: "openai", model: process.env.SMOKE_OPENAI_MODEL ?? "", baseUrl: "" }, key: process.env.OPENAI_API_KEY },
  { settings: { provider: "google", model: process.env.SMOKE_GOOGLE_MODEL ?? "", baseUrl: "" }, key: process.env.GOOGLE_API_KEY },
  { settings: { provider: "openai-compatible", model: process.env.SMOKE_COMPAT_MODEL ?? "", baseUrl: process.env.SMOKE_COMPAT_BASE_URL ?? "" } },
];

async function smoke({ settings, key }: (typeof candidates)[number]) {
  const root = mkdtempSync(join(tmpdir(), "kernl-smoke-"));
  writeFileSync(join(root, "package.json"), JSON.stringify({ name: "smoke-target-4471" }));
  const gate = new ApprovalGate({ ask: async (_id, r) => (console.log(`    gate asked: ${r.kind} (rejected)`), false) }, { rules: () => [] });
  const backend = new GatedBackend(root, gate, new NodeWorkspaceFiles(), async () => ({ output: "", exitCode: 0, truncated: false }));
  const agent = buildAgent({ model: createChatModel(settings, key), workspaceBackend: backend, tools: [], loadProjectRules: false });
  let answer = "";
  const calls: string[] = [];
  let outcome = "";
  await new AgentSession(async () => agent, {
    text: (d) => (answer += d),
    toolCall: (_id, name, args) => calls.push(`${name}(${JSON.stringify(args)})`),
    toolResult: () => {},
    usage: (i, o) => console.log(`    tokens: ${i} in / ${o} out`),
    finished: (reason, message) => (outcome = message ? `${reason}: ${message}` : reason),
  }).send("List the files in the workspace, then read package.json and tell me the package name.");
  const ok = outcome === "done" && calls.some((c) => c.startsWith("ls") || c.startsWith("glob")) && calls.some((c) => c.startsWith("read_file")) && answer.includes("smoke-target-4471");
  console.log(`${ok ? "PASS" : "FAIL"}  ${settings.provider}/${settings.model}: ${outcome}\n    tool calls: ${calls.join(", ") || "none"}\n    answer: ${answer.trim().slice(0, 300)}`);
  return ok;
}

(async () => {
  const runnable = candidates.filter((c) => c.settings.model && (c.key || c.settings.provider === "openai-compatible") && (c.settings.provider !== "openai-compatible" || c.settings.baseUrl));
  if (!runnable.length) {
    console.log("No provider configured. Set e.g. ANTHROPIC_API_KEY and SMOKE_ANTHROPIC_MODEL, then rerun.");
    process.exit(1);
  }
  let failed = 0;
  for (const c of runnable) if (!(await smoke(c).catch((e) => (console.log(`FAIL  ${c.settings.provider}: ${e.message}`), false)))) failed++;
  process.exit(failed ? 1 : 0);
})();
