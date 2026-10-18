// Choices open as menus in the panel next to the control that asked; with the panel off screen,
// VS Code's own prompts are used. A newer menu replaces an open one; hiding the panel cancels it.
import { strict as assert } from "node:assert";
import { test } from "node:test";
import { menuItemView, PanelPrompts } from "../../src/ui/panelPrompts";
import type { HostToPanel } from "../../src/ui/protocol";

function setup(visible = true) {
  const posted: HostToPanel[] = [];
  const fallbackPicks: unknown[] = [];
  const panel = { visible, post: (m: HostToPanel) => posted.push(m) };
  const prompts = new PanelPrompts(panel, {
    input: async () => "typed",
    pick: async (items: any[]) => (fallbackPicks.push(items), items[0]),
    confirm: async () => true,
  });
  return { panel, posted, prompts, fallbackPicks };
}

test("codicon prefixes become an icon or a check; separators are marked", () => {
  assert.deepEqual(menuItemView({ label: "$(check) Main", description: "x" }), { label: "Main", description: "x", checked: true });
  assert.deepEqual(menuItemView({ label: "$(add) New conversation" }), { label: "New conversation", icon: "add" });
  assert.deepEqual(menuItemView({ label: "Agents", kind: -1 } as any), { label: "Agents", separator: true });
});

test("a pick opens in the panel at the current anchor and resolves with the chosen item", async () => {
  const { posted, prompts } = setup();
  prompts.anchor = "agent";
  const items = [{ label: "YourStack", kind: -1 }, { label: "Claude Code" }, { label: "Codex" }] as any[];
  const picking = prompts.pick(items, { title: "Agent" });
  const menu = posted.at(-1) as Extract<HostToPanel, { type: "menu" }>;
  assert.equal(menu.type, "menu");
  assert.equal(menu.anchor, "agent");
  assert.equal(menu.title, "Agent");
  assert.equal(menu.items.length, 3);
  prompts.answer("someone-else", 2); // a stale answer is ignored
  prompts.answer(menu.id, 2);
  assert.equal(await picking, items[2]);
});

test("dismissing, a newer menu, or the panel hiding cancel the open menu; off screen it falls back", async () => {
  const s = setup();
  const first = s.prompts.pick([{ label: "a" }], {});
  const second = s.prompts.pick([{ label: "b" }], {});
  assert.equal(await first, undefined, "replaced");
  assert.ok(s.posted.some((m) => m.type === "menuClosed"));
  s.prompts.cancel();
  assert.equal(await second, undefined, "panel hidden");
  const third = s.prompts.pick([{ label: "c" }], {});
  s.prompts.answer((s.posted.at(-1) as any).id, undefined);
  assert.equal(await third, undefined, "dismissed");
  const off = setup(false);
  assert.equal((await off.prompts.pick([{ label: "x" }], {}))?.label, "x");
  assert.equal(off.fallbackPicks.length, 1);
  assert.equal(off.posted.length, 0);
});
