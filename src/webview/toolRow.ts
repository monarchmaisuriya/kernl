// Tool calls in the transcript, one line each: a status mark (running, done, failed, stopped), what
// the agent is doing in plain words ("Reading src/a.ts"), how long it has taken, and a chevron that
// opens the arguments and output. Built with createElement + textContent only.
import type { ToolInfo, ToolLocation } from "../ui/protocol";
import { icon, type IconName } from "./icons";

export type ToolStatus = "running" | "done" | "failed" | "stopped";

/** A plain sentence for a tool call: the action and, separately, what it acts on. */
export interface ToolDescription {
  action: string;
  target?: string;
}

const str = (v: unknown) => (typeof v === "string" ? v : v === undefined || v === null ? "" : JSON.stringify(v));
/** The YourStack agent's paths are workspace paths starting with "/". */
const path = (v: unknown) => str(v).replace(/^\/+/, "") || ".";
const short = (s: string, max = 80) => (s.length > max ? `${s.slice(0, max - 1)}…` : s);

const DESCRIBE: Record<string, (a: Record<string, unknown>) => ToolDescription> = {
  ls: (a) => ({ action: "Listing", target: path(a.path) }),
  read_file: (a) => ({ action: "Reading", target: path(a.file_path ?? a.path) }),
  write_file: (a) => ({ action: "Writing", target: path(a.file_path ?? a.path) }),
  edit_file: (a) => ({ action: "Editing", target: path(a.file_path ?? a.path) }),
  glob: (a) => ({ action: "Finding files", target: str(a.pattern) }),
  grep: (a) => ({ action: "Searching for", target: `"${str(a.pattern)}"${a.path ? ` in ${path(a.path)}` : ""}` }),
  execute: (a) => ({ action: "Running", target: short(str(a.command)) }),
  write_todos: () => ({ action: "Updating the to-do list" }),
  task: (a) => ({ action: `Delegating to ${str(a.subagent_type) || "a subagent"}`, target: short(str(a.description)) }),
  start_background_job: (a) => ({ action: "Starting background job", target: short(str(a.name) || str(a.command)) }),
  check_background_job: (a) => ({ action: "Checking background job", target: str(a.id) }),
  stop_background_job: (a) => ({ action: "Stopping background job", target: str(a.id) }),
  list_background_jobs: () => ({ action: "Listing background jobs" }),
  browser_navigate: (a) => ({ action: "Opening", target: str(a.url) }),
  browser_click: (a) => ({ action: "Clicking", target: str(a.selector) }),
  browser_type: (a) => ({ action: "Typing into", target: str(a.selector) }),
  browser_read_page: () => ({ action: "Reading the page" }),
  browser_screenshot: () => ({ action: "Taking a screenshot" }),
};

/**
 * What a tool call does, in plain words. Known tools get a sentence; a CLI agent's own title
 * ("Read hello.txt") is already one; an MCP tool ("server__tool") names its server; a subagent's
 * call ("explorer > grep") is prefixed with the subagent.
 */
export function describeTool(name: string, args: Record<string, unknown>): ToolDescription {
  const nested = /^(.+?) > (.+)$/.exec(name);
  if (nested) {
    const inner = describeTool(nested[2], args);
    return { action: `${nested[1]}: ${inner.action}`, target: inner.target };
  }
  const known = DESCRIBE[name];
  if (known) return known(args);
  if (/\s/.test(name)) return { action: name }; // already a sentence (CLI agents' titles)
  const mcp = /^([^_].*?)__(.+)$/.exec(name);
  if (mcp) return { action: `${mcp[1]}: ${humanize(mcp[2])}` };
  return { action: humanize(name) };
}

function humanize(name: string) {
  const words = name.replace(/[_-]+/g, " ").trim();
  return words.charAt(0).toUpperCase() + words.slice(1);
}

/** The kind of action a tool call is (ACP kinds; kernl's own tools mapped by name), for its icon. */
const KIND_OF_TOOL: Record<string, string> = {
  ls: "search", glob: "search", grep: "search", read_file: "read", write_file: "edit", edit_file: "edit", execute: "execute",
  start_background_job: "execute", check_background_job: "read", stop_background_job: "execute", list_background_jobs: "read",
  browser_navigate: "fetch", browser_click: "fetch", browser_type: "fetch", browser_read_page: "fetch", browser_screenshot: "fetch", task: "think",
};
const KIND_ICON: Record<string, IconName> = {
  read: "file", edit: "pencil", delete: "trash", move: "branch", search: "search", execute: "terminal", think: "sparkle", fetch: "globe", switch_mode: "shield",
};

export function kindIcon(name: string, kind?: string): IconName {
  const base = name.replace(/^.+? > /, "");
  return KIND_ICON[kind ?? KIND_OF_TOOL[base] ?? ""] ?? "tool";
}

export function formatElapsed(ms: number): string {
  const s = Math.max(0, Math.round(ms / 1000));
  return s < 60 ? `${s}s` : `${Math.floor(s / 60)}m ${s % 60}s`;
}

