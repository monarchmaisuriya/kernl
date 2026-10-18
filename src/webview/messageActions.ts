// The row of icon buttons under a message: Copy, Restore, Fork under yours; Copy, Fork under a
// finished reply. Each button has a fixed place, so Restore (added once its restore point is ready)
// lands between Copy and Fork. Built with createElement + textContent only.
import { icon } from "./icons";

export type MessageActionId = "copy" | "restore" | "fork";

const ORDER: MessageActionId[] = ["copy", "restore", "fork"];
const ICONS = { copy: "copy", restore: "undo", fork: "branch" } as const;
const COPIED_MS = 1500;

export interface MessageActions {
  row: HTMLElement;
  /** Adds a button in its place; adding the same action again returns the existing button. */
  add(id: MessageActionId, label: string, run: () => void): HTMLButtonElement;
  /** An action that can't run here stays visible and focusable, with the reason as its label. */
  setUnavailable(id: MessageActionId, reason: string | undefined): void;
}

export function createMessageActions(side: "user" | "reply"): MessageActions {
  const row = document.createElement("div");
  row.className = `message-actions ${side}-actions`;
  row.setAttribute("role", "toolbar");
  row.setAttribute("aria-label", side === "user" ? "Message actions" : "Reply actions");
  const buttons = new Map<MessageActionId, { button: HTMLButtonElement; label: string }>();

  const label = (b: HTMLButtonElement, text: string) => {
    b.setAttribute("aria-label", text);
    b.title = text;
  };

  return {
    row,
    add(id, text, run) {
      const known = buttons.get(id);
      if (known) return known.button;
      const b = document.createElement("button");
      b.className = `message-action ${id}`;
      label(b, text);
      b.append(icon(ICONS[id], 14));
      b.addEventListener("click", () => {
        if (b.getAttribute("aria-disabled") === "true") return;
        run();
        if (id !== "copy") return;
        // Copied: a check for a moment, then the copy icon again.
        b.replaceChildren(icon("check", 14));
        label(b, "Copied");
        setTimeout(() => {
          b.replaceChildren(icon("copy", 14));
          label(b, text);
        }, COPIED_MS);
      });
      buttons.set(id, { button: b, label: text });
      const next = ORDER.slice(ORDER.indexOf(id) + 1).map((n) => buttons.get(n)?.button).find(Boolean);
      row.insertBefore(b, next ?? null);
      return b;
    },
    setUnavailable(id, reason) {
      const known = buttons.get(id);
      if (!known) return;
      if (reason) known.button.setAttribute("aria-disabled", "true");
      else known.button.removeAttribute("aria-disabled");
      label(known.button, reason ?? known.label);
    },
  };
}
