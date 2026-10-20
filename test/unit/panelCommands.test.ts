// kernl's own slash commands: which messages they take, which they leave to the agent, and the menu rows.
import { strict as assert } from "node:assert";
import { test } from "node:test";
import { commandFor, menuRows, PANEL_COMMANDS, type PanelCommand } from "../../src/webview/panelCommands";

const none = new Set<string>();
const name = (r: ReturnType<typeof commandFor>) => (r && "command" in r ? r.command.name : r);

test("a kernl command or alias is taken, alone on the message", () => {
  assert.equal(name(commandFor("/new", none)), "new");
  assert.equal(name(commandFor("  /clear \n", none)), "new");
  assert.equal(name(commandFor("/resume", none)), "conversations");
  assert.equal(name(commandFor("/kernl:model", none)), "model");
});

test("text that isn't a kernl command is sent as usual", () => {
  for (const text of ["/usr/bin is missing", "/deploy now", "new", "please /new", "/", "/kernl"]) assert.equal(commandFor(text, none), undefined, text);
});

test("the agent wins a clash, by name or alias; /kernl: always reaches kernl", () => {
  const agent = new Set(["model", "resume", "compact"]);
  assert.equal(commandFor("/model", agent), undefined);
  assert.equal(commandFor("/resume", agent), undefined);
  assert.equal(name(commandFor("/conversations", agent)), "conversations");
  assert.equal(name(commandFor("/kernl:model", agent)), "model");
});

test("a command with text after it, or an unknown /kernl: name, is refused rather than sent", () => {
  assert.deepEqual(commandFor("/new fix the bug", none), { refusal: "/new takes nothing after it." });
  assert.deepEqual(commandFor("/kernl:tab x", none), { refusal: "/kernl:tab takes nothing after it." });
  assert.deepEqual(commandFor("/kernl:compact", none), { refusal: "kernl has no command /kernl:compact." });
});

test("menu rows match a name or alias prefix (exact first, not an alias the agent offers), leave out unavailable commands, and label a clash kernl:<name>", () => {
  const all = (_c: PanelCommand) => true;
  const labels = (q: string, agent = none, available = all) => menuRows(q, agent, available).map((r) => r.label);
  assert.deepEqual(labels("").length, PANEL_COMMANDS.length);
  assert.deepEqual(labels("cl"), ["/new", "/close"]);
  assert.deepEqual(labels("res"), ["/conversations"]);
  assert.deepEqual(labels("mo", new Set(["model"])), ["/kernl:model", "/mode"]);
  assert.deepEqual(labels("kernl:t"), ["/kernl:tab"]);
  assert.deepEqual(labels("mode"), ["/mode", "/model"], "an exact match comes first");
  assert.deepEqual(labels("res", new Set(["resume"])), [], "the agent's /resume isn't kernl's alias any more");
  assert.deepEqual(labels("kernl:res", new Set(["resume"])), ["/kernl:conversations"]);
  assert.deepEqual(labels("c", none, (c) => c.name !== "close"), ["/new", "/conversations", "/connections"]);
  assert.equal(menuRows("tab", none, all)[0].detail, "New tab · kernl");
  assert.equal(menuRows("mo", new Set(["model"]), all)[0].clash, true);
});