const el = <K extends keyof HTMLElementTagNameMap>(tag: K, className?: string, text?: string) => {
  const node = document.createElement(tag);
  if (className) node.className = className;
  if (text !== undefined) node.textContent = text;
  return node;
};

/** The arguments as "key: value" lines (long values cut), instead of raw JSON. */
function argsBlock(args: Record<string, unknown>, raw: string): HTMLElement {
  const block = el("div", "tool-args");
  const entries = Object.entries(args);
  if (!entries.length) {
    if (raw && raw !== "{}") block.append(el("pre", "", raw));
    return block;
  }
  for (const [key, value] of entries) {
    const line = el("div", "tool-arg");
    line.append(el("span", "tool-arg-key", key), el("span", "tool-arg-value", short(str(value), 400)));
    block.append(line);
  }
  return block;
}

export interface ToolRow {
  row: HTMLDetailsElement;
  /** Where a subagent's text and steps go (task rows only). */
  body: HTMLElement;
  /** A later report of the same call: new title, arguments, status, files, or edit. */
  update(name: string, args: Record<string, unknown>, rawArgs: string, info: ToolInfo): void;
  setResult(output: string, failed: boolean): void;
  stop(): void;
}

/** What a row can ask the host for. */
export interface ToolActions {
  showDiff(): void;
  openLocation(location: ToolLocation): void;
}

const running = new Set<{ started: number; time: HTMLElement }>();
let ticker: ReturnType<typeof setInterval> | undefined;

/** One timer for every running row, only while any runs. */
function tick() {
  for (const r of running) r.time.textContent = formatElapsed(Date.now() - r.started);
  if (!running.size && ticker) (clearInterval(ticker), (ticker = undefined));
}

export function createToolRow(name: string, args: Record<string, unknown>, rawArgs: string, open = false, info: ToolInfo = {}, actions?: ToolActions): ToolRow {
  const row = el("details", "tool");
  row.open = open;
  const summary = el("summary");
  const status = el("span", "tool-status");
  const kind = el("span", "tool-kind");
  const action = el("span", "tool-action");
  const target = el("span", "tool-target");
  const size = el("span", "tool-diff");
  const time = el("span", "tool-time", "0s");
  summary.append(status, kind, action, target, size, time, icon("chevron", 12));
  const body = el("div", "tool-body");
  const argsView = el("div");
  const files = el("div", "tool-files");
  body.append(files, argsView);
  row.append(summary, body);

  /** Everything that a later report of the same call can change. */
  const show = (n: string, a: Record<string, unknown>, raw: string, i: ToolInfo) => {
    const d = describeTool(n, a);
    action.textContent = d.action;
    target.textContent = d.target ?? "";
    target.hidden = !d.target;
    summary.title = d.target ? `${d.action} ${d.target}` : d.action;
    kind.replaceChildren(icon(kindIcon(n, i.kind), 13));
    // A report without a status keeps the row's mark (a new row starts running).
    if (running.has(timer) && (i.status || !row.dataset.status)) {
      row.dataset.status = i.status === "pending" ? "pending" : "running";
      status.replaceChildren(el("span", i.status === "pending" ? "tool-waiting" : "tool-pulse"));
    }
    size.hidden = !i.diff;
    if (i.diff) {
      size.replaceChildren(el("span", "tool-added", `+${i.diff.added}`), el("span", "tool-removed", `−${i.diff.removed}`));
      size.title = `${i.diff.path}: ${i.diff.added} line(s) added, ${i.diff.removed} removed`;
    }
    files.replaceChildren();
    for (const location of i.locations ?? []) {
      const link = el("button", "tool-location link", `${location.path}${location.line ? `:${location.line}` : ""}`);
      link.addEventListener("click", () => actions?.openLocation(location));
      files.append(link);
    }
    if (i.diff && actions) {
      const view = el("button", "tool-view-diff link", "View diff");
      view.addEventListener("click", () => actions.showDiff());
      files.append(view);
    }
    files.hidden = !files.childElementCount;
    argsView.replaceChildren(argsBlock(a, raw));
  };

  const timer = { started: Date.now(), time };
  running.add(timer);
  ticker ??= setInterval(tick, 1000);
  show(name, args, rawArgs, info);

  const settle = (state: ToolStatus) => {
    if (!running.delete(timer)) return;
    time.textContent = formatElapsed(Date.now() - timer.started);
    row.dataset.status = state;
    status.replaceChildren(state === "done" ? icon("check", 12) : state === "failed" ? icon("close", 12) : el("span", "tool-stopped"));
    status.title = state === "done" ? "Done" : state === "failed" ? "Failed" : "Stopped";
    tick();
  };
  return {
    row,
    body,
    update: (n, a, raw, i) => show(n, a, raw, i),
    setResult(output, failed) {
      if (output) body.append(el("pre", "tool-output", output));
      settle(failed ? "failed" : "done");
    },
    stop: () => settle("stopped"),
  };
}
