// Panel UI. Builds every element with createElement + textContent: model output, file contents,
// and page text are untrusted, so nothing is ever parsed as HTML (test/unit/webviewSafety.test.ts).
// One transcript per workspace (the main folder plus worktree workspaces); the footer's workspace
// chip switches between them. New chat and New workspace live in VS Code's view title bar.
import type { ApprovalCard, HarnessView, HostToPanel, PanelToHost, PlanEntryView, SendMode, SkillView, WorkspaceView } from "../ui/protocol";
import { icon } from "./icons";
import { attachmentChip, createAttachments } from "./attachments";
import { MarkdownView } from "./markdown";
import { createMenu } from "./menu";
import { createMessageActions, type MessageActions } from "./messageActions";
import { createModeMenu, modeIcon } from "./modeMenu";
import { createSendMenu, sendModeOf } from "./sendMenu";
import { type ContextUsage, createContextRing } from "./contextRing";
import { createPlanBar } from "./planBar";
import { createThinking, type ThinkingBlock } from "./thinking";
import { createToolGroup, type ToolGroup } from "./toolGroup";
import { createToolRow, formatElapsed, quietKind, type ToolRow } from "./toolRow";

declare function acquireVsCodeApi(): { postMessage(m: PanelToHost): void };
const vscode = acquireVsCodeApi();
const send = (m: PanelToHost) => vscode.postMessage(m);

function el<K extends keyof HTMLElementTagNameMap>(tag: K, className?: string, text?: string): HTMLElementTagNameMap[K] {
  const node = document.createElement(tag);
  if (className) node.className = className;
  if (text !== undefined) node.textContent = text;
  return node;
}

/** A button showing an icon (and optional text), labeled for screen readers and tooltips. */
function iconButton(className: string, label: string, ...content: (Node | string)[]) {
  const b = el("button", className);
  b.setAttribute("aria-label", label);
  b.title = label;
  b.append(...content);
  return b;
}

interface Pane {
  view: WorkspaceView;
  log: HTMLElement;
  usage: string;
  /** The reply being streamed: its view and its Markdown so far (re-rendered on each delta). */
  assistant?: MarkdownView;
  replyText: string;
  toolRows: Map<string, HTMLElement>;
  /** Tool calls shown as one-line rows (status, plain description, time), by call id. */
  tools: Map<string, ToolRow>;
  /** Groups of reads and searches that came in a row ("Explored 1 file, 4 searches"), by group element. */
  toolGroups: Map<HTMLElement, ToolGroup>;
  /** Whether this turn's reply already has its hidden heading. */
  replyHeading?: boolean;
  /** The thinking block being streamed, until text, a tool call, or the end of the run follows. */
  thinking?: ThinkingBlock;
  /** The agent's latest plan (replaced whole by each update). */
  plan?: PlanEntryView[];
  /** How full the agent's context window is (agents that report it). */
  context?: ContextUsage;
  /** The agent's own slash commands (CLI agents). */
  commands?: SkillView[];
  /** Delegated subagents' text, per task call, rendered as Markdown inside the task row. */
  subagents: Map<string, { view: MarkdownView; text: string; steps: HTMLElement }>;
  /** The latest task row: where a subagent's own tool calls go. */
  lastSubagent?: string;
  /** When the panel saw the current run start (for the Working indicator's time). */
  runStarted?: number;
  /** Background jobs in this workspace (the footer's jobs chip). */
  jobs: { running: number; total: number };
  /** The action row under each of your messages, by message id (Restore is added once its restore point is ready). */
  messageActions: Map<string, MessageActions>;
  /** The action row under each finished reply. */
  replyActions: MessageActions[];
  /** The current turn: its message id (for Fork) and all its reply text (for Copy). */
  turn?: { messageId?: string; text: string };
}

/** Tool arguments arrive as JSON text; a malformed or truncated one just isn't read. */
function argsOf(json: string): Record<string, unknown> {
  try {
    const v = JSON.parse(json);
    return v && typeof v === "object" ? v : {};
  } catch {
    return {};
  }
}

