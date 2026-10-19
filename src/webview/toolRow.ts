// Tool calls in the transcript, one line each: what the agent is doing in plain words ("Reading
// src/a.ts"), how long it has taken, and a chevron that opens the arguments and output. No status
// marks: a running call's text shimmers, a failed one reads "Failed: …" in red. Built with createElement + textContent only.
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
  read: "file", edit: "pencil", delete: "trash", move: "branch", search: "search", execute: "terminal", think: "kernl", fetch: "globe", switch_mode: "shield",
};

/** Reads and searches: quiet steps that group into one "Explored …" line when they come in a row. */
export function quietKind(name: string, kind?: string, lookup?: "read" | "search"): "read" | "search" | undefined {
  if (lookup) return lookup; // a command that only reads or searches (the runner decides)
  if (kind) return kind === "read" || kind === "search" ? kind : undefined;
  return QUIET_TOOLS[name.replace(/^.+? > /, "")];
}
/** kernl's own file lookups (its job tools read job state, not files, so they don't group). */
const QUIET_TOOLS: Record<string, "read" | "search"> = { read_file: "read", ls: "search", glob: "search", grep: "search" };

export function kindIcon(name: string, kind?: string): IconName {
  const base = name.replace(/^.+? > /, "");
  return KIND_ICON[kind ?? KIND_OF_TOOL[base] ?? ""] ?? "tool";
}

/** Shorter than this, a call's time isn't shown: it was instant. */
const INSTANT_MS = 1000;
const shownElapsed = (ms: number) => (ms < INSTANT_MS ? "" : formatElapsed(ms));

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

/** Lines kept from each end of a long output; the middle opens with "Show all". */
const OUTPUT_EDGE_LINES = 5;

/** A tool's output: the first and last lines of a long one, with a button for the whole of it. */
function outputBlock(output: string): HTMLElement {
  const lines = output.replace(/\n$/, "").split("\n");
  // Hiding fewer than a couple of lines saves nothing.
  if (lines.length <= OUTPUT_EDGE_LINES * 2 + 2) return el("pre", "tool-output", output);
  const box = el("div", "tool-output-preview");
  const all = el("button", "link tool-output-all", `Show all ${lines.length} lines`);
  all.addEventListener("click", () => box.replaceWith(el("pre", "tool-output", output)));
  box.append(el("pre", "tool-output", lines.slice(0, OUTPUT_EDGE_LINES).join("\n")), all, el("pre", "tool-output", lines.slice(-OUTPUT_EDGE_LINES).join("\n")));
  return box;
}

export interface ToolRow {
  row: HTMLDetailsElement;
  /** Where a subagent's text and steps go (task rows only). */
  body: HTMLElement;
  /** A later report of the same call: new title, arguments, status, files, or edit. */
  update(name: string, args: Record<string, unknown>, rawArgs: string, info: ToolInfo): void;
  /** An image the call read or produced: a thumbnail on the line, larger when opened. */
  addImage(src: string): void;
  setResult(output: string, failed: boolean): void;
  stop(): void;
}

/** What a row can ask the host for. */
export interface ToolActions {
  showDiff(): void;
  openLocation(location: ToolLocation): void;
  /** An http(s) page, in the browser (the host checks the scheme again). */
  openLink(url: string): void;
}

/** A web page a call fetched or opened: its address, if it's http(s). */
function webPage(value: unknown): URL | undefined {
  try {
    const url = new URL(str(value));
    return url.protocol === "http:" || url.protocol === "https:" ? url : undefined;
  } catch {
    return undefined;
  }
}

/** Web search hits, as agents list them: one "Title (https://…)" per line (Claude Code's WebSearch). */
export function webHits(output: string): { title: string; url: string }[] {
  return output.split("\n").flatMap((line) => {
    const hit = /^\s*(?:[-*]\s+)?(.+?)\s+\((https?:\/\/[^\s()]+)\)\s*$/.exec(line);
    return hit ? [{ title: hit[1], url: hit[2] }] : [];
  });
}

const running = new Set<{ started: number; time: HTMLElement }>();
let ticker: ReturnType<typeof setInterval> | undefined;

/** One timer for every running row, only while any runs. */
function tick() {
  for (const r of running) r.time.textContent = shownElapsed(Date.now() - r.started);
  if (!running.size && ticker) (clearInterval(ticker), (ticker = undefined));
}

