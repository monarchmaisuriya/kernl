// Panel UI. Builds every element with createElement + textContent: model output, file contents,
// and page text are untrusted, so nothing is ever parsed as HTML (test/unit/webviewSafety.test.ts).
// One transcript per workspace (the main folder plus worktree workspaces); the footer's workspace
// chip switches between them. New chat and New workspace live in VS Code's view title bar.
import type { ApprovalCard, HarnessView, HostToPanel, PanelToHost, SendMode, WorkspaceView } from "../ui/protocol";
import { icon } from "./icons";
import { attachmentChip, createAttachments } from "./attachments";
import { MarkdownView } from "./markdown";
import { createSendMenu, sendModeOf } from "./sendMenu";

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
  /** Delegated subagents' text, per task call, rendered as Markdown inside the task row. */
  subagents: Map<string, { view: MarkdownView; text: string; steps: HTMLElement }>;
  /** The latest task row: where a subagent's own tool calls go. */
  lastSubagent?: string;
  /** Background jobs in this workspace (the footer's jobs chip). */
  jobs: { running: number; total: number };
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
function thoughtRow(args: Record<string, unknown>): HTMLElement {
  const row = el("div", "thought");
  const n = `${args.thoughtNumber ?? "?"}/${args.totalThoughts ?? "?"}`;
  const kind = args.isRevision === true || args.isRevision === "true" ? `Revision ${n}${args.revisesThought ? ` (of thought ${args.revisesThought})` : ""}` : args.branchFromThought ? `Branch ${n} (from thought ${args.branchFromThought}${args.branchId ? `, ${args.branchId}` : ""})` : `Thought ${n}`;
  const head = el("div", "thought-head");
  head.append(icon("sparkle", 13), el("span", "", kind));
  row.append(head, el("div", "thought-text", String(args.thought ?? "")));
  return row;
}

type Status = Extract<HostToPanel, { type: "status" }>;

const app = document.getElementById("app")!;
const banner = el("div", "banner");
const logs = el("div", "logs");
const empty = el("div", "empty");
const emptyText = el("p", "empty-text");
// Shown instead of a transcript when the window has no folder YourStack can work in.
const openFolder = el("button", "primary", "Open Folder");
openFolder.addEventListener("click", () => send({ type: "openFolder" }));
empty.append(icon("sparkle", 40), el("h2", "empty-title", "Build with YourStack"), emptyText, openFolder);
logs.append(empty);

const composer = el("div", "composer");
const input = el("textarea", "input");
input.placeholder = "Describe what to build";
input.rows = 2;
input.setAttribute("aria-label", "Message");
// Opens the host's agent menu (YourStack and its agents first, then Claude Code, Codex, OpenCode).
const agentChip = el("button", "chip harness");
const modelChip = el("button", "chip model");
const sendButton = iconButton("send", "Send", icon("send"));
const attachButton = iconButton("chip attach", "Add files or folders", icon("plus"));
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
const modeChip = el("span", "chip mode");
const jobsChip = el("button", "chip jobs");
jobsChip.addEventListener("click", () => send({ type: "pickJob" }));
const usage = el("span", "usage");
footer.append(workspaceChip, modeChip, jobsChip, el("span", "spacer"), usage);
app.append(banner, logs, composer, footer);

const markdownActions = { openLink: (url: string) => send({ type: "openLink", url }), copy: (text: string) => send({ type: "copy", text }) };
const panes = new Map<string, Pane>();
const cards = new Map<string, HTMLElement>();
let harnesses: HarnessView[] = [];
let active = "main";
/** Why there is no workspace (no folder open, or only remote ones), from the host. */
let noWorkspace: string | undefined;
let status: Status | undefined;

const pane = (id: string) => panes.get(id);

function scroll() {
  const p = pane(active);
  if (p) p.log.scrollTop = p.log.scrollHeight;
}