/** A sequential-thinking step: "Thought 2/5" (or a revision or branch) and the thought. */
/** A sequential-thinking step: one line ("Thought 2/5" and the start of the thought) that opens to the full thought. */
function thoughtRow(args: Record<string, unknown>): HTMLElement {
  const row = el("details", "thought");
  const n = `${args.thoughtNumber ?? "?"}/${args.totalThoughts ?? "?"}`;
  const kind = args.isRevision === true || args.isRevision === "true" ? `Revision ${n}${args.revisesThought ? ` (of thought ${args.revisesThought})` : ""}` : args.branchFromThought ? `Branch ${n} (from thought ${args.branchFromThought}${args.branchId ? `, ${args.branchId}` : ""})` : `Thought ${n}`;
  const thought = String(args.thought ?? "");
  const summary = el("summary");
  summary.append(icon("kernl", 13), el("span", "thought-head", kind), el("span", "thought-preview", thought.split("\n")[0]), icon("chevron", 12));
  row.append(summary, el("div", "thought-text", thought));
  return row;
}

type Status = Extract<HostToPanel, { type: "status" }>;

const app = document.getElementById("app")!;
const banner = el("div", "banner");
const logs = el("div", "logs");
// The transcript is a log, but streaming tokens aren't read out one by one: the announcer below
// says when a reply is finished, when an approval is needed, and when something went wrong.
logs.setAttribute("role", "log");
logs.setAttribute("aria-live", "off");
logs.setAttribute("aria-label", "Conversation");
const politeAnnouncer = el("div", "sr-only");
politeAnnouncer.setAttribute("role", "status");
politeAnnouncer.setAttribute("aria-live", "polite");
const urgentAnnouncer = el("div", "sr-only");
urgentAnnouncer.setAttribute("role", "alert");
urgentAnnouncer.setAttribute("aria-live", "assertive");
function announce(text: string, urgent = false) {
  const target = urgent ? urgentAnnouncer : politeAnnouncer;
  target.textContent = "";
  target.textContent = text;
}
const empty = el("div", "empty");
const emptyText = el("p", "empty-text");
// Shown instead of a transcript when the window has no folder kernl can work in.
const openFolder = el("button", "primary", "Open Folder");
openFolder.addEventListener("click", () => send({ type: "openFolder" }));
empty.append(icon("kernl", 40), el("h2", "empty-title", "Build with kernl"), emptyText, openFolder);
logs.append(empty);

const composer = el("div", "composer");
const input = el("textarea", "input");
input.placeholder = "Describe what to build";
input.rows = 2;
input.setAttribute("aria-label", "Message");
// Opens the host's agent menu (kernl and its agents first, then Claude Code, Codex, OpenCode).
const agentChip = el("button", "chip harness");
const modelChip = el("button", "chip model");
// Menus the host opens for a control appear next to it (see menu.ts).
agentChip.dataset.anchor = "agent";
modelChip.dataset.anchor = "model";
const sendButton = iconButton("send", "Send", icon("send"));
const attachButton = iconButton("chip attach", "Add files or folders", icon("plus"));
attachButton.dataset.anchor = "attach";
const attachments = createAttachments(input, (m) => send(m), () => render());
const sendMenu = createSendMenu((mode) => submit(mode));
const sendGroup = el("div", "send-group");
sendGroup.append(sendButton, sendMenu.button);
const toolbar = el("div", "toolbar");
toolbar.append(attachButton, agentChip, modelChip, el("span", "spacer"), sendGroup);
const context = el("div", "context-row");
context.append(attachments.suggestion, attachments.chips);
const inputWrap = el("div", "input-wrap");
inputWrap.append(attachments.layer, input);
// Messages waiting for the current run to end (kept by the host).
const queueList = el("div", "queue");
composer.append(attachments.popover, sendMenu.menu, queueList, context, inputWrap, toolbar);

const footer = el("div", "footer");
const workspaceChip = el("button", "chip workspace");
workspaceChip.dataset.anchor = "workspace";
// The permission mode: opens a menu of the modes this workspace's agent supports.
const modeChip = el("button", "chip mode");
const modeMenu = createModeMenu((mode) => send({ type: "setMode", workspace: active, mode }));
modeChip.addEventListener("click", (e) => {
  e.stopPropagation();
  const p = pane(active);
  if (!p || status?.restricted || p.view.modes.length < 2) return;
  if (modeMenu.isOpen()) modeMenu.close();
  else modeMenu.open(p.view.modes, p.view.mode);
});
document.addEventListener("click", (e) => {
  if (modeMenu.isOpen() && !modeMenu.menu.contains(e.target as Node)) modeMenu.close();
});
const jobsChip = el("button", "chip jobs");
jobsChip.dataset.anchor = "jobs";
const anchoredMenu = createMenu((id, index) => send(index === undefined ? { type: "menuPick", id } : { type: "menuPick", id, index }));
jobsChip.addEventListener("click", () => send({ type: "pickJob" }));
const usage = el("span", "usage");
const contextRing = createContextRing();
const planBar = createPlanBar();
footer.append(modeMenu.menu, workspaceChip, modeChip, jobsChip, el("span", "spacer"), contextRing.ring, usage);
app.append(banner, logs, planBar.bar, composer, footer, anchoredMenu.menu, politeAnnouncer, urgentAnnouncer);

