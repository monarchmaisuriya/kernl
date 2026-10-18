import type * as vscode from "vscode";
import type { Prompts } from "../workspaces/commands";
import type { HostToPanel, MenuAnchor, MenuItemView } from "./protocol";

/** What PanelPrompts needs from the panel. */
export interface MenuPanel {
  readonly visible: boolean;
  post(message: HostToPanel): void;
}

const SEPARATOR = -1; // vscode.QuickPickItemKind.Separator
/** Long lists get a search box, like VS Code's own. */
const SEARCH_FROM = 8;

/** "$(check) Main" -> { label: "Main", checked: true }; "$(add) New" -> { label: "New", icon: "add" }. */
export function menuItemView(item: vscode.QuickPickItem): MenuItemView {
  let label = item.label;
  let icon: string | undefined;
  let checked = false;
  for (let m = /^\$\(([a-z-]+)\)\s*/.exec(label); m; m = /^\$\(([a-z-]+)\)\s*/.exec(label)) {
    if (m[1] === "check") checked = true;
    else icon ??= m[1];
    label = label.slice(m[0].length);
  }
  const view: MenuItemView = { label };
  if (item.kind === SEPARATOR) view.separator = true;
  if (item.description) view.description = item.description;
  if (item.detail) view.detail = item.detail;
  if (icon) view.icon = icon;
  if (checked) view.checked = true;
  return view;
}

/**
 * Every list the extension asks the user to choose from (agent, model, workspace, attach,
 * conversations, setup flows) opens as a menu in the panel, next to the control that started
 * it (`anchor`, set by the controller for the flow it is handling). With the panel off screen,
 * or for text input and confirmations, VS Code's own prompts are used.
 */
export class PanelPrompts implements Prompts {
  anchor: MenuAnchor = "title";
  private open: { id: string; resolve: (index: number | undefined) => void } | undefined;
  private next = 1;

  constructor(private panel: MenuPanel, private fallback: Prompts) {}

  input(options: vscode.InputBoxOptions) {
    return this.fallback.input(options);
  }

  confirm(message: string, detail: string, action: string) {
    return this.fallback.confirm(message, detail, action);
  }

  async pick<T extends vscode.QuickPickItem>(items: T[], options: vscode.QuickPickOptions): Promise<T | undefined> {
    if (!this.panel.visible) return this.fallback.pick(items, options);
    this.cancel(); // one menu at a time; a newer one replaces it
    const id = `menu-${this.next++}`;
    const index = await new Promise<number | undefined>((resolve) => {
      this.open = { id, resolve };
      this.panel.post({ type: "menu", id, title: options.title ?? "", anchor: this.anchor, items: items.map(menuItemView), search: items.length >= SEARCH_FROM });
    });
    const item = index === undefined ? undefined : items[index];
    return item && item.kind !== SEPARATOR ? item : undefined;
  }

  /** The panel's answer (menuPick); an answer to a menu that's no longer open is ignored. */
  answer(id: string, index: number | undefined) {
    if (this.open?.id !== id) return;
    const { resolve } = this.open;
    this.open = undefined;
    resolve(index);
  }

  /** Dismisses the open menu (replaced, or the panel was hidden): its flow continues as cancelled. */
  cancel() {
    if (!this.open) return;
    const { id, resolve } = this.open;
    this.open = undefined;
    this.panel.post({ type: "menuClosed", id });
    resolve(undefined);
  }
}
