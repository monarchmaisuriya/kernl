// The tab strip: the shown workspace's tabs (the workspace itself first), each a pill named by its
// conversation. A pill leads with its state, where it stays in view: working (a spinner), waiting for
// the user (a warning dot), or finished while another tab was shown (an accent dot, until it's shown).
// Pills shrink (titles get an ellipsis; the full one is in the tooltip) before the strip scrolls. A
// closable pill keeps a slot at its end for ×, shown on hover or keyboard focus (the first tab can't close). Keyboard: the
// shown tab is the strip's one Tab stop; arrows, Home, and End show another; Delete closes. Mouse:
// middle-click closes; double-click on the strip's empty space opens a tab; the wheel scrolls it sideways.
// A tab is another session in the same folder; the host owns them. Built with createElement + textContent only.
import type { PanelToHost, WorkspaceView } from "../ui/protocol";
import { icon } from "./icons";

function el<K extends keyof HTMLElementTagNameMap>(tag: K, className?: string, text?: string): HTMLElementTagNameMap[K] {
  const node = document.createElement(tag);
  if (className) node.className = className;
  if (text !== undefined) node.textContent = text;
  return node;
}

type TabState = "working" | "waiting" | "finished" | "";
const STATE_WORDS: Record<TabState, string> = { working: "working", waiting: "waiting for you", finished: "finished", "": "" };

/** `select`: show a tab (the panel's own workspace switch). */
export function createTabStrip(send: (m: PanelToHost) => void, select: (id: string) => void) {
  // The bar holds the tabs (which scroll when they overflow) and + after them, always in view.
  const bar = el("div", "tab-bar");
  const strip = el("div", "tabs");
  strip.setAttribute("role", "tablist");
  strip.setAttribute("aria-label", "Tabs");
  const add = el("button", "icon-button tab-new");
  add.setAttribute("aria-label", "New tab");
  add.title = "New tab (⌘T)";
  add.append(icon("plus", 14));
  add.addEventListener("click", () => send({ type: "newTab" }));
  bar.append(strip, add);
  /** Tabs that stopped working while another tab was shown: they keep a dot until shown. */
  const finished = new Set<string>();
  const wasRunning = new Map<string, boolean>();
  let shownTabs: WorkspaceView[] = [];

  const close = (view: WorkspaceView) => send({ type: "closeTab", workspace: view.id });
  const tabButton = (id: string) => [...strip.querySelectorAll<HTMLElement>(".tab")].find((t) => t.dataset.id === id)?.querySelector<HTMLElement>(".tab-button");
  const stateOf = (view: WorkspaceView): TabState => (view.waiting > 0 ? "waiting" : view.running ? "working" : finished.has(view.id) ? "finished" : "");

  function tab(view: WorkspaceView, active: boolean): HTMLElement {
    const title = view.title ?? "New chat";
    const state = stateOf(view);
    const t = el("div", `tab${active ? " active" : ""}${state ? ` ${state}` : ""}`);
    t.dataset.id = view.id;
    const button = el("button", "tab-button");
    button.setAttribute("role", "tab");
    button.setAttribute("aria-selected", String(active));
    button.tabIndex = active ? 0 : -1;
    button.setAttribute("aria-label", state ? `${title}, ${STATE_WORDS[state]}` : title);
    button.title = state ? `${title} (${STATE_WORDS[state]})` : title;
    if (state) button.append(el("span", `tab-state ${state}`));
    button.append(el("span", "tab-title", title));
    button.addEventListener("click", () => select(view.id));
    t.append(button);
    if (view.tabOf) {
      const slot = el("span", "tab-slot");
      const x = el("button", "icon-button tab-close");
      x.tabIndex = -1;
      x.setAttribute("aria-label", `Close tab ${title}`);
      x.title = "Close tab (⌘W)";
      x.append(icon("close", 12));
      x.addEventListener("click", () => close(view));
      slot.append(x);
      t.append(slot);
      // Middle-click closes, as in browsers and editors.
      t.addEventListener("auxclick", (e) => e.button === 1 && (e.preventDefault(), close(view)));
    }
    return t;
  }

  /** The fades at a clipped edge, when the tabs are wider than the strip. */
  function fades() {
    strip.classList.toggle("clipped-start", strip.scrollLeft > 0);
    strip.classList.toggle("clipped-end", strip.scrollLeft + strip.clientWidth < strip.scrollWidth - 1);
  }

  /** The tabs of the workspace `shown` belongs to. */
  function render(views: readonly WorkspaceView[], shown: string | undefined) {
    const current = views.find((v) => v.id === shown);
    const base = current?.tabOf ?? current?.id;
    const number = (v: WorkspaceView) => (v.tabOf ? Number(v.id.slice(v.id.lastIndexOf("~") + 1)) : 1);
    shownTabs = views.filter((v) => v.id === base || v.tabOf === base).sort((a, b) => number(a) - number(b));
    for (const v of shownTabs) {
      if (wasRunning.get(v.id) && !v.running && v.id !== shown) finished.add(v.id);
      if (v.id === shown) finished.delete(v.id);
      wasRunning.set(v.id, v.running);
    }
    const focusedId = strip.contains(document.activeElement) ? (document.activeElement as HTMLElement).closest<HTMLElement>(".tab")?.dataset.id : undefined;
    bar.hidden = !base;
    strip.replaceChildren(...shownTabs.map((v) => tab(v, v.id === shown)));
    // A redraw keeps keyboard focus on the tab that had it.
    if (focusedId) tabButton(focusedId)?.focus();
    strip.querySelector(".tab.active")?.scrollIntoView({ block: "nearest", inline: "nearest" });
    fades();
  }

  strip.addEventListener("keydown", (e) => {
    const at = shownTabs.findIndex((v) => v.id === (e.target as HTMLElement).closest<HTMLElement>(".tab")?.dataset.id);
    if (at < 0) return;
    const go = (i: number) => {
      e.preventDefault();
      const target = shownTabs[(i + shownTabs.length) % shownTabs.length];
      select(target.id);
      tabButton(target.id)?.focus();
    };
    if (e.key === "ArrowRight") go(at + 1);
    else if (e.key === "ArrowLeft") go(at - 1);
    else if (e.key === "Home") go(0);
    else if (e.key === "End") go(shownTabs.length - 1);
    else if (e.key === "Delete" && shownTabs[at].tabOf) (e.preventDefault(), close(shownTabs[at]));
  });
  // Double-click on the strip's empty space opens a tab, as in browsers.
  bar.addEventListener("dblclick", (e) => (e.target === strip || e.target === bar) && send({ type: "newTab" }));
  // A vertical wheel scrolls the tabs sideways.
  strip.addEventListener(
    "wheel",
    (e) => {
      if (Math.abs(e.deltaY) <= Math.abs(e.deltaX)) return;
      strip.scrollLeft += e.deltaY;
      e.preventDefault();
    },
    { passive: false },
  );
  strip.addEventListener("scroll", fades);

  return { strip: bar, render };
}
