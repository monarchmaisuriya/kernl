// Tool calls in the transcript, one line each: a status mark (running, done, failed, stopped), what
// the agent is doing in plain words ("Reading src/a.ts"), how long it has taken, and a chevron that
// opens the arguments and output. Built with createElement + textContent only.
import { icon } from "./icons";

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
  setResult(output: string, failed: boolean): void;
  stop(): void;
}

const running = new Set<{ started: number; time: HTMLElement }>();
let ticker: ReturnType<typeof setInterval> | undefined;

/** One timer for every running row, only while any runs. */
function tick() {
  for (const r of running) r.time.textContent = formatElapsed(Date.now() - r.started);
  if (!running.size && ticker) (clearInterval(ticker), (ticker = undefined));
}

export function createToolRow(name: string, args: Record<string, unknown>, rawArgs: string, open = false): ToolRow {
  const { action, target } = describeTool(name, args);
  const row = el("details", "tool");
  row.dataset.status = "running";
  row.open = open;
  const summary = el("summary");
  const status = el("span", "tool-status");
  status.append(el("span", "tool-pulse"));
  const time = el("span", "tool-time", "0s");
  summary.append(status, el("span", "tool-action", action));
  if (target) summary.append(el("span", "tool-target", target));
  summary.append(time, icon("chevron", 12));
  summary.title = target ? `${action} ${target}` : action;
  const body = el("div", "tool-body");
  body.append(argsBlock(args, rawArgs));
  row.append(summary, body);

  const timer = { started: Date.now(), time };
  running.add(timer);
  ticker ??= setInterval(tick, 1000);

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
    setResult(output, failed) {
      if (output) body.append(el("pre", "tool-output", output));
      settle(failed ? "failed" : "done");
    },
    stop: () => settle("stopped"),
  };
}
