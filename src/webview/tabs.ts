// The tab strip: the shown workspace's tabs (the workspace itself first), each named by its conversation,
// with a dot while it runs or waits for approval, × to close (not the first), and + for a new tab. A tab
// is another session in the same folder; the host owns them. Built with createElement + textContent only.
import type { PanelToHost, WorkspaceView } from "../ui/protocol";
import { icon } from "./icons";

function el<K extends keyof HTMLElementTagNameMap>(tag: K, className?: string, text?: string): HTMLElementTagNameMap[K] {
  const node = document.createElement(tag);
  if (className) node.className = className;
  if (text !== undefined) node.textContent = text;
  return node;
}

/** `select`: show a tab (the panel's own workspace switch). */
export function createTabStrip(send: (m: PanelToHost) => void, select: (id: string) => void) {
  const strip = el("div", "tabs");
  strip.setAttribute("role", "tablist");
  strip.setAttribute("aria-label", "Tabs");

  function tab(view: WorkspaceView, active: boolean): HTMLElement {
    const t = el("div", `tab${active ? " active" : ""}`);
    const button = el("button", "tab-button");
    button.setAttribute("role", "tab");
    button.setAttribute("aria-selected", String(active));
    const title = view.title ?? "New chat";
    const state = view.waiting > 0 ? "waiting" : view.running ? "running" : "";
    button.title = `${title}${state === "waiting" ? " (waiting for approval)" : state === "running" ? " (working)" : ""}`;
    button.append(el("span", "tab-title", title));
    if (state) button.append(el("span", `dot ${state}`));
    button.addEventListener("click", () => select(view.id));
    t.append(button);
    if (view.tabOf) {
      const close = el("button", "icon-button tab-close");
      close.setAttribute("aria-label", `Close tab ${title}`);
      close.title = "Close tab";
      close.append(icon("close", 12));
      close.addEventListener("click", () => send({ type: "closeTab", workspace: view.id }));
      t.append(close);
    }
    return t;
  }

  /** The tabs of the workspace `shown` belongs to. */
  function render(views: readonly WorkspaceView[], shown: string | undefined) {
    const current = views.find((v) => v.id === shown);
    const base = current?.tabOf ?? current?.id;
    const number = (v: WorkspaceView) => (v.tabOf ? Number(v.id.slice(v.id.lastIndexOf("~") + 1)) : 1);
    const tabs = views.filter((v) => v.id === base || v.tabOf === base).sort((a, b) => number(a) - number(b));
    const add = el("button", "icon-button tab-new");
    add.setAttribute("aria-label", "New tab");
    add.title = "New tab";
    add.append(icon("plus", 14));
    add.addEventListener("click", () => send({ type: "newTab" }));
    strip.hidden = !base;
    strip.replaceChildren(...tabs.map((v) => tab(v, v.id === shown)), add);
  }

  return { strip, render };
}