const markdownActions = { openLink: (url: string) => send({ type: "openLink", url }), copy: (text: string) => send({ type: "copy", text }) };
const panes = new Map<string, Pane>();
const cards = new Map<string, HTMLElement>();
let harnesses: HarnessView[] = [];
let active = "main";
/** Why there is no workspace (no folder open, or only remote ones), from the host. */
let noWorkspace: string | undefined;
/** kernl's skills (for its own agent's "/" menu); CLI agents send their own commands per workspace. */
let kernlSkills: SkillView[] = [];
let status: Status | undefined;

const pane = (id: string) => panes.get(id);

function scroll() {
  const p = pane(active);
  if (p) p.log.scrollTop = p.log.scrollHeight;
}

/** Everything outside the transcripts: composer, chips, banner, empty state. */
// While the agent works: "Working" (shimmering) and how long the run has taken, kept at the end of
// the shown transcript. Only the label is a live region: the ticking time isn't read out.
const working = el("div", "working");
const workingMark = el("span", "working-mark");
const workingText = el("span", "working-label");
workingText.setAttribute("role", "status");
const workingTime = el("span", "working-time");
workingTime.setAttribute("aria-hidden", "true");
working.append(workingMark, workingText, workingTime);
let workingTicker: ReturnType<typeof setInterval> | undefined;

/** The elapsed time beside the label, from 1 s (same format as tool rows). */
function showElapsed() {
  const started = pane(active)?.runStarted;
  const ms = started === undefined ? 0 : Date.now() - started;
  workingTime.textContent = ms < 1000 ? "" : `· ${formatElapsed(ms)}`;
}

