// kernl one click from the top of the window: the replace option hides VS Code's chat button and puts
// back exactly what was there; the status bar text; the kernl menu matches the editor toolbar's
// submenu; and "@kernl" in VS Code's chat forwards to the panel and says where it went.
import { strict as assert } from "node:assert";
import { readFileSync } from "node:fs";
import { resolve } from "node:path";
import { test } from "node:test";
import { type ChatForwarding, handleKernlRequest, referencedFiles } from "../../src/chatRequest";
import { applyChatButtonReplacement, QUICK_ACTIONS, type SavedValue, statusBarText, type UserSetting } from "../../src/quickAccess";
import { PANEL_COMMANDS } from "../../src/ui/panelCommands";

function fakes(initial: unknown, exists = true) {
  let value = initial;
  let saved: { value: unknown } | undefined;
  const writes: unknown[] = [];
  const setting: UserSetting = { exists: () => exists, get: () => value, set: async (v) => void (writes.push(v), (value = v)) };
  const store: SavedValue = { get: () => saved, set: async (v) => void (saved = v) };
  return { setting, store, value: () => value, saved: () => saved, writes };
}

test("on hides VS Code's button and saves the user's value; off puts it back", async () => {
  const f = fakes("badge");
  assert.equal(await applyChatButtonReplacement(true, f.setting, f.store), "hidden");
  assert.equal(f.value(), "hidden");
  assert.deepEqual(f.saved(), { value: "badge" });
  assert.equal(await applyChatButtonReplacement(true, f.setting, f.store), "unchanged", "turning it on twice changes nothing");
  assert.equal(await applyChatButtonReplacement(false, f.setting, f.store), "restored");
  assert.equal(f.value(), "badge");
  assert.equal(f.saved(), undefined);
});

test("a setting that was unset goes back to unset (removed), not to the default written out", async () => {
  const f = fakes(undefined);
  await applyChatButtonReplacement(true, f.setting, f.store);
  assert.deepEqual(f.saved(), { value: undefined });
  await applyChatButtonReplacement(false, f.setting, f.store);
  assert.deepEqual(f.writes, ["hidden", undefined]);
});

test("if the user changed the setting while the option was on, turning it off leaves their choice", async () => {
  const f = fakes("compact");
  await applyChatButtonReplacement(true, f.setting, f.store);
  await f.setting.set("badge");
  assert.equal(await applyChatButtonReplacement(false, f.setting, f.store), "kept");
  assert.equal(f.value(), "badge");
  assert.equal(f.saved(), undefined);
});

test("a VS Code without the setting is told, and nothing is written; off with nothing saved changes nothing", async () => {
  const f = fakes(undefined, false);
  assert.equal(await applyChatButtonReplacement(true, f.setting, f.store), "unsupported");
  assert.deepEqual(f.writes, []);
  assert.equal(await applyChatButtonReplacement(false, fakes("compact").setting, fakes("compact").store), "unchanged");
});

test("the status bar says kernl, or how many connections in use need you", () => {
  assert.deepEqual(statusBarText(0), { text: "kernl", tooltip: "kernl: open the kernl menu" });
  assert.equal(statusBarText(1).text, "$(warning) kernl: 1 needs you");
  assert.equal(statusBarText(3).text, "$(warning) kernl: 3 need you");
});

test("the kernl menu, the editor toolbar's kernl submenu, and the commands agree", () => {
  const pkg = JSON.parse(readFileSync(resolve(__dirname, "../../package.json"), "utf8"));
  const commands = new Set(pkg.contributes.commands.map((c: any) => c.command));
  for (const a of QUICK_ACTIONS) assert.ok(commands.has(a.command), `${a.command} is a contributed command`);
  const submenu = pkg.contributes.menus["kernl.menu"].map((m: any) => m.command);
  assert.deepEqual(submenu, QUICK_ACTIONS.map((a) => a.command), "same actions, same order");
  assert.deepEqual(pkg.contributes.menus["editor/title"], [{ submenu: "kernl.menu", group: "navigation@100" }]);
  assert.deepEqual(pkg.contributes.submenus.find((m: any) => m.id === "kernl.menu").icon, { light: "media/mark-light.png", dark: "media/mark.png" });
  assert.equal(pkg.contributes.configuration.find((c: any) => c.properties?.["kernl.replaceChatButton"]).properties["kernl.replaceChatButton"].scope, "application", "user settings only: a repository can't turn it on");
});

