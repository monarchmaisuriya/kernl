// The Conversations view: the whole panel shows a workspace's conversations (kernl's at once, each CLI
// agent's own sessions as it answers), with Back to the conversation and a search box. The host builds
// the rows (src/ui/conversationRows.ts); this shows them and sends the pick. Built with createElement +
// textContent only, like the rest of the panel.
import type { ConversationPick, ConversationRow } from "../ui/conversationRows";
import type { HostToPanel, PanelToHost } from "../ui/protocol";
import { icon } from "./icons";

function el<K extends keyof HTMLElementTagNameMap>(tag: K, className?: string, text?: string): HTMLElementTagNameMap[K] {
  const node = document.createElement(tag);
  if (className) node.className = className;
  if (text !== undefined) node.textContent = text;
  return node;
}

/** `onClose`: where focus goes when the view closes (the message box). */
export function createConversationsView(send: (m: PanelToHost) => void, onClose: () => void) {
  const view = el("section", "panel-view conversations");
  view.hidden = true;
  view.setAttribute("aria-label", "Conversations");
  const header = el("div", "panel-view-header");
  const back = el("button", "icon-button conversations-back");
  back.append(icon("back", 14));
  back.setAttribute("aria-label", "Back to the conversation");
  back.title = "Back to the conversation (Escape)";
  back.addEventListener("click", () => hide());
  const title = el("h2", "panel-view-title", "Conversations");
  header.append(back, title);
  const search = el("input", "conversations-search");
  search.type = "search";
  search.placeholder = "Search conversations";
  search.setAttribute("aria-label", "Search conversations");
  search.addEventListener("input", () => render());
  const body = el("div", "panel-view-body");
  body.setAttribute("role", "list");
  view.append(header, search, body);
  view.addEventListener("keydown", (e) => {
    if (e.key === "Escape") (e.preventDefault(), hide());
  });

  let workspace: string | undefined;
  let rows: ConversationRow[] = [];

  function pick(p: ConversationPick) {
    if (!workspace) return;
    send({ type: "openConversation", workspace, pick: p });
    hide();
  }

  function rowButton(r: Exclude<ConversationRow, { kind: "pending" }>): HTMLElement {
    const b = el("button", `conversation${r.kind === "kernl" && r.current ? " current" : ""}`);
    b.setAttribute("role", "listitem");
    const main = el("span", "conversation-main");
    main.append(el("span", "conversation-title", r.title));
    if (r.kind !== "new") main.append(el("span", "conversation-detail", r.detail));
    b.append(r.kind === "new" ? icon("plus", 14) : r.kind === "kernl" && r.current ? icon("check", 14) : icon("chat", 14), main);
    if (r.kind === "kernl" && r.current) b.setAttribute("aria-current", "true");
    b.addEventListener("click", () => pick(r.kind === "new" ? { kind: "new" } : r.kind === "kernl" ? { kind: "kernl", id: r.id } : { kind: "agent", agent: r.agent, sessionId: r.sessionId }));
    return b;
  }

  function render() {
    const query = search.value.trim().toLowerCase();
    const shown = rows.filter((r) => r.kind === "new" || r.kind === "pending" || r.title.toLowerCase().includes(query));
    const out: HTMLElement[] = [];
    let group: string | undefined;
    for (const r of shown) {
      if (r.kind !== "new" && r.group !== group) {
        group = r.group;
        out.push(el("h3", "panel-view-group-title", group));
      }
      out.push(r.kind === "pending" ? el("div", "conversation-pending", r.title) : rowButton(r));
    }
    if (query && !shown.some((r) => r.kind === "kernl" || r.kind === "agent")) out.push(el("p", "conversations-empty", "No conversation matches."));
    body.replaceChildren(...out);
  }

  /**
   * New rows. Opening starts fresh (a new search); a later update (an agent answered) is drawn in place,
   * keeping the search and scroll, and only for the workspace shown.
   */
  function update(m: Extract<HostToPanel, { type: "conversations" }>) {
    if (!m.open && m.workspace !== workspace) return;
    if (m.open) search.value = "";
    workspace = m.workspace;
    rows = m.rows;
    title.textContent = m.title;
    render();
  }

  function show() {
    const opening = view.hidden;
    view.hidden = false;
    if (opening) search.focus();
  }

  function hide() {
    if (view.hidden) return;
    view.hidden = true;
    onClose();
  }

  return {
    view,
    update,
    show,
    hide,
    get open() {
      return !view.hidden;
    },
    /** The workspace whose conversations are shown. */
    get workspace() {
      return workspace;
    },
  };
}
