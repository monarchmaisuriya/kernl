// Opt-in live suite (npm run test:live): the real controller and panel seam drive the agent CLIs
// installed on this machine. Costs a few tiny prompts on your accounts (OpenCode can use a free model).
// Per agent: approve writes the file; a follow-up turn remembers the first; reject writes nothing;
// Stop ends a run that is waiting on a card. DeepSeek checks run only when DEEPSEEK_API_KEY is set.
import { strict as assert } from "node:assert";
import { existsSync, readFileSync, rmSync } from "node:fs";
import { createServer } from "node:http";
import { join } from "node:path";
import * as vscode from "vscode";
import { type CliAgentId, CLI_AGENTS, resolveLaunch } from "../../src/acp/agents";

const results: string[] = [];
async function check(name: string, fn: () => Promise<void | string>) {
  try {
    const skipped = await fn();
    results.push(skipped ? `SKIP  ${name}: ${skipped}` : `PASS  ${name}`);
  } catch (e: any) {
    results.push(`FAIL  ${name}\n      ${String(e?.message ?? e).split("\n").filter((l) => l.trim()).slice(0, 8).join("\n      ")}`);
  }
}

const RUN_TIMEOUT_MS = 240_000;

export async function run() {
  try {
    await liveChecks();
  } finally {
    console.log("\n===== LIVE RESULTS =====\n" + results.join("\n") + "\n========================\n");
  }
  if (results.some((r) => r.startsWith("FAIL"))) throw new Error("live checks failed");
}