const uri = (path: string, scheme = "file") => ({ scheme, fsPath: path, toString: () => `${scheme}://${path}` });

test("@kernl sends the request and its files to the panel, and says where it went", async () => {
  const forwarded: unknown[] = [];
  const out: string[] = [];
  const stream = { markdown: (t: string) => out.push(t), button: (b: { command: string; title: string }) => out.push(`[${b.title}](${b.command})`) };
  const ok: ChatForwarding = { forward: async (text, files) => (forwarded.push({ text, files }), { workspace: "Develop", agent: "Claude Code", queued: false }) };
  const refs = [{ value: uri("/w/a.ts") }, { value: { uri: uri("/w/b.ts"), range: {} } }, { value: "some text" }, { value: uri("/w/a.ts") }, { value: uri("/x", "untitled") }];
  await handleKernlRequest({ prompt: " fix the failing test ", references: refs }, stream, ok);
  assert.deepEqual(forwarded, [{ text: "fix the failing test", files: ["file:///w/a.ts", "file:///w/b.ts"] }]);
  assert.deepEqual(out, ["Sent to kernl: **Claude Code** in **Develop**. The work and any approvals are in the kernl panel.", "[Open kernl](kernl.open)"]);
  assert.deepEqual(referencedFiles([{ value: uri("/x", "untitled") }]), [], "only files on disk");
});

test("@kernl while the agent works says it's queued; an empty request or no workspace says what to do", async () => {
  const out: string[] = [];
  const stream = { markdown: (t: string) => out.push(t), button: () => {} };
  await handleKernlRequest({ prompt: "x", references: [] }, stream, { forward: async () => ({ workspace: "Main", agent: "kernl", queued: true }) });
  assert.match(out.at(-1)!, /^Queued in kernl/);
  await handleKernlRequest({ prompt: "  ", references: [] }, stream, { forward: async () => assert.fail("nothing to send") });
  assert.match(out.at(-1)!, /Tell kernl what to do/);
  await handleKernlRequest({ prompt: "x", references: [] }, stream, { forward: async () => ({ error: "Open a folder first." }) });
  assert.equal(out.at(-1), "kernl couldn't take this: Open a folder first.");
});

test("@kernl /new: a command picked in VS Code's chat reaches kernl as /new, and the reply says it ran", async () => {
  const out: string[] = [];
  const forwarded: string[] = [];
  const stream = { markdown: (t: string) => out.push(t), button: () => {} };
  await handleKernlRequest({ command: "new", prompt: "", references: [] }, stream, { forward: async (text) => (forwarded.push(text), { workspace: "Main", ran: "new" }) });
  assert.deepEqual(forwarded, ["/new"]);
  assert.equal(out[0], "Ran kernl's **/new** in **Main**.");
  await handleKernlRequest({ command: "new", prompt: "fix it", references: [] }, stream, { forward: async (text) => (forwarded.push(text), { error: "/new takes nothing after it." }) });
  assert.equal(forwarded.at(-1), "/new fix it", "the text after it goes along, so kernl can refuse it");
});

test("@kernl lists exactly kernl's commands in VS Code's chat", () => {
  const pkg = JSON.parse(readFileSync(resolve(__dirname, "../../package.json"), "utf8"));
  assert.deepEqual(pkg.contributes.chatParticipants[0].commands.map((c: any) => c.name), PANEL_COMMANDS.map((c) => c.name));
});

test("tab shortcuts act only while kernl's panel has focus; Cmd+W on a workspace's last tab does nothing instead of closing an editor", () => {
  const pkg = JSON.parse(readFileSync(resolve(__dirname, "../../package.json"), "utf8"));
  const bound = (command: string) => pkg.contributes.keybindings.filter((k: any) => k.command === command);
  for (const [command, mac] of [["kernl.newTab", "cmd+t"], ["kernl.closeTab", "cmd+w"], ["kernl.nextTab", undefined], ["kernl.previousTab", undefined]] as const) {
    const [k] = bound(command);
    assert.ok(k, `${command} has a key`);
    assert.match(k.when, /^focusedView == kernl\.panel\b/, `${command} only in kernl's panel`);
    if (mac) assert.equal(k.mac, mac);
  }
  assert.match(bound("kernl.closeTab")[0].when, /&& kernl\.tabClosable$/);
  assert.deepEqual(bound("noop").map((k: any) => [k.mac, k.when]), [["cmd+w", "focusedView == kernl.panel && !kernl.tabClosable"]]);
});
