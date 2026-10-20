// Runs inside a real VS Code opened on a multi-root workspace (two git repos, alpha and beta; see
// runVscode.ts, KERNL_WORKSPACE=multi): each folder is its own workspace with its own agent,
// sends run in the right folder, worktrees belong to their folder, and Agent logins can switch agents.
import { strict as assert } from "node:assert";
import { existsSync, mkdirSync, mkdtempSync, readFileSync, realpathSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import * as vscode from "vscode";
import { git } from "../../src/workspaces/git";
import { agentCommands } from "../support/noRealAgents";

const results: string[] = [];
/**
 * What the panel received and what was sent to the controller, with times (ms since the suite
 * started). A failing check prints its own part (the last 40 lines), so a failure shows its order of events.
 */
const timeline: string[] = [];
const started = Date.now();
const at = () => String(Date.now() - started).padStart(7);
async function check(name: string, fn: () => Promise<void>) {
  const from = timeline.length;
  timeline.push(`${at()} --- check: ${name.slice(0, 80)}`);
  try {
    await fn();
    results.push(`PASS  ${name}`);
  } catch (e: any) {
    const lines = timeline.slice(from).slice(-40);
    results.push(`FAIL  ${name}\n      ${String(e?.message ?? e).split("\n").filter((l) => l.trim()).slice(0, 8).join("\n      ")}\n      timeline (ms):\n        ${lines.join("\n        ")}`);
  }
}

export async function run() {
  // Before anything can start an agent: no real one, ever (see noRealAgents.ts).
  await vscode.workspace.getConfiguration("kernl").update("agentCommands", agentCommands(), vscode.ConfigurationTarget.Global);
  const folders = vscode.workspace.workspaceFolders!;
  const [alpha, beta] = folders.map((f) => f.uri.fsPath);
  const ext = vscode.extensions.getExtension("local.kernl")!;
  const { testing } = await ext.activate();
  const delivered: any[] = [];
  testing.onDidDeliver((m: any) => {
    delivered.push(m);
    const states = m.type === "workspaces" ? ` ${m.items.map((w: any) => `${w.id}: ${w.harness} running=${w.running}`).join("; ")}` : "";
    const detail = m.type === "userMessage" ? ` "${m.text}"` : m.type === "finished" ? ` ${m.reason}${m.message ? `: ${m.message}` : ""}` : m.type === "approval" ? ` ${m.card.title}` : m.type === "notice" ? ` ${m.text}` : states;
    if (m.type !== "text" && m.type !== "thinking") timeline.push(`${at()} panel <- ${m.type}${m.workspace ? `(${m.workspace})` : ""}${detail}`);
  });
  // Every message the tests send as the panel, with the workspace's run state at that moment.
  const receive = testing.receive;
  testing.receive = (m: any) => {
    const state = m.workspace ? JSON.stringify(testing.runState(m.workspace)) : "";
    timeline.push(`${at()} panel -> ${m.type}${m.type === "send" ? ` "${m.text}"` : ""} ${state}`);
    return receive(m);
  };
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
  // `whileAsked` runs while an input box is open, before it's answered (something else happening mid-prompt).
  let scripted: { menu?: RegExp[]; inputs?: string[]; whileAsked?: () => Promise<unknown> } = {};
  const menusShown: any[][] = [];
  testing.usePrompts({
    input: async () => (await scripted.whileAsked?.(), scripted.inputs?.shift()),
    pick: async (items: any[]) => {
      menusShown.push(items);
      const re = scripted.menu?.shift();
      return re ? items.find((i) => i.kind !== -1 && re.test(i.label)) : undefined;
    },
    confirm: async () => true,
  });
  const fakeAgent = { command: process.execPath, args: [join(__dirname, "fakeAcpAgent.cjs")], env: { FAKE_SCENARIO: "write" } };
  const config = vscode.workspace.getConfiguration("kernl");
  await config.update("agentCommands", agentCommands({ "claude-code": fakeAgent }), vscode.ConfigurationTarget.Global);

  await check("multi-root: the panel lists each folder as its own workspace, labeled by folder name", async () => {
    await vscode.commands.executeCommand("kernl.panel.focus");
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

  await check("threads: from alpha, @ finds beta's Claude Code conversation; tagged, it reaches the agent as text; a deleted one sends a note", async () => {
    await testing.setHarness("folder:alpha", "claude-code");
    await testing.receive({ type: "focus", workspace: "folder:alpha" });
    let from = delivered.length;
    await testing.receive({ type: "searchFiles", query: "hello" });
    const matches = await waitFor("search results", (m) => m.type === "fileMatches" && m.query === "hello", from);
    const thread = matches.items.find((a: any) => a.kind === "thread" && a.path === "write hello.txt");
    assert.ok(thread, JSON.stringify(matches.items));
    assert.deepEqual([thread.thread.agent, thread.thread.workspace], ["Claude Code", "beta"]);
    assert.equal(matches.items[0], thread, "a title match comes before files");
    const gone = { ...thread, path: "deleted one", thread: { ...thread.thread, id: "no-such-conversation" } };
    from = delivered.length;
    const sending = testing.receive({ type: "send", workspace: "folder:alpha", text: "continue from beta", attachments: [thread, gone] });
    const card = (await waitFor("an approval card", (m) => m.type === "approval", from)).card;
    await testing.receive({ type: "answer", id: card.id, approved: false });
    await sending;
    const reply = delivered.slice(from).filter((m) => m.type === "text" && m.workspace === "folder:alpha").map((m) => m.delta).join("");
    assert.match(reply, /\[texts: Thread: write hello\.txt => Conversation: write hello\.txt \(Claude Code, in beta; last active .* UTC\)/);
    assert.match(reply, /Thread: deleted one => \[thread no longer available: it was deleted\]/);
    assert.deepEqual(delivered.slice(from).find((m) => m.type === "userMessage")?.attachments, [thread, gone], "the message keeps the references");
  });

  await check("multi-root: a new worktree workspace comes from the shown folder's repository, and stays that folder's when another folder is shown during the prompts", async () => {
    await testing.receive({ type: "focus", workspace: "folder:beta" });
    scripted = { inputs: ["feature"], menu: [/kernl/], whileAsked: () => testing.receive({ type: "focus", workspace: "folder:alpha" }) };
    const from = delivered.length;
    await vscode.commands.executeCommand("kernl.newWorkspace");
    const ws = await waitFor("the worktree workspace", (m) => m.type === "workspaces" && m.items.some((w: any) => w.id === "wt:beta/feature"), from);
    const item = ws.items.find((w: any) => w.id === "wt:beta/feature");
    assert.equal(item.label, "beta/feature");
    assert.equal(ws.focus, "wt:beta/feature");
    const list = await git(beta, ["worktree", "list", "--porcelain"]);
    assert.match(list, /branch refs\/heads\/kernl\/feature/, "the branch is in beta's repo");
    assert.doesNotMatch(await git(alpha, ["branch", "--list", "kernl/*"]), /feature/, "not in alpha's");
  });

  await check("Agent logins: a ready agent can be used in the shown workspace right away", async () => {
    await testing.receive({ type: "focus", workspace: "folder:alpha" });
    scripted = { menu: [/^Claude Code$/, /^Use Claude Code in this workspace$/] };
    await vscode.commands.executeCommand("kernl.agentLogins");
    const actions = menusShown.at(-1)!.map((i: any) => i.label);
    assert.equal(actions[0], "Use Claude Code in this workspace", JSON.stringify(actions));
    assert.equal(harnessOf("folder:alpha"), "claude-code");
  });

  await check("multi-root: a tool row's file opens from any folder of the window (an image in the image viewer); one outside the window's folders doesn't", async () => {
    const notes = join(beta, "notes.md");
    const pixel = join(beta, "pixel.png");
    const outside = join(tmpdir(), `kernl-outside-${Date.now()}.md`);
    writeFileSync(notes, "# notes\nsecond line\n");
    writeFileSync(pixel, Buffer.from("iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAYAAAAfFcSJAAAADUlEQVR42mNkYPhfDwAChwGA60e6kgAAAABJRU5ErkJggg==", "base64"));
    writeFileSync(outside, "not in the window\n");
    try {
      // The panel shows alpha; the agent read a file in beta.
      await testing.receive({ type: "openLocation", workspace: "folder:alpha", path: notes, line: 2 });
      assert.equal(vscode.window.activeTextEditor?.document.uri.fsPath, notes, "a file in another folder of the window opens");
      assert.equal(vscode.window.activeTextEditor?.selection.active.line, 1, "at its line");
      await testing.receive({ type: "openLocation", workspace: "folder:alpha", path: pixel });
      const tab: any = vscode.window.tabGroups.activeTabGroup.activeTab;
      assert.equal(tab?.input?.uri?.fsPath, pixel);
      assert.equal(tab?.input?.viewType, "imagePreview.previewEditor", "an image opens in VS Code's image viewer, not as text");
      await testing.receive({ type: "openLocation", workspace: "folder:alpha", path: outside });
      assert.ok(!vscode.window.tabGroups.all.flatMap((g) => g.tabs).some((t: any) => t.input?.uri?.fsPath === outside), "a file outside the window's folders isn't opened");
    } finally {
      await vscode.commands.executeCommand("workbench.action.closeAllEditors");
      for (const f of [notes, pixel, outside]) rmSync(f, { force: true });
    }
  });

  await check("multi-root: adding a folder adds a workspace; each folder's agent choice is kept across the reload", async () => {
    const gamma = join(realpathSync(mkdtempSync(join(tmpdir(), "kernl-gamma-"))), "gamma");
    mkdirSync(gamma);
    const from = delivered.length;
    vscode.workspace.updateWorkspaceFolders(folders.length, 0, { uri: vscode.Uri.file(gamma) });
    const ws = await waitFor("three folders", (m) => m.type === "workspaces" && m.items.some((w: any) => w.id === "folder:gamma"), from);
    const harness = (id: string) => ws.items.find((w: any) => w.id === id)?.harness;
    assert.deepEqual([harness("folder:alpha"), harness("folder:beta"), harness("folder:gamma")], ["claude-code", "claude-code", "deepagents"]);
    assert.ok(ws.items.some((w: any) => w.id === "wt:beta/feature"), "worktrees are found again");
  });

  await config.update("agentCommands", agentCommands(), vscode.ConfigurationTarget.Global);
  // The whole timeline, pass or fail, for comparing a failing run with a passing one.
  const timelineFile = process.env.KERNL_TIMELINE ?? join(tmpdir(), `kernl-timeline-multi-${started}.txt`);
  writeFileSync(timelineFile, timeline.join("\n") + "\n");
  console.log(`timeline: ${timelineFile}`);
  console.log("\n===== VSCODE RESULTS (multi-root) =====\n" + results.join("\n") + "\n==========================\n");
  if (results.some((r) => r.startsWith("FAIL"))) throw new Error("integration checks failed");
}
