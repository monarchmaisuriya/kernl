// Runs inside a real VS Code opened on a multi-root workspace (two git repos, alpha and beta; see
// runVscode.ts, YOURSTACK_WORKSPACE=multi): each folder is its own workspace with its own agent,
// sends run in the right folder, worktrees belong to their folder, and Agent logins can switch agents.
import { strict as assert } from "node:assert";
import { existsSync, mkdirSync, mkdtempSync, readFileSync, realpathSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import * as vscode from "vscode";
import { git } from "../../src/workspaces/git";

const results: string[] = [];
async function check(name: string, fn: () => Promise<void>) {
  try {
    await fn();
    results.push(`PASS  ${name}`);
  } catch (e: any) {
    results.push(`FAIL  ${name}\n      ${String(e?.message ?? e).split("\n").filter((l) => l.trim()).slice(0, 8).join("\n      ")}`);
  }
}

export async function run() {
  const folders = vscode.workspace.workspaceFolders!;
  const [alpha, beta] = folders.map((f) => f.uri.fsPath);
  const ext = vscode.extensions.getExtension("local.yourstack")!;
  const { testing } = await ext.activate();
  const delivered: any[] = [];
  testing.onDidDeliver((m: any) => delivered.push(m));
  const waitFor = async (what: string, pred: (m: any) => boolean, from = 0, timeoutMs = 20_000) => {
    const deadline = Date.now() + timeoutMs;
    while (Date.now() < deadline) {
      const hit = delivered.slice(from).find(pred);
      if (hit) return hit;
      await new Promise((r) => setTimeout(r, 50));
    }
    throw new Error(`timed out waiting for the panel to receive ${what}`);
  };
  const lastWorkspaces = () => delivered.filter((m) => m.type === "workspaces").at(-1);
  const harnessOf = (id: string) => lastWorkspaces()?.items.find((w: any) => w.id === id)?.harness;
  // `menu` picks a QuickPick item by label; `inputs` answers input boxes in order.
  let scripted: { menu?: RegExp[]; inputs?: string[] } = {};
  const menusShown: any[][] = [];
  testing.usePrompts({
    input: async () => scripted.inputs?.shift(),
    pick: async (items: any[]) => {
      menusShown.push(items);
      const re = scripted.menu?.shift();
      return re ? items.find((i) => i.kind !== -1 && re.test(i.label)) : undefined;
    },
    confirm: async () => true,
  });
  const fakeAgent = { command: process.execPath, args: [join(__dirname, "fakeAcpAgent.cjs")], env: { FAKE_SCENARIO: "write" } };
  const config = vscode.workspace.getConfiguration("yourstack");
  await config.update("agentCommands", { "claude-code": fakeAgent }, vscode.ConfigurationTarget.Global);

  await check("multi-root: the panel lists each folder as its own workspace, labeled by folder name", async () => {
    await vscode.commands.executeCommand("yourstack.panel.focus");
    const ws = await waitFor("the folders", (m) => m.type === "workspaces" && m.items.length === 2);
    assert.deepEqual(ws.items.map((w: any) => [w.id, w.label]), [["folder:alpha", "alpha"], ["folder:beta", "beta"]]);
    assert.equal(ws.problem, undefined);
  });

  await check("multi-root: each folder keeps its own agent; a message sent in beta runs there (not in alpha)", async () => {
    await testing.setHarness("folder:beta", "claude-code");
    assert.equal(harnessOf("folder:beta"), "claude-code");
    assert.equal(harnessOf("folder:alpha"), "deepagents", "alpha keeps its own agent");
    const from = delivered.length;
    const sending = testing.receive({ type: "send", workspace: "folder:beta", text: "write hello.txt" });
    const card = (await waitFor("an approval card", (m) => m.type === "approval", from)).card;
    assert.equal(card.workspace, "beta");
    await testing.receive({ type: "answer", id: card.id, approved: true });
    await sending;
    assert.equal(readFileSync(join(beta, "hello.txt"), "utf8"), "hi\n");
    assert.equal(existsSync(join(alpha, "hello.txt")), false);
    rmSync(join(beta, "hello.txt"));
  });

  await check("multi-root: a new worktree workspace comes from the shown folder's repository", async () => {
    await testing.receive({ type: "focus", workspace: "folder:beta" });
    scripted = { inputs: ["feature"], menu: [/YourStack/] };
    const from = delivered.length;
    await vscode.commands.executeCommand("yourstack.newWorkspace");
    const ws = await waitFor("the worktree workspace", (m) => m.type === "workspaces" && m.items.some((w: any) => w.id === "wt:beta/feature"), from);
    const item = ws.items.find((w: any) => w.id === "wt:beta/feature");
    assert.equal(item.label, "beta/feature");
    assert.equal(ws.focus, "wt:beta/feature");
    const list = await git(beta, ["worktree", "list", "--porcelain"]);
    assert.match(list, /branch refs\/heads\/yourstack\/feature/, "the branch is in beta's repo");
    assert.doesNotMatch(await git(alpha, ["branch", "--list", "yourstack/*"]), /feature/, "not in alpha's");
  });

  await check("Agent logins: a ready agent can be used in the shown workspace right away", async () => {
    await testing.receive({ type: "focus", workspace: "folder:alpha" });
    scripted = { menu: [/^Claude Code$/, /^Use Claude Code in this workspace$/] };
    await vscode.commands.executeCommand("yourstack.agentLogins");
    const actions = menusShown.at(-1)!.map((i: any) => i.label);
    assert.equal(actions[0], "Use Claude Code in this workspace", JSON.stringify(actions));
    assert.equal(harnessOf("folder:alpha"), "claude-code");
  });

  await check("multi-root: adding a folder adds a workspace; each folder's agent choice is kept across the reload", async () => {
    const gamma = join(realpathSync(mkdtempSync(join(tmpdir(), "yourstack-gamma-"))), "gamma");
    mkdirSync(gamma);
    const from = delivered.length;
    vscode.workspace.updateWorkspaceFolders(folders.length, 0, { uri: vscode.Uri.file(gamma) });
    const ws = await waitFor("three folders", (m) => m.type === "workspaces" && m.items.some((w: any) => w.id === "folder:gamma"), from);
    const harness = (id: string) => ws.items.find((w: any) => w.id === id)?.harness;
    assert.deepEqual([harness("folder:alpha"), harness("folder:beta"), harness("folder:gamma")], ["claude-code", "claude-code", "deepagents"]);
    assert.ok(ws.items.some((w: any) => w.id === "wt:beta/feature"), "worktrees are found again");
  });

  await config.update("agentCommands", undefined, vscode.ConfigurationTarget.Global);
  console.log("\n===== VSCODE RESULTS (multi-root) =====\n" + results.join("\n") + "\n==========================\n");
  if (results.some((r) => r.startsWith("FAIL"))) throw new Error("integration checks failed");
}