function render() {
  const p = pane(active);
  const running = p?.view.running ?? false;
  const deepAgents = p?.view.harness === "deepagents";
  for (const [id, q] of panes) {
    q.log.hidden = id !== active;
    if (!q.view.running) q.runStarted = undefined;
    else q.runStarted ??= Date.now();
  }
  if (p && running) {
    const waiting = p.view.waiting > 0;
    const label = waiting ? "Waiting for your approval" : "Working";
    if (workingText.textContent !== label) workingText.textContent = label;
    working.classList.toggle("waiting", waiting);
    workingMark.replaceChildren(icon(waiting ? "shield" : "kernl", 13));
    showElapsed();
    workingTicker ??= setInterval(showElapsed, 1000);
    if (p.log.lastElementChild !== working) p.log.append(working);
  } else {
    working.remove();
    if (workingTicker) (clearInterval(workingTicker), (workingTicker = undefined));
  }
  empty.hidden = p ? p.log.childElementCount > 0 : !noWorkspace;
  emptyText.textContent = p ? p.view.disclosure : (noWorkspace ?? "");
  openFolder.hidden = !!p || !noWorkspace;

  sendButton.replaceChildren(icon(running ? "stop" : "send"));
  sendButton.classList.toggle("stop", running);
  const sendLabel = running ? "Stop" : "Send";
  sendButton.setAttribute("aria-label", sendLabel);
  sendButton.title = sendLabel;
  sendButton.disabled = !p || (!running && !input.value.trim());
  sendMenu.update({ hasText: !!input.value.trim(), running, available: !!p });
  input.disabled = !p;
  renderQueue(p);

  const harness = harnesses.find((h) => h.id === p?.view.harness);
  agentChip.replaceChildren(...(harness && !harness.ready ? [icon("warning", 14)] : []), el("span", "chip-text", harness?.label ?? p?.view.harness ?? "Agent"), icon("chevron", 14));
  agentChip.classList.toggle("not-ready", !!harness && !harness.ready);
  agentChip.setAttribute("aria-label", `Agent: ${harness?.label ?? ""}${harness?.problem ? `. ${harness.problem}` : ""}. Change agent`);
  agentChip.title = harness?.problem ?? "Change the agent for this workspace";
  agentChip.disabled = !p || running;

  modelChip.hidden = !deepAgents || !status;
  if (status) {
    modelChip.replaceChildren(el("span", "chip-text", status.model || `${status.provider}: no model set`), icon("chevron", 14));
    modelChip.setAttribute("aria-label", `Model: ${status.provider} ${status.model}. Change model`);
    modelChip.title = `${status.provider} · ${status.model || "no model set"}\nChange the Deep Agents provider and model`;
  }

  banner.replaceChildren();
  banner.hidden = !(deepAgents && status?.problem);
  if (status?.problem && deepAgents) {
    // One flow fixes either problem: provider, then a key if it has none, then the model.
    const setKey = el("button", "primary", "Choose provider and model");
    setKey.addEventListener("click", () => send({ type: "pickModel" }));
    const settings = el("button", "", "Open settings");
    settings.addEventListener("click", () => send({ type: "openSettings" }));
    const actions = el("div", "banner-actions");
    actions.append(setKey, settings);
    banner.append(icon("warning"), el("div", "problem", status.problem), actions);
  }

  if (p) {
    const others = [...panes.values()].filter((q) => q !== p);
    const attention = others.some((q) => q.view.waiting > 0) ? "waiting" : others.some((q) => q.view.running) ? "running" : "";
    workspaceChip.replaceChildren(icon(p.view.branch ? "branch" : "folder", 14), el("span", "chip-text", p.view.label));
    if (attention) workspaceChip.append(el("span", `dot ${attention}`));
    workspaceChip.append(icon("chevron", 14));
    workspaceChip.dataset.attention = attention;
    const label = `Workspace: ${p.view.label}${attention ? ` (another workspace is ${attention === "waiting" ? "waiting for approval" : "running"})` : ""}`;
    workspaceChip.setAttribute("aria-label", label);
    workspaceChip.title = p.view.branch ? `${label}\nBranch ${p.view.branch}` : label;
  }
  const restricted = status?.restricted ?? false;
  const mode = p?.view.modes.find((m) => m.id === p.view.mode);
  const choosable = !!p && !restricted && p.view.modes.length > 1;
  modeChip.replaceChildren(icon(restricted ? "shield" : modeIcon(mode?.icon ?? "shield"), 14), el("span", "chip-text", restricted ? "Read-only" : (mode?.label ?? "Ask before edits")));
  if (choosable) modeChip.append(icon("chevron", 14));
  modeChip.classList.toggle("restricted", restricted);
  modeChip.classList.toggle("bypass", p?.view.mode === "bypass");
  modeChip.disabled = !choosable;
  modeChip.title = restricted ? "Restricted Mode: the agent can only read." : `${p?.view.disclosure ?? ""}${choosable ? "\nChange the permission mode" : ""}`;
  modeChip.setAttribute("aria-label", `Permission mode: ${restricted ? "Read-only" : (mode?.label ?? "")}${choosable ? ". Change mode" : ""}`);
  if (!choosable) modeMenu.close();
  usage.textContent = p?.usage ?? "";
  contextRing.show(p?.context);
  planBar.show(p?.plan);
  const jobs = p?.jobs ?? { running: 0, total: 0 };
  jobsChip.hidden = jobs.total === 0;
  jobsChip.replaceChildren(icon("tool", 14), el("span", "chip-text", jobs.running ? `${jobs.running} job${jobs.running === 1 ? "" : "s"} running` : `${jobs.total} job${jobs.total === 1 ? "" : "s"} done`));
  jobsChip.classList.toggle("active", jobs.running > 0);
  jobsChip.title = "Background jobs: show output or stop";
}

/** The queued messages above the input: each can be removed, or sent now once the queue has paused. */
function renderQueue(p: Pane | undefined) {
  const items = p?.view.queue ?? [];
  queueList.hidden = items.length === 0;
  if (!p || !items.length) return queueList.replaceChildren();
  const head = el("div", "queue-head");
  head.append(icon("clock", 13), el("span", "", p.view.queuePaused ? `Queued (${items.length}), paused: send one to continue` : `Queued (${items.length}): sends when the agent finishes`));
  const rows = items.map((q) => {
    const row = el("div", "queued");
    row.append(el("span", "queued-text", q.text));
    if (q.attachments) row.append(el("span", "queued-badge", `+${q.attachments}`));
    if (p.view.queuePaused || !p.view.running) {
      const now = el("button", "link queued-send", "Send now");
      now.addEventListener("click", () => send({ type: "sendQueued", workspace: p.view.id, id: q.id }));
      row.append(now);
    }
    const remove = iconButton("queued-remove", "Remove from queue", icon("close", 13));
    remove.addEventListener("click", () => send({ type: "unqueue", workspace: p.view.id, id: q.id }));
    row.append(remove);
    return row;
  });
  queueList.replaceChildren(head, ...rows);
}

