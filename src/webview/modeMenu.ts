// The mode chip's menu: the permission modes the workspace's agent supports, each with an icon,
// a name, and what it means for that agent; the current one is checked. Built with createElement
// + textContent only, like the rest of the panel.
import type { ModeView } from "../ui/protocol";
import { icon, type IconName } from "./icons";

const MODE_ICONS = ["shield", "pencil", "bulb", "sparkle", "warning"] as const satisfies readonly IconName[];

/** The host names each mode's icon; anything unknown gets the shield. */
export function modeIcon(name: string): IconName {
  return MODE_ICONS.find((n) => n === name) ?? "shield";
}

export function createModeMenu(onPick: (mode: string) => void) {
  const menu = document.createElement("div");
  menu.className = "popover mode-menu";
  menu.setAttribute("role", "menu");
  menu.hidden = true;
  let items: HTMLButtonElement[] = [];

  function render(modes: ModeView[], current: string) {
    items = modes.map((m) => {
      const item = document.createElement("button");
      item.className = "mode-option";
      item.dataset.mode = m.id;
      item.setAttribute("role", "menuitemradio");
      item.setAttribute("aria-checked", String(m.id === current));
      const head = document.createElement("span");
      head.className = "mode-option-head";
      const label = document.createElement("span");
      label.className = "mode-option-label";
      label.textContent = m.label;
      head.append(icon(modeIcon(m.icon), 14), label);
      if (m.id === current) head.append(icon("check", 14));
      const description = document.createElement("span");
      description.className = "mode-option-description";
      description.textContent = m.description;
      item.append(head, description);
      item.addEventListener("click", () => {
        close();
        if (m.id !== current) onPick(m.id);
      });
      return item;
    });
    menu.replaceChildren(...items);
  }

  function open(modes: ModeView[], current: string) {
    render(modes, current);
    menu.hidden = false;
    (items.find((i) => i.dataset.mode === current) ?? items[0])?.focus();
  }
  function close() {
    menu.hidden = true;
  }
  menu.addEventListener("keydown", (e) => {
    const at = items.indexOf(document.activeElement as HTMLButtonElement);
    if (e.key === "Escape") {
      e.preventDefault();
      close();
    } else if (e.key === "ArrowDown" || e.key === "ArrowUp") {
      e.preventDefault();
      items[(at + (e.key === "ArrowDown" ? 1 : items.length - 1)) % items.length]?.focus();
    }
  });

  return { menu, open, close, isOpen: () => !menu.hidden };
}
