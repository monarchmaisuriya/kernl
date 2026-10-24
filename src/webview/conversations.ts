// The Conversations view: the whole panel shows a workspace's conversations (kernl's at once, each CLI
// agent's own sessions as it answers, then kernl's archived ones, folded), with Back to the conversation
// and a search box. Each kernl row has Archive (or Unarchive) at its end. The host builds
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
  /** The Archived group unfolded (a search shows its matches either way); folded again each time the view opens. */
  let showArchived = false;

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
    if (r.kind !== "kernl") return b;
    // A button can't hold a button: the row and its Archive button sit side by side in a list item.
    b.removeAttribute("role");
    const item = el("div", "conversation-item");
    item.setAttribute("role", "listitem");
    const action = el("button", "icon-button conversation-action");
    action.append(icon(r.archived ? "unarchive" : "archive", 14));
    action.title = r.archived ? "Unarchive" : "Archive";
    action.setAttribute("aria-label", `${r.archived ? "Unarchive" : "Archive"} ${r.title}`);
    action.addEventListener("click", () => workspace && send({ type: r.archived ? "unarchiveConversation" : "archiveConversation", workspace, id: r.id }));
    item.append(b, action);
    return item;
  }

  function archivedToggle(count: number): HTMLElement {
    const t = el("button", "panel-view-group-title conversations-archived-toggle");
    t.append(icon("chevron", 12), document.createTextNode(`Archived (${count})`));
    t.setAttribute("aria-expanded", String(showArchived));
    t.addEventListener("click", () => {
      showArchived = !showArchived;
      render();
    });
    return t;
  }

  function render() {
    const query = search.value.trim().toLowerCase();
    const shown = rows.filter((r) => r.kind === "new" || r.kind === "pending" || r.title.toLowerCase().includes(query));
    const out: HTMLElement[] = [];
    let group: string | undefined;
    const archived = shown.filter((r) => r.kind === "kernl" && r.archived).length;
    for (const r of shown) {
      const inArchived = r.kind === "kernl" && r.archived;
      if (r.kind !== "new" && r.group !== group) {
        group = r.group;
        // While searching, matching archived rows show without unfolding the group.
        out.push(inArchived && !query ? archivedToggle(archived) : el("h3", "panel-view-group-title", group));
      }
      if (inArchived && !query && !showArchived) continue;
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
    if (m.open) (search.value = "", (showArchived = false));
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