/** Everything outside the transcripts: composer, chips, banner, empty state. */
function render() {
  const p = pane(active);
  const running = p?.view.running ?? false;
  const deepAgents = p?.view.harness === "deepagents";
  for (const [id, q] of panes) q.log.hidden = id !== active;
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
    const setKey = el("button", "primary", "Set API key");
    setKey.addEventListener("click", () => send({ type: "setKey" }));
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
  modeChip.replaceChildren(icon("shield", 14), el("span", "chip-text", restricted ? "Read-only" : "Asks first"));
  modeChip.classList.toggle("restricted", restricted);
  modeChip.title = restricted ? "Restricted Mode: the agent can only read." : (p?.view.disclosure ?? "");
  usage.textContent = p?.usage ?? "";
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
      panes.set(view.id, { view, log, usage: "", replyText: "", toolRows: new Map(), subagents: new Map(), jobs: { running: 0, total: 0 } });
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
  attachments.onInput(pane(active)?.view.harness.startsWith("deepagents") ?? false);
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
  const row = el("div", "buttons");
  const approve = el("button", "primary", "Approve");
  const reject = el("button", "", "Reject");
  approve.addEventListener("click", () => send({ type: "answer", id: card.id, approved: true }));
  reject.addEventListener("click", () => send({ type: "answer", id: card.id, approved: false }));
  row.append(approve, reject);
  if (card.hasDiff) {
    const diff = el("button", "link", "View diff");
    diff.addEventListener("click", () => send({ type: "showDiff", id: card.id }));
    row.append(diff);
  }
  box.append(row);
  cards.set(card.id, box);
  p.log.append(box);
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
      attachments.setSkills(m.items);
      return;
    case "activeFile":
      attachments.setActiveFile(m.path);
      return;
  }
  const p = pane(m.workspace);
  if (!p) return;
  switch (m.type) {
    case "userMessage": {
      const bubble = el("div", "user", m.text);
      if (m.checkpoint && m.id) {
        // Hover action: put the files (and maybe the conversation) back to before this message.
        const restore = iconButton("restore", "Restore checkpoint", icon("undo", 14));
        const messageId = m.id;
        restore.addEventListener("click", () => send({ type: "restore", workspace: p.view.id, messageId }));
        bubble.append(restore);
      }
      if (m.id) {
        const fork = iconButton("fork", "Fork from here", icon("branch", 14));
        const messageId = m.id;
        fork.addEventListener("click", () => send({ type: "fork", workspace: p.view.id, messageId }));
        bubble.append(fork);
      }
      if (m.attachments?.length) {
        const row = el("div", "user-attachments");
        row.append(...m.attachments.map((a) => attachmentChip(a)));
        bubble.append(row);
      }
      p.log.append(bubble);
      break;
    }
    case "text":
      if (!p.assistant) {
        // A new reply starts wherever the previous one was closed (send, tool call, finished, cleared).
        const reply = el("div", "assistant md");
        p.log.append(reply);
        p.assistant = new MarkdownView(reply, markdownActions);
        p.replyText = "";
      }
      p.replyText += m.delta;
      p.assistant.update(p.replyText);
      break;
    case "toolCall": {
      p.assistant = undefined;
      const args = argsOf(m.args);
      if (m.name === "sequential_thinking") {
        const row = thoughtRow(args);
        p.toolRows.set(m.id, row);
        p.log.append(row);
        break;
      }
      const row = el("details", m.name === "task" ? "tool subagent" : "tool");
      const summary = el("summary");
      if (m.name === "task") {
        // A delegated subagent: its text streams into this row (open while it works).
        row.open = true;
        summary.append(icon("branch", 14), el("span", "tool-name", `Subagent: ${String(args.subagent_type ?? "general-purpose")}`), el("span", "tool-detail", String(args.description ?? "")));
        const steps = el("div", "subagent-steps");
        const body = el("div", "subagent-output md");
        p.subagents.set(m.id, { view: new MarkdownView(body, markdownActions), text: "", steps });
        p.lastSubagent = m.id;
        row.append(summary, steps, body);
      } else {
        summary.append(icon("tool", 14), el("span", "tool-name", m.name));
        row.append(summary, el("pre", "", m.args));
      }
      p.toolRows.set(m.id, row);
      // A subagent's own tool calls ("explorer > grep") go inside its row.
      const parent = m.name.includes(" > ") && p.lastSubagent ? p.subagents.get(p.lastSubagent) : undefined;
      (parent ? parent.steps : p.log).append(row);
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
    case "toolResult": {
      const row = p.toolRows.get(m.id);
      if (row?.classList.contains("thought")) break; // the thought itself is the content; its JSON reply isn't
      if (row) row.append(el("pre", "result", m.output));
      else p.log.append(el("pre", "result", `${m.name}\n${m.output}`));
      break;
    }
    case "usage":
      p.usage = `${m.inputTokens.toLocaleString()} in · ${m.outputTokens.toLocaleString()} out tokens`;
      break;
    case "finished":
      p.assistant = undefined;
      if (m.reason === "stopped") p.log.append(el("div", "note", "Stopped."));
      if (m.reason === "error") p.log.append(el("div", "error", m.message ?? "Something went wrong."));
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
      p.toolRows.clear();
      p.usage = "";
      p.assistant = undefined;
      break;
  }
  render();
  if (m.workspace === active) scroll();
});

render();
send({ type: "ready" });
