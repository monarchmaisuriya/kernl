// The Connections view: every connection kernl depends on (agents' logins, stored keys, MCP servers
// including claude.ai connectors, plugins) with its state, what its source said, when it was
// checked, and a fix. The host owns the statuses; this only shows them and sends the user's clicks.
// Built with createElement + textContent only, like the rest of the panel.
import type { ConnectionStatus } from "../connections/types";
import type { PanelToHost } from "../ui/protocol";
import { icon } from "./icons";

function el<K extends keyof HTMLElementTagNameMap>(tag: K, className?: string, text?: string): HTMLElementTagNameMap[K] {
  const node = document.createElement(tag);
  if (className) node.className = className;
  if (text !== undefined) node.textContent = text;
  return node;
}

const STATE_LABEL: Record<ConnectionStatus["state"], string> = {
  ready: "Ready",
  needsAction: "Needs you",
  failed: "Failed",
  unknown: "Can't tell",
  off: "Off",
};

/** "just now", "12 s ago", "3 min ago", "2 h ago". */
export function ago(ms: number): string {
  const s = Math.max(0, Math.round(ms / 1000));
  if (s < 5) return "just now";
  if (s < 60) return `${s} s ago`;
  if (s < 3600) return `${Math.round(s / 60)} min ago`;
  return `${Math.round(s / 3600)} h ago`;
}

/** The groups, in order: agents, keys, then MCP servers and plugins under each agent. */
export function groupsOf(items: readonly ConnectionStatus[]): { title: string; items: ConnectionStatus[] }[] {
  const groups: { title: string; items: ConnectionStatus[] }[] = [
    { title: "Agents", items: items.filter((i) => i.kind === "agent") },
    { title: "Keys", items: items.filter((i) => i.kind === "providerKey" || i.kind === "agentKey") },
  ];
  for (const owner of [...new Set(items.filter((i) => i.kind === "mcp").map((i) => i.owner))]) {
    groups.push({ title: `MCP servers: ${owner}`, items: items.filter((i) => i.kind === "mcp" && i.owner === owner) });
  }
  groups.push({ title: "Plugins: Claude Code", items: items.filter((i) => i.kind === "plugin") });
  return groups.filter((g) => g.items.length);
}

export function createConnectionsView(send: (m: PanelToHost) => void) {
  const view = el("section", "panel-view connections");
  view.hidden = true;
  view.setAttribute("aria-label", "Connections");
  const header = el("div", "panel-view-header");
  const title = el("h2", "panel-view-title", "Connections");
  const check = el("button", "", "Check now");
  check.title = "Check every login, key, MCP server, and plugin again";
  check.addEventListener("click", () => send({ type: "connectionAction", action: "check", target: "all" }));
  const close = el("button", "icon-button");
  close.append(icon("close", 14));
  close.setAttribute("aria-label", "Close Connections");
  close.addEventListener("click", () => hide());
  header.append(title, check, close);
  const body = el("div", "panel-view-body");
  view.append(header, body);
  view.addEventListener("keydown", (e) => e.key === "Escape" && hide());

  let items: ConnectionStatus[] = [];
  let ticker: ReturnType<typeof setInterval> | undefined;

  function row(s: ConnectionStatus): HTMLElement {
    const r = el("div", "connection");
    r.dataset.id = s.id;
    r.dataset.state = s.state;
    if (s.checking) r.dataset.checking = "true";
    const dot = el("span", `connection-dot ${s.state}`);
    dot.setAttribute("aria-hidden", "true");
    const main = el("div", "connection-main");
    const line = el("div", "connection-line");
    line.append(el("span", "connection-label", s.label), el("span", "connection-state", s.checking ? "Checking…" : STATE_LABEL[s.state]));
    const meta = el("div", "connection-meta", `${s.source} · ${ago(Date.now() - s.checkedAt)}`);
    meta.dataset.checkedAt = String(s.checkedAt);
    meta.dataset.source = s.source;
    main.append(line, el("div", "connection-detail", s.detail), meta);
    r.append(dot, main);
    if (s.fix) {
      const fix = s.fix;
      const button = el("button", s.state === "needsAction" || s.state === "failed" ? "primary" : "", fix.label);
      button.addEventListener("click", () => send({ type: "connectionAction", action: fix.action, target: fix.target }));
      r.append(button);
    }
    r.setAttribute("aria-label", `${s.label}: ${STATE_LABEL[s.state]}. ${s.detail}`);
    return r;
  }

  function render() {
    const groups = groupsOf(items);
    body.replaceChildren(
      ...(groups.length
        ? groups.map((g) => {
            const section = el("div", "connections-group");
            section.append(el("h3", "panel-view-group-title", g.title), ...g.items.map(row));
            return section;
          })
        : [el("p", "connections-empty", "Checking…")]),
    );
  }

  /** "checked N s ago" stays current while the view is open. */
  function tick() {
    for (const meta of body.querySelectorAll<HTMLElement>(".connection-meta")) {
      meta.textContent = `${meta.dataset.source} · ${ago(Date.now() - Number(meta.dataset.checkedAt))}`;
    }
  }

  function show(focus?: string) {
    const opening = view.hidden;
    view.hidden = false;
    ticker ??= setInterval(tick, 5_000);
    if (opening) send({ type: "showConnections", focus });
    if (focus) {
      const target = [...body.querySelectorAll<HTMLElement>(".connection")].find((r) => r.dataset.id === focus);
      target?.classList.add("focused");
      target?.scrollIntoView({ block: "center" });
    } else check.focus();
  }

  function hide() {
    view.hidden = true;
    if (ticker) (clearInterval(ticker), (ticker = undefined));
  }

  return {
    view,
    show,
    hide,
    get open() {
      return !view.hidden;
    },
    update(next: ConnectionStatus[]) {
      items = next;
      render();
    },
  };
}