/**
 * Adds a tool row to the transcript (or a subagent's steps). Reads and searches that come in a row,
 * with nothing else between them, share one "Explored …" line; a single one stays a plain row.
 */
function placeToolRow(p: Pane, container: HTMLElement, row: HTMLElement, quiet: "read" | "search" | undefined) {
  if (!quiet) return container.append(row);
  const last = lastLine(container);
  const previous = last instanceof HTMLElement ? last : undefined;
  const group = previous && p.toolGroups.get(previous);
  if (group) return group.add(row, quiet);
  const earlier = previous?.dataset.quiet as "read" | "search" | undefined;
  if (!previous || !earlier) {
    row.dataset.quiet = quiet;
    return container.append(row);
  }
  const created = createToolGroup((path) => send({ type: "openLocation", workspace: p.view.id, path }));
  p.toolGroups.set(created.element, created);
  previous.replaceWith(created.element);
  created.add(previous, earlier);
  created.add(row, quiet);
}

/** The newest line in a transcript or a subagent's steps (the Working indicator isn't part of it). */
function lastLine(container: HTMLElement): Element | null {
  const last = container.lastElementChild;
  return last === working ? last.previousElementSibling : last;
}

function refreshGroups(p: Pane) {
  for (const group of p.toolGroups.values()) group.refresh();
}

/** Restore under a message: put the files (and maybe the conversation) back to before it. */
function addRestore(actions: MessageActions, workspace: string, messageId: string) {
  const restore = actions.add("restore", "Restore checkpoint", () => send({ type: "restore", workspace, messageId }));
  restore.dataset.anchor = `restore:${messageId}`;
}

/** Fork under a message or a reply: a new conversation up to and including that turn's reply. */
function addFork(p: Pane, actions: MessageActions, messageId: string) {
  const workspace = p.view.id;
  actions.add("fork", "Fork from here", () => send({ type: "fork", workspace, messageId }));
}

/** A CLI agent copies its whole session to fork, so only the latest turn can be forked. */
function cliForkLimit(p: Pane): string | undefined {
  if (p.view.harness.startsWith("deepagents")) return undefined;
  const label = (harnesses.find((h) => h.id === p.view.harness)?.label ?? "This agent").replace(/ \(experimental\)$/, "");
  return `${label} can fork only from the last message`;
}

/** Under a finished reply: Copy (every block of the turn's reply) and Fork. */
function addReplyActions(p: Pane, turn: { messageId?: string; text: string }) {
  const actions = createMessageActions("reply");
  const text = turn.text.trim();
  actions.add("copy", "Copy reply", () => send({ type: "copy", text }));
  if (turn.messageId) addFork(p, actions, turn.messageId);
  p.replyActions.push(actions);
  actions.row.classList.add("latest");
  p.log.append(actions.row);
}

/** The newest turn's action rows stay visible; earlier ones show on hover or focus. */
function markLatest(p: Pane, rows: HTMLElement[]) {
  for (const old of p.log.querySelectorAll(".message-actions.latest")) old.classList.remove("latest");
  for (const row of rows) row.classList.add("latest");
}

function select(id: string) {
  if (!panes.has(id)) return;
  const changed = id !== active;
  active = id;
  render();
  scroll();
  if (changed) send({ type: "focus", workspace: id });
}

function setWorkspaces(items: WorkspaceView[], focus?: string) {
  const ids = new Set(items.map((w) => w.id));
  for (const [id, p] of panes) if (!ids.has(id)) (p.log.remove(), panes.delete(id));
  for (const view of items) {
    const existing = panes.get(view.id);
    if (existing) existing.view = view;
    else {
      const log = el("div", "log");
      logs.append(log);
      panes.set(view.id, { view, log, usage: "", replyText: "", toolRows: new Map(), tools: new Map(), subagents: new Map(), jobs: { running: 0, total: 0 }, messageActions: new Map(), replyActions: [], toolGroups: new Map() });
    }
  }
  const next = focus && panes.has(focus) ? focus : panes.has(active) ? active : (items[0]?.id ?? "main");
  if (next !== active) select(next);
  else render();
}

/** Sends the composer's message. While the agent runs, "now" and "queue" wait their turn (the host queues them); a fork waits for Stop. */
function submit(mode: SendMode = "now") {
  const p = pane(active);
  const text = input.value.trim();
  if (!p || !text || (mode === "fork" && p.view.running)) return;
  const files = attachments.take();
  input.value = "";
  attachments.refresh();
  if (!p.view.running) p.assistant = undefined;
  send({ type: "send", workspace: active, text, ...(files.length ? { attachments: files } : {}), ...(mode === "now" ? {} : { mode }) });
  render();
}

