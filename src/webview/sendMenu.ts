// The send button's menu: Send, Queue for later, Send in a forked session, each with its shortcut.
// Built with createElement + textContent only, like the rest of the panel.
import type { SendMode } from "../ui/protocol";

const isMac = () => /Mac|iPhone|iPad/.test(navigator.platform || navigator.userAgent);

/** The shortcut labels for this platform: Cmd and Option on macOS, Ctrl and Alt elsewhere. */
export function shortcutLabels(mac = isMac()): Record<SendMode, string> {
  return mac ? { now: "⏎", queue: "⌘⏎", fork: "⌥⌘⏎" } : { now: "Enter", queue: "Ctrl+Enter", fork: "Alt+Ctrl+Enter" };
}

/** Which send action a key press in the composer asks for; undefined for anything else (Shift+Enter is a new line). */
export function sendModeOf(e: KeyboardEvent): SendMode | undefined {
  if (e.key !== "Enter" || e.shiftKey || e.isComposing) return undefined;
  const primary = e.metaKey || e.ctrlKey;
  if (primary && e.altKey) return "fork";
  if (primary) return "queue";
  return e.altKey ? undefined : "now";
}

const LABELS: Record<SendMode, string> = { now: "Send", queue: "Queue for later", fork: "Send in a forked session" };

/** How long the pointer rests on Send before its menu opens, and how long it may be away before it closes. */
export const HOVER_OPEN_MS = 500;
const HOVER_CLOSE_MS = 300;

/**
 * The menu of the Send button (`trigger`): it opens when the pointer rests on Send (focus stays in the
 * message box), or with Arrow Up/Down on the focused button (focus moves into the menu); clicking Send
 * still sends. It only opens with something to send.
 */
export function createSendMenu(trigger: HTMLButtonElement, onPick: (mode: SendMode) => void) {
  trigger.setAttribute("aria-haspopup", "menu");
  trigger.setAttribute("aria-expanded", "false");

  const menu = document.createElement("div");
  menu.className = "popover send-menu";
  menu.setAttribute("role", "menu");
  menu.hidden = true;
  const keys = shortcutLabels();
  const items = (Object.keys(LABELS) as SendMode[]).map((mode) => {
    const item = document.createElement("button");
    item.className = "send-option";
    item.dataset.mode = mode;
    item.setAttribute("role", "menuitem");
    const label = document.createElement("span");
    label.className = "send-option-label";
    label.textContent = LABELS[mode];
    const kbd = document.createElement("kbd");
    kbd.textContent = keys[mode];
    item.append(label, kbd);
    item.addEventListener("click", () => {
      close();
      onPick(mode);
    });
    menu.append(item);
    return item;
  });

  let enabled = false;
  let openTimer: ReturnType<typeof setTimeout> | undefined;
  let closeTimer: ReturnType<typeof setTimeout> | undefined;

  function open(focus: boolean) {
    clearTimeout(openTimer);
    clearTimeout(closeTimer);
    if (!enabled) return;
    menu.hidden = false;
    trigger.setAttribute("aria-expanded", "true");
    if (focus) items.find((i) => !i.disabled)?.focus();
  }
  function close() {
    clearTimeout(openTimer);
    clearTimeout(closeTimer);
    menu.hidden = true;
    trigger.setAttribute("aria-expanded", "false");
  }
  /** The pointer left Send or the menu: close a moment later, unless it came back or the keyboard is in the menu. */
  function leave() {
    clearTimeout(openTimer);
    clearTimeout(closeTimer);
    closeTimer = setTimeout(() => !menu.contains(document.activeElement) && close(), HOVER_CLOSE_MS);
  }

  trigger.addEventListener("mouseenter", () => {
    clearTimeout(closeTimer);
    if (menu.hidden && enabled) openTimer = setTimeout(() => open(false), HOVER_OPEN_MS);
  });
  trigger.addEventListener("mouseleave", leave);
  menu.addEventListener("mouseenter", () => clearTimeout(closeTimer));
  menu.addEventListener("mouseleave", leave);
  trigger.addEventListener("click", () => close());
  trigger.addEventListener("keydown", (e) => {
    if ((e.key === "ArrowUp" || e.key === "ArrowDown") && enabled) {
      e.preventDefault();
      open(true);
    }
  });
  menu.addEventListener("keydown", (e) => {
    const usable = items.filter((i) => !i.disabled);
    const at = usable.indexOf(document.activeElement as HTMLButtonElement);
    if (e.key === "Escape") {
      e.preventDefault();
      close();
      trigger.focus();
    } else if (e.key === "ArrowDown" || e.key === "ArrowUp") {
      e.preventDefault();
      usable[(at + (e.key === "ArrowDown" ? 1 : usable.length - 1)) % usable.length]?.focus();
    }
  });
  document.addEventListener("click", (e) => {
    if (!menu.hidden && !menu.contains(e.target as Node) && !trigger.contains(e.target as Node)) close();
  });

  /** Nothing to send keeps the menu shut; while the agent runs, Send queues and forking waits. */
  function update(state: { hasText: boolean; running: boolean; available: boolean }) {
    enabled = state.available && state.hasText;
    for (const item of items) {
      const mode = item.dataset.mode as SendMode;
      item.disabled = !state.hasText || (mode === "fork" && state.running);
      item.title = mode === "fork" && state.running ? "Stop the agent first" : mode === "now" && state.running ? "Sends when the agent finishes" : "";
    }
    if (!enabled) close();
  }

  return { menu, open, close, update };
}