export function createToolRow(name: string, args: Record<string, unknown>, rawArgs: string, open = false, info: ToolInfo = {}, actions?: ToolActions): ToolRow {
  const row = el("details", "tool");
  row.open = open;
  const summary = el("summary");
  const kind = el("span", "tool-kind");
  const action = el("span", "tool-action");
  const target = el("span", "tool-target");
  const size = el("span", "tool-diff");
  const time = el("span", "tool-time");
  summary.append(kind, action, target, size, time, icon("chevron", 12));
  const body = el("div", "tool-body");
  const argsView = el("div");
  const files = el("div", "tool-files");
  body.append(files, argsView);
  row.append(summary, body);

  /** Everything that a later report of the same call can change. */
  // A command without the agent's description reads "Running <command>", then "Ran <command>".
  let undescribedCommand = false;
  // The file the call is about, if any: an image's Open button and its name.
  let location: ToolLocation | undefined;
  // The web page the call fetched or opened, if any.
  let page: URL | undefined;
  // How the call ended (once it has), and the latest report of it: the line is always drawn from
  // both, so a report that comes after the result can't erase "Failed:".
  let ended: ToolStatus | undefined;
  let latest = { n: name, a: args, raw: rawArgs, i: info };
  const show = (n: string, a: Record<string, unknown>, raw: string, i: ToolInfo) => {
    latest = { n, a, raw, i };
    // A command leads with what it's for; the command itself follows in monospace. A web page shows
    // its site, not the whole address (that's in the tooltip and the opened row).
    page = (i.kind === "fetch" || n === "browser_navigate") && !i.command ? webPage(a.url) : undefined;
    const d = i.command
      ? { action: i.description ?? (running.has(timer) ? "Running" : "Ran"), target: i.command }
      : page
        ? { action: n === "browser_navigate" ? "Opening" : "Fetch", target: page.hostname }
        : describeTool(n, a);
    undescribedCommand = !!i.command && !i.description;
    // "Failed: Find usages of x", "Stopped: Reading a.ts"; a command with no description: "Failed:" then the command.
    const outcome = ended === "failed" ? "Failed:" : ended === "stopped" ? "Stopped:" : undefined;
    action.textContent = outcome ? (undescribedCommand ? outcome : `${outcome} ${d.action}`) : d.action;
    target.textContent = d.target ?? "";
    target.hidden = !d.target;
    row.classList.toggle("command", !!i.command);
    target.classList.toggle("tool-site", !!page);
    summary.title = page ? `${d.action} ${page.href}` : d.target ? `${d.action}${i.command ? "\n" : " "}${d.target}` : d.action;
    kind.replaceChildren(icon(kindIcon(n, i.kind), 13));
    // A report without a status keeps the row's state (a new row starts running).
    if (running.has(timer) && (i.status || !row.dataset.status)) row.dataset.status = i.status === "pending" ? "pending" : "running";
    size.hidden = !i.diff;
    if (i.diff) {
      size.replaceChildren(el("span", "tool-added", `+${i.diff.added}`), el("span", "tool-removed", `−${i.diff.removed}`));
      size.title = `${i.diff.path}: ${i.diff.added} line(s) added, ${i.diff.removed} removed`;
    }
    files.replaceChildren();
    location = i.locations?.[0] ?? location;
    // A read names its file (for its group's file chips): the agent's location, or kernl's own path argument.
    const file = location?.path ?? (quietKind(n, i.kind, i.lookup) === "read" && (a.file_path ?? a.path) ? path(a.file_path ?? a.path) : undefined);
    if (file) row.dataset.file = file;
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
    if (page && actions) {
      const url = page.href;
      const open = el("button", "tool-location link", url);
      open.title = `Open ${url} in your browser`;
      open.addEventListener("click", () => actions.openLink(url));
      files.append(open);
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
    time.textContent = shownElapsed(Date.now() - timer.started);
    ended = state;
    row.dataset.status = state;
    show(latest.n, latest.a, latest.raw, latest.i);
    tick();
  };
  return {
    row,
    body,
    update: (n, a, raw, i) => show(n, a, raw, i),
    setResult(output, failed) {
      // A web search's hits become links, and their count shows on the line. Only a search's: other
      // output that happens to read "Title (https://…)" stays as it is.
      const searching = latest.i.kind === "fetch" && !page && !latest.i.command;
      const hits = searching ? webHits(output) : [];
      if (hits.length) {
        time.before(el("span", "tool-hits", `${hits.length} result${hits.length === 1 ? "" : "s"}`));
        const list = el("div", "tool-hit-list");
        for (const hit of hits) {
          const link = el("button", "tool-hit link");
          link.title = `Open ${hit.url} in your browser`;
          link.append(el("span", "tool-hit-title", hit.title), el("span", "tool-hit-site", webPage(hit.url)?.hostname ?? ""));
          link.addEventListener("click", () => actions?.openLink(hit.url));
          list.append(link);
        }
        body.append(list);
      }
      // The raw text only when it says more than the hits.
      const rest = output.split("\n").filter((line) => line.trim() && !webHits(line).length);
      if (output && (!hits.length || rest.length)) body.append(outputBlock(output));
      settle(failed ? "failed" : "done");
      // A failure is worth reading: its row opens itself.
      if (failed) row.open = true;
    },
    stop: () => settle("stopped"),
    addImage(src) {
      const name = location?.path.split("/").pop() ?? "Image";
      // On the line: decorative (the row already says what was read).
      const thumb = el("img", "tool-thumb");
      thumb.src = src;
      thumb.alt = "";
      thumb.setAttribute("aria-hidden", "true");
      time.before(thumb);
      // Opened: the image itself, up to 384 px, and Open for a file.
      const figure = el("div", "tool-preview");
      const image = el("img", "tool-image");
      image.src = src;
      image.alt = name;
      figure.append(image);
      if (location && actions) {
        const at = location;
        const open = el("button", "link tool-preview-open", `Open ${name}`);
        open.addEventListener("click", () => actions.openLocation(at));
        figure.append(open);
      }
      files.before(figure);
    },
  };
}