// Approval shortcuts act on the newest card in the shown workspace: allow once, allow always (when offered), reject.
document.addEventListener("keydown", (e) => {
  // Not while typing a message (Ctrl+Y is Redo there on Windows): approvals are never a typing accident.
  if (!(e.metaKey || e.ctrlKey) || document.activeElement === input) return;
  const key = e.key.toLowerCase();
  const action = key === "y" && !e.altKey ? "once" : (key === "y" || e.code === "KeyY") && e.altKey ? "always" : (key === "z" || e.code === "KeyZ") && e.altKey ? "reject" : undefined;
  if (!action) return;
  const p = pane(active);
  const open = p ? [...p.log.querySelectorAll<HTMLElement>(".card[data-card-id]")].filter((c) => cards.get(c.dataset.cardId!) === c) : [];
  const newest = open.at(-1);
  if (!newest) return;
  if (action === "always" && !newest.querySelector('[data-action="always"]')) return;
  e.preventDefault();
  const id = newest.dataset.cardId!;
  send(action === "reject" ? { type: "answer", id, approved: false } : action === "always" ? { type: "answer", id, approved: true, always: true } : { type: "answer", id, approved: true });
});

sendButton.addEventListener("click", () => (pane(active)?.view.running ? send({ type: "stop", workspace: active }) : submit()));
input.addEventListener("keydown", (e) => {
  if (attachments.onKeydown(e)) return;
  const mode = sendModeOf(e);
  if (mode) {
    e.preventDefault();
    submit(mode);
  }
});
input.addEventListener("input", () => {
  // "/" offers kernl's skills to its own agent, and a CLI agent's own commands to that agent.
  const p = pane(active);
  const slash = !p ? [] : p.view.harness.startsWith("deepagents") ? kernlSkills : (p.commands ?? []);
  attachments.setSkills(slash);
  attachments.onInput(slash.length > 0);
  render();
});
attachButton.addEventListener("click", () => send({ type: "pickAttachments" }));
// Files dropped anywhere on the panel are attached (the host checks they're in the workspace).
app.addEventListener("dragover", (e) => e.preventDefault());
app.addEventListener("drop", (e) => attachments.onDrop(e));
agentChip.addEventListener("click", () => send({ type: "pickHarness" }));
modelChip.addEventListener("click", () => send({ type: "pickModel" }));
workspaceChip.addEventListener("click", () => send({ type: "pickWorkspace" }));

function renderCard(card: ApprovalCard) {
  const p = pane(card.workspaceId) ?? pane(active);
  if (!p) return;
  const box = el("div", "card");
  const head = el("div", "card-head");
  head.append(icon("shield", 14), el("span", "card-title", card.title), el("span", "card-workspace", card.workspace));
  box.append(head, el("pre", "card-detail", card.detail));
  box.setAttribute("role", "group");
  box.setAttribute("aria-label", `Approval needed: ${card.title}`);
  const row = el("div", "buttons");
  const mod = /Mac|iPhone|iPad/.test(navigator.platform || navigator.userAgent) ? "⌘" : "Ctrl+";
  const alt = mod === "⌘" ? "⌥" : "Alt+";
  const approve = el("button", "primary", "Approve");
  approve.title = `Allow this once (${mod}Y)`;
  const reject = el("button", "", "Reject");
  reject.title = `Reject (${mod}${alt}Z)`;
  approve.addEventListener("click", () => send({ type: "answer", id: card.id, approved: true }));
  reject.addEventListener("click", () => send({ type: "answer", id: card.id, approved: false }));
  row.append(approve);
  // Only when the agent itself offers it, in its own words (e.g. "Always allow"): never the default.
  if (card.always) {
    const always = el("button", "", card.always);
    always.title = `${card.always} (${mod}${alt}Y)`;
    always.dataset.action = "always";
    always.addEventListener("click", () => send({ type: "answer", id: card.id, approved: true, always: true }));
    row.append(always);
  }
  row.append(reject);
  box.dataset.cardId = card.id;
  if (card.hasDiff) {
    const diff = el("button", "link", "View diff");
    diff.addEventListener("click", () => send({ type: "showDiff", id: card.id }));
    row.append(diff);
  }
  box.append(row);
  cards.set(card.id, box);
  p.log.append(box);
  announce(`Approval needed: ${card.title}`);
  if (card.workspaceId !== active) select(card.workspaceId);
  else render();
}

