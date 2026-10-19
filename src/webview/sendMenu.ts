// The send button's menu: Send, Queue for later, Send in a forked session, each with its shortcut.
// Built with createElement + textContent only, like the rest of the panel.
import type { SendMode } from "../ui/protocol";
import { icon } from "./icons";

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

export function createSendMenu(onPick: (mode: SendMode) => void) {
  const button = document.createElement("button");
  button.className = "send-more";
  button.setAttribute("aria-label", "More send options");
  button.setAttribute("aria-haspopup", "menu");
  button.title = "More send options";
  button.append(icon("chevron", 14));

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

  function open() {
    menu.hidden = false;
    button.setAttribute("aria-expanded", "true");
    items.find((i) => !i.disabled)?.focus();
  }
  function close() {
    menu.hidden = true;
    button.setAttribute("aria-expanded", "false");
  }
  button.addEventListener("click", (e) => {
    e.stopPropagation();
    if (menu.hidden) open();
    else close();
  });
  menu.addEventListener("keydown", (e) => {
    const enabled = items.filter((i) => !i.disabled);
    const at = enabled.indexOf(document.activeElement as HTMLButtonElement);
    if (e.key === "Escape") {
      e.preventDefault();
      close();
      button.focus();
    } else if (e.key === "ArrowDown" || e.key === "ArrowUp") {
      e.preventDefault();
      enabled[(at + (e.key === "ArrowDown" ? 1 : enabled.length - 1)) % enabled.length]?.focus();
    }
  });
  document.addEventListener("click", (e) => {
    if (!menu.hidden && !menu.contains(e.target as Node) && e.target !== button) close();
  });

  /** Nothing to send disables everything, the arrow too; while the agent runs, Send queues and forking waits. */
  function update(state: { hasText: boolean; running: boolean; available: boolean }) {
    button.disabled = !state.available || !state.hasText;
    for (const item of items) {
      const mode = item.dataset.mode as SendMode;
      item.disabled = !state.hasText || (mode === "fork" && state.running);
      item.title = mode === "fork" && state.running ? "Stop the agent first" : mode === "now" && state.running ? "Sends when the agent finishes" : "";
    }
    if (button.disabled) close();
  }

  return { button, menu, open, close, update };
}