async function liveChecks() {
  const root = vscode.workspace.workspaceFolders![0].uri.fsPath;
  const ext = vscode.extensions.getExtension("local.kernl")!;
  const { keys, agentCredentials, testing } = await ext.activate();
  const config = () => vscode.workspace.getConfiguration("kernl");
  const delivered: any[] = [];
  testing.onDidDeliver((m: any) => delivered.push(m));
  const waitFor = async (what: string, pred: (m: any) => boolean, from: number, timeoutMs = RUN_TIMEOUT_MS) => {
    const deadline = Date.now() + timeoutMs;
    while (Date.now() < deadline) {
      const hit = delivered.slice(from).find(pred);
      if (hit) return hit;
      await new Promise((r) => setTimeout(r, 100));
    }
    throw new Error(`timed out after ${timeoutMs / 1000}s waiting for ${what}; last messages: ${JSON.stringify(delivered.slice(-4)).slice(0, 600)}`);
  };
  await vscode.commands.executeCommand("kernl.panel.focus");
  await waitFor("the panel handshake", (m) => m.type === "workspaces", 0, 20_000);

  /** Sends one prompt on Main and answers every card with `approve` until the run ends. */
  async function turn(text: string, approve: boolean) {
    const from = delivered.length;
    const answered = new Set<string>();
    const sending = testing.receive({ type: "send", workspace: "main", text });
    const deadline = Date.now() + RUN_TIMEOUT_MS;
    let finished: any;
    while (!(finished = delivered.slice(from).find((m) => m.type === "finished" && m.workspace === "main"))) {
      if (Date.now() > deadline) throw new Error(`run did not finish within ${RUN_TIMEOUT_MS / 1000}s`);
      for (const m of delivered.slice(from)) {
        if (m.type !== "approval" || answered.has(m.card.id)) continue;
        answered.add(m.card.id);
        await testing.receive({ type: "answer", id: m.card.id, approved: approve });
      }
      await new Promise((r) => setTimeout(r, 100));
    }
    await sending;
    const reply = delivered.slice(from).filter((m) => m.type === "text" && m.workspace === "main").map((m) => m.delta).join("");
    return { finished, cards: answered.size, reply };
  }

  async function useHarness(harness: string) {
    const from = delivered.length;
    await testing.setHarness("main", harness);
    await waitFor(`Main on ${harness}`, (m) => m.type === "workspaces" && m.items[0].harness === harness, from, 20_000);
    await vscode.commands.executeCommand("kernl.newChat");
  }

  // Through the commands, so the controller restarts the agents that read the key, as for a user.
  async function useDeepSeekForClaudeCode(key: string) {
    testing.usePrompts({ input: async () => key, pick: async () => undefined, confirm: async () => false });
    await vscode.commands.executeCommand("kernl.useDeepSeekForClaudeCode");
  }
  const clearKeys = () => vscode.commands.executeCommand("kernl.clearKeys");

  const writePrompt = (file: string) => `Create a file named ${file} in the current directory containing exactly the word hi. Use your file write tool. Do nothing else.`;

  async function approveRejectFollowUp(label: string, harness: string) {
    await check(`${label}: approve writes the file, and a follow-up turn remembers it`, async () => {
      await useHarness(harness);
      const file = `live-${harness}-approved.txt`;
      rmSync(join(root, file), { force: true });
      const first = await turn(writePrompt(file), true);
      assert.equal(first.finished.reason, "done", `run ended ${first.finished.reason}: ${first.finished.message ?? ""}`);
      assert.ok(first.cards > 0, "the write asked first");
      assert.equal(readFileSync(join(root, file), "utf8").trim(), "hi");
      const second = await turn("What was the exact name of the file you just created? Reply with only the file name, and do not use any tools.", false);
      assert.equal(second.finished.reason, "done");
      assert.match(second.reply, new RegExp(file.replace(/\./g, "\\.")), `reply was: ${second.reply.slice(0, 300)}`);
      rmSync(join(root, file), { force: true });
    });
    await check(`${label}: reject writes nothing`, async () => {
      await vscode.commands.executeCommand("kernl.newChat");
      const file = `live-${harness}-rejected.txt`;
      rmSync(join(root, file), { force: true });
      const result = await turn(writePrompt(file), false);
      assert.ok(result.cards > 0, "the write asked first");
      assert.notEqual(result.finished.reason, "error", result.finished.message);
      assert.equal(existsSync(join(root, file)), false);
    });
  }

  async function stopWhileWaiting(label: string, harness: string) {
    await check(`${label}: Stop ends a run that is waiting on a card`, async () => {
      await vscode.commands.executeCommand("kernl.newChat");
      const file = `live-${harness}-stopped.txt`;
      const from = delivered.length;
      const sending = testing.receive({ type: "send", workspace: "main", text: writePrompt(file) });
      const card = (await waitFor("an approval card", (m) => m.type === "approval", from)).card;
      const stoppedAt = Date.now();
      await testing.receive({ type: "stop", workspace: "main" });
      const finished = await waitFor("the run finishing", (m) => m.type === "finished" && m.workspace === "main", from, 15_000);
      await sending;
      assert.equal(finished.reason, "stopped");
      assert.ok(delivered.slice(from).some((m) => m.type === "approvalClosed" && m.id === card.id), "the card was withdrawn");
      assert.ok(Date.now() - stoppedAt < 10_000, "stopped within 10 s");
      assert.equal(existsSync(join(root, file)), false);
    });
  }

  for (const id of ["claude-code", "opencode"] as CliAgentId[]) {
    const label = CLI_AGENTS[id].label;
    const launch = resolveLaunch(id, undefined);
    if ("error" in launch) {
      await check(`${label}: all scenarios`, async () => launch.error);
      continue;
    }
    await approveRejectFollowUp(label, id);
    await stopWhileWaiting(label, id);
  }

  // Which credential leaves the machine? A localhost server stands in for the endpoint and answers 401.
  // A logged-in Claude Code sends its login instead of ANTHROPIC_API_KEY unless its config folder is
  // isolated, so this asserts our key, and only our key, is sent. Nothing reaches a third party.
  await check("Claude Code with a stored key sends exactly that key to the endpoint, never your login", async () => {
    if ("error" in resolveLaunch("claude-code", undefined)) return "Claude Code is not installed";
    const testKey = "sk-kernl-live-capture-0000";
    const seen: { apiKey?: string; authorization?: string }[] = [];
    const server = createServer((req, res) => {
      if (req.url?.startsWith("/v1/messages")) seen.push({ apiKey: req.headers["x-api-key"] as string | undefined, authorization: req.headers.authorization });
      req.resume();
      res.writeHead(401, { "content-type": "application/json" });
      res.end(JSON.stringify({ type: "error", error: { type: "authentication_error", message: "capture server: invalid x-api-key" } }));
    });
    await new Promise<void>((r) => server.listen(0, "127.0.0.1", r));
    await agentCredentials.store("claude-code", { apiKey: testKey, baseUrl: `http://127.0.0.1:${(server.address() as any).port}` });
    try {
      // Switch away and back so Main starts a fresh Claude Code with the stored credential.
      await useHarness("opencode");
      await useHarness("claude-code");
      // The credential is fixed on the first request and every retry repeats it, so look at the first
      // requests (10 s after the first), then Stop instead of waiting out Claude Code's ~4 min of retries.
      const file = "live-capture.txt";
      const from = delivered.length;
      const sending = testing.receive({ type: "send", workspace: "main", text: writePrompt(file) });
      const deadline = Date.now() + 120_000;
      while (!seen.length && Date.now() < deadline) await new Promise((r) => setTimeout(r, 100));
      assert.ok(seen.length > 0, `no request reached the endpoint within 120 s; last messages: ${JSON.stringify(delivered.slice(-3)).slice(0, 400)}`);
      await new Promise((r) => setTimeout(r, 10_000));
      await testing.receive({ type: "stop", workspace: "main" });
      const finished = await waitFor("the run finishing", (m) => m.type === "finished" && m.workspace === "main", from, 15_000);
      await sending;
      const describe = (v?: string) => (v ? `...${v.slice(-4)} (${v.length} chars)` : "none");
      for (const r of seen) {
        assert.equal(r.authorization, undefined, `an Authorization header was sent: ${describe(r.authorization)}`);
        assert.ok(r.apiKey === testKey, `x-api-key was ${describe(r.apiKey)}, not the stored key`);
      }
      assert.ok(!delivered.slice(from).some((m) => m.type === "approval"), "no card: the model was never reached");
      assert.equal(finished.reason, "stopped");
      assert.equal(existsSync(join(root, file)), false);
    } finally {
      server.close();
      await clearKeys();
    }
  });

  const deepseekKey = process.env.DEEPSEEK_API_KEY;
  await check("Deep Agents on DeepSeek: approve writes the file, and a follow-up turn remembers it", async () => {
    if (!deepseekKey) return "DEEPSEEK_API_KEY is not set";
    await keys.store("deepseek", deepseekKey);
    await config().update("provider", "deepseek", vscode.ConfigurationTarget.Global);
    await config().update("model", "", vscode.ConfigurationTarget.Global);
    try {
      await useHarness("deepagents");
      const file = "live-deepseek-approved.txt";
      rmSync(join(root, file), { force: true });
      const first = await turn(writePrompt(file), true);
      assert.equal(first.finished.reason, "done", `run ended ${first.finished.reason}: ${first.finished.message ?? ""}`);
      assert.equal(readFileSync(join(root, file), "utf8").trim(), "hi");
      const second = await turn("What was the exact name of the file you just created? Reply with only the file name, and do not use any tools.", false);
      assert.match(second.reply, /live-deepseek-approved\.txt/, `reply was: ${second.reply.slice(0, 300)}`);
      rmSync(join(root, file), { force: true });
    } finally {
      await clearKeys();
    }
  });

  await check("Claude Code on DeepSeek: approve writes the file", async () => {
    if (!deepseekKey) return "DEEPSEEK_API_KEY is not set";
    if ("error" in resolveLaunch("claude-code", undefined)) return "Claude Code is not installed";
    await useDeepSeekForClaudeCode(deepseekKey);
    try {
      await useHarness("claude-code");
      const file = "live-claude-deepseek.txt";
      rmSync(join(root, file), { force: true });
      const result = await turn(writePrompt(file), true);
      assert.equal(result.finished.reason, "done", `run ended ${result.finished.reason}: ${result.finished.message ?? ""}`);
      assert.equal(readFileSync(join(root, file), "utf8").trim(), "hi");
      rmSync(join(root, file), { force: true });
    } finally {
      await clearKeys();
    }
  });
}
