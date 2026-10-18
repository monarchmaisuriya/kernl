// In-panel menus: every list the host asks the user to choose from opens here, next to the control
// that asked (its data-anchor attribute), instead of at the top of the window. Built with
// createElement + textContent only, like the rest of the panel.
import type { MenuAnchor, MenuItemView } from "../ui/protocol";
import { icon, type IconName } from "./icons";

/** VS Code codicon names used in the host's menu labels, drawn with the panel's own icons. */
const CODICONS: Record<string, IconName> = {
  add: "plus",
  "git-branch": "branch",
  "git-merge": "branch",
  "git-pull-request": "branch",
  file: "file",
  files: "file",
  diff: "file",
  folder: "folder",
  trash: "trash",
  issues: "issue",
  "comment-discussion": "chat",
};

export interface MenuRequest {
  id: string;
  title: string;
  anchor: MenuAnchor;
  items: MenuItemView[];
  search: boolean;
}

/** `answer(id, index)`: the chosen row's index into the host's list, or undefined when dismissed. */
export function createMenu(answer: (id: string, index: number | undefined) => void) {
  const menu = document.createElement("div");
  menu.className = "popover anchored-menu";
  menu.setAttribute("role", "menu");
  menu.hidden = true;
  let current: MenuRequest | undefined;
  let rows: { button: HTMLButtonElement; index: number; text: string }[] = [];
  let search: HTMLInputElement | undefined;

  function anchorElement(anchor: MenuAnchor): HTMLElement | null {
    return document.querySelector<HTMLElement>(`[data-anchor="${CSS.escape(anchor)}"]`);
  }

  /** Below the control in the top half of the panel, above it in the bottom half; within the panel's width. */
  function place(anchor: MenuAnchor) {
    const width = Math.min(380, window.innerWidth - 16);
    menu.style.width = `${width}px`;
    const target = anchorElement(anchor);
    const rect = target?.getBoundingClientRect() ?? { left: window.innerWidth - width - 8, right: window.innerWidth - 8, top: 0, bottom: 4 };
    const left = Math.max(8, Math.min(rect.left, window.innerWidth - width - 8));
    menu.style.left = `${left}px`;
    if ((rect.top + rect.bottom) / 2 > window.innerHeight / 2) {
      menu.style.top = "";
      menu.style.bottom = `${window.innerHeight - rect.top + 6}px`;
      menu.style.maxHeight = `${Math.max(120, rect.top - 14)}px`;
    } else {
      menu.style.bottom = "";
      menu.style.top = `${rect.bottom + 6}px`;
      menu.style.maxHeight = `${Math.max(120, window.innerHeight - rect.bottom - 14)}px`;
    }
  }

  function rowFor(item: MenuItemView, index: number) {
    const button = document.createElement("button");
    button.className = "menu-item";
    button.setAttribute("role", "menuitem");
    const line = document.createElement("span");
    line.className = "menu-item-line";
    const mapped = item.icon ? CODICONS[item.icon] : undefined;
    const lead = document.createElement("span");
    lead.className = "menu-item-icon";
    if (item.checked) lead.append(icon("check", 14));
    else if (mapped) lead.append(icon(mapped, 14));
    const label = document.createElement("span");
    label.className = "menu-item-label";
    label.textContent = item.label;
    line.append(lead, label);
    if (item.description) {
      const description = document.createElement("span");
      description.className = "menu-item-description";
      description.textContent = item.description;
      line.append(description);
    }
    button.append(line);
    if (item.detail) {
      const detail = document.createElement("span");
      detail.className = "menu-item-detail";
      detail.textContent = item.detail;
      button.append(detail);
    }
    if (item.checked) button.setAttribute("aria-current", "true");
    button.addEventListener("click", () => finish(index));
    return { button, index, text: `${item.label} ${item.description ?? ""} ${item.detail ?? ""}`.toLowerCase() };
  }

  function render(filter = "") {
    if (!current) return;
    const words = filter.toLowerCase().split(/\s+/).filter(Boolean);
    const list = document.createElement("div");
    list.className = "menu-list";
    rows = [];
    let heading: HTMLElement | undefined;
    current.items.forEach((item, index) => {
      if (item.separator) {
        heading = document.createElement("div");
        heading.className = "menu-heading";
        heading.textContent = item.label;
        return;
      }
      const row = rowFor(item, index);
      if (words.some((w) => !row.text.includes(w))) return;
      if (heading) list.append(heading), (heading = undefined);
      list.append(row.button);
      rows.push(row);
    });
    if (!rows.length) {
      const none = document.createElement("div");
      none.className = "menu-empty";
      none.textContent = "No matches";
      list.append(none);
    }
    menu.querySelector(".menu-list")?.remove();
    menu.append(list);
  }

  function open(request: MenuRequest) {
    if (current) answer(current.id, undefined);
    current = request;
    menu.replaceChildren();
    if (request.title) {
      const title = document.createElement("div");
      title.className = "menu-title";
      title.textContent = request.title;
      menu.append(title);
    }
    search = undefined;
    if (request.search) {
      search = document.createElement("input");
      search.className = "menu-search";
      search.placeholder = "Search";
      search.setAttribute("aria-label", "Search this list");
      search.addEventListener("input", () => render(search!.value));
      menu.append(search);
    }
    render();
    menu.hidden = false;
    place(request.anchor);
    (search ?? rows.find((r) => r.button.getAttribute("aria-current")) ?.button ?? rows[0]?.button)?.focus();
  }

  function finish(index: number | undefined) {
    if (!current) return;
    const { id } = current;
    current = undefined;
    menu.hidden = true;
    answer(id, index);
  }

  /** The host withdrew this menu: hide it without answering. */
  function closed(id: string) {
    if (current?.id !== id) return;
    current = undefined;
    menu.hidden = true;
  }

  menu.addEventListener("keydown", (e) => {
    const at = rows.findIndex((r) => r.button === document.activeElement);
    if (e.key === "Escape") {
      e.preventDefault();
      finish(undefined);
    } else if (e.key === "ArrowDown" || e.key === "ArrowUp") {
      e.preventDefault();
      if (!rows.length) return;
      const next = at < 0 ? (e.key === "ArrowDown" ? 0 : rows.length - 1) : (at + (e.key === "ArrowDown" ? 1 : rows.length - 1)) % rows.length;
      rows[next].button.focus();
    } else if (e.key === "Enter" && document.activeElement === search && rows.length) {
      e.preventDefault();
      finish(rows[0].index);
    }
  });
  // A press anywhere else dismisses it (the control that opened it asks again on its own click).
  document.addEventListener("mousedown", (e) => {
    if (current && !menu.contains(e.target as Node)) finish(undefined);
  });
  window.addEventListener("resize", () => current && place(current.anchor));

  return { menu, open, closed, isOpen: () => !!current };
}