window.addEventListener("message", (event: MessageEvent<HostToPanel>) => {
  const m = event.data;
  switch (m.type) {
    case "status":
      status = m;
      render();
      return;
    case "workspaces":
      harnesses = m.harnesses;
      noWorkspace = m.problem;
      setWorkspaces(m.items, m.focus);
      return;
    case "snapshot":
      // A reloaded panel: restore every card still waiting for an answer.
      for (const card of m.cards) if (!cards.has(card.id)) renderCard(card);
      return;
    case "approval":
      renderCard(m.card);
      scroll();
      return;
    case "approvalClosed":
      cards.get(m.id)?.remove();
      cards.delete(m.id);
      render();
      return;
    case "addAttachments":
      attachments.add(m.items);
      input.focus();
      return;
    case "fileMatches":
      attachments.onFileMatches(m.query, m.items);
      return;
    case "skills":
      kernlSkills = m.items;
      return;
    case "activeFile":
      attachments.setActiveFile(m.path);
      return;
    case "menu":
      anchoredMenu.open(m);
      return;
    case "menuClosed":
      anchoredMenu.closed(m.id);
      return;
  }
  const p = pane(m.workspace);
  if (!p) return;
  // Thinking ends when anything else from the agent (or the end of the run) arrives.
  if (p.thinking && m.type !== "thinking" && m.type !== "usage" && m.type !== "context" && m.type !== "jobs" && m.type !== "commands") {
    p.thinking.done();
    p.thinking = undefined;
  }
  switch (m.type) {
    case "userMessage": {
      // A hidden heading per turn, so screen readers can jump between turns.
      p.log.append(el("h3", "sr-only", "Your message"));
      p.replyHeading = false;
      const message = el("div", "user-message");
      const bubble = el("div", "user", m.text);
      if (m.id) bubble.dataset.messageId = m.id;
      if (m.attachments?.length) {
        const row = el("div", "user-attachments");
        row.append(...m.attachments.map((a) => attachmentChip(a)));
        bubble.append(row);
      }
      // Under the message: Copy, Restore (once its restore point is ready), Fork.
      const actions = createMessageActions("user");
      const text = m.text;
      actions.add("copy", "Copy message", () => send({ type: "copy", text }));
      if (m.id) {
        p.messageActions.set(m.id, actions);
        if (m.checkpoint) addRestore(actions, p.view.id, m.id);
        addFork(p, actions, m.id);
      }
      // A CLI agent can't fork earlier turns any more.
      const limit = cliForkLimit(p);
      if (limit) for (const earlier of p.messageActions.values()) if (earlier !== actions) earlier.setUnavailable("fork", limit);
      for (const reply of p.replyActions) reply.setUnavailable("fork", limit);
      message.append(bubble, actions.row);
      p.log.append(message);
      p.turn = { messageId: m.id, text: "" };
      markLatest(p, [actions.row]);
      break;
    }
    case "checkpoint": {
      const actions = p.messageActions.get(m.messageId);
      if (actions) addRestore(actions, p.view.id, m.messageId);
      break;
    }
    case "text":
      if (!p.assistant) {
        if (!p.replyHeading) {
          p.log.append(el("h3", "sr-only", "Reply"));
          p.replyHeading = true;
        }
        // A new reply starts wherever the previous one was closed (send, tool call, finished, cleared).
        const reply = el("div", "assistant md");
        p.log.append(reply);
        p.assistant = new MarkdownView(reply, markdownActions);
        p.replyText = "";
        // Copy under the reply copies every block of this turn's reply, a blank line apart.
        if (p.turn?.text) p.turn.text += "\n\n";
      }
      p.replyText += m.delta;
      if (p.turn) p.turn.text += m.delta;
      p.assistant.update(p.replyText);
      break;
    case "thinking": {
      if (!p.thinking) {
        p.assistant = undefined;
        p.thinking = createThinking(status?.thinkingDisplay ?? "auto");
        p.log.append(p.thinking.element);
      }
      p.thinking.append(m.delta);
      break;
    }
    case "toolCall": {
      p.assistant = undefined;
      const args = argsOf(m.args);
      const known = p.tools.get(m.id);
      if (known) {
        known.update(m.name, args, m.args, m);
        // A command's input can arrive after its first report: once it shows the call is a lookup,
        // the row joins the lookups just before it (only while it's still the newest line).
        const quiet = quietKind(m.name, m.kind, m.lookup);
        const row = known.row;
        const container = row.parentElement;
        if (quiet && container && !row.dataset.quiet && !p.toolGroups.has(container.parentElement as HTMLElement) && lastLine(container) === row) {
          row.remove();
          placeToolRow(p, container, row, quiet);
        }
        refreshGroups(p);
        break;
      }
      if (m.name === "sequential_thinking") {
        const row = thoughtRow(args);
        p.toolRows.set(m.id, row);
        p.log.append(row);
        break;
      }
      // A delegated subagent's row stays open while it works: its steps and text stream into it.
      const workspace = p.view.id;
      const id = m.id;
      const tool = createToolRow(m.name, args, m.args, m.name === "task", m, {
        showDiff: () => send({ type: "showToolDiff", workspace, id }),
        openLocation: (l) => send({ type: "openLocation", workspace, path: l.path, ...(l.line ? { line: l.line } : {}) }),
        openLink: (url) => send({ type: "openLink", url }),
      });
      const row = tool.row;
      if (m.name === "task") {
        row.classList.add("subagent");
        const steps = el("div", "subagent-steps");
        const body = el("div", "subagent-output md");
        p.subagents.set(m.id, { view: new MarkdownView(body, markdownActions), text: "", steps });
        p.lastSubagent = m.id;
        tool.body.append(steps, body);
      }
      p.tools.set(m.id, tool);
      p.toolRows.set(m.id, row);
      // A subagent's own tool calls ("explorer > grep") go inside its row.
      const parent = m.name.includes(" > ") && p.lastSubagent ? p.subagents.get(p.lastSubagent) : undefined;
      placeToolRow(p, parent ? parent.steps : p.log, row, quietKind(m.name, m.kind, m.lookup));
      break;
    }
    case "subagentText": {
      const sub = p.subagents.get(m.id);
      if (!sub) break;
      sub.text += m.delta;
      sub.view.update(sub.text);
      break;
    }
    case "jobs":
      p.jobs = { running: m.running, total: m.total };
      break;
    case "plan":
      p.plan = m.entries;
      break;
    case "context":
      p.context = { used: m.used, size: m.size, cost: m.cost };
      break;
    case "commands":
      p.commands = m.items;
      break;
    case "toolResult": {
      const row = p.toolRows.get(m.id);
      if (row?.classList.contains("thought")) break; // the thought itself is the content; its JSON reply isn't
      const tool = p.tools.get(m.id);
      if (tool) tool.setResult(m.output, m.failed === true);
      else if (row) row.append(el("pre", "result", m.output));
      else p.log.append(el("pre", "result", `${m.name}\n${m.output}`));
      refreshGroups(p);
      break;
    }
    case "toolPreview": {
      // Only a saved preview's own name (conversation/call-id.ext) is accepted, under the host's previews folder.
      if (!status?.previewBase || !/^[\w-]+\/[\w-]+\.(png|jpg|gif|webp)$/.test(m.file)) break;
      p.tools.get(m.id)?.addImage(`${status.previewBase}/${m.file}`);
      refreshGroups(p);
      break;
    }
    case "usage":
      p.usage = `${m.inputTokens.toLocaleString()} in · ${m.outputTokens.toLocaleString()} out tokens`;
      break;
    case "finished":
      p.assistant = undefined;
      if (m.workspace === active) {
        if (m.reason === "done") announce(`Reply finished. ${p.replyText.replace(/\s+/g, " ").slice(0, 200)}`);
        else if (m.reason === "error") announce(`Something went wrong: ${m.message ?? ""}`, true);
        else announce("Stopped.");
      }
      // Calls that never reported back (Stop, an error) stop their timers.
      for (const tool of p.tools.values()) tool.stop();
      refreshGroups(p);
      if (m.reason === "stopped") p.log.append(el("div", "note", "Stopped."));
      if (m.reason === "error") p.log.append(el("div", "error", m.message ?? "Something went wrong."));
      if (p.turn?.text.trim()) addReplyActions(p, p.turn);
      p.turn = undefined;
      break;
    case "setInput":
      input.value = m.text;
      attachments.refresh();
      input.focus();
      break;
    case "notice":
      p.log.append(el("div", "note", m.text));
      break;
    case "cleared":
      p.log.replaceChildren();
      for (const tool of p.tools.values()) tool.stop();
      p.tools.clear();
      p.toolRows.clear();
      p.toolGroups.clear();
      p.usage = "";
      p.assistant = undefined;
      p.plan = undefined;
      p.context = undefined;
      p.messageActions.clear();
      p.replyActions = [];
      p.turn = undefined;
      break;
  }
  render();
  if (m.workspace === active) scroll();
});

render();
send({ type: "ready" });
