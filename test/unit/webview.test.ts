// Click-through tests for the panel webview. The built out/webview/main.js runs in jsdom with a
// fake VS Code bridge: tests send host messages, click real elements, and check what the panel
// sends back. Covers the empty state, transcripts, the workspace and model chips, the agent picker,
// the composer's send/stop button, approval cards, snapshot restore, the setup banner, and that
// untrusted text never becomes HTML.
import { strict as assert } from "node:assert";
import { readFileSync } from "node:fs";
import { resolve } from "node:path";
import { test } from "node:test";
import { JSDOM } from "jsdom";
import type { HarnessView, HostToPanel, PanelToHost, WorkspaceView } from "../../src/ui/protocol";

const script = readFileSync(resolve(__dirname, "../webview/main.js"), "utf8");

function loadPanel() {
  const dom = new JSDOM(`<!DOCTYPE html><body><div id="app"></div></body>`, { runScripts: "outside-only" });
  const { window } = dom;
  const sent: PanelToHost[] = [];
  // Like the real webview bridge, messages are serialized on the way out (and leave jsdom's realm).
  (window as any).acquireVsCodeApi = () => ({ postMessage: (m: PanelToHost) => sent.push(JSON.parse(JSON.stringify(m))) });
  window.eval(script);
  const doc = window.document;
  const host = (m: HostToPanel) => window.dispatchEvent(new window.MessageEvent("message", { data: m }));
  const all = (sel: string) => [...doc.querySelectorAll<HTMLElement>(sel)];
  // By visible text, or by aria-label for icon buttons and chips.
  const button = (name: string, scope: ParentNode = doc) =>
    [...scope.querySelectorAll<HTMLButtonElement>("button")].find((b) => b.textContent === name || b.getAttribute("aria-label") === name);
  const visibleLog = () => all(".log").find((l) => !l.hidden)!;
  return { window, doc, sent, host, all, button, visibleLog };
}

const MAIN: WorkspaceView = { id: "main", label: "Main", harness: "deepagents", running: false, waiting: 0, disclosure: "Deep Agents asks before every edit.", queue: [], queuePaused: false, mode: "ask", modes: [] };
const WT: WorkspaceView = { id: "wt:fix", label: "fix", harness: "claude-code", branch: "yourstack/fix", running: false, waiting: 0, disclosure: "Claude Code runs approved actions itself.", queue: [], queuePaused: false, mode: "ask", modes: [] };
const STATUS: HostToPanel = { type: "status", ready: true, provider: "deepseek", model: "deepseek-flash", restricted: false };
const HARNESSES: HarnessView[] = [
  { id: "deepagents", label: "YourStack", group: "yourstack", ready: true },
  { id: "claude-code", label: "Claude Code", group: "agents", ready: true },
  { id: "codex", label: "Codex (experimental)", group: "agents", ready: false, problem: "Codex isn't logged in: run `codex login` in a terminal, or add an API key." },
  { id: "opencode", label: "OpenCode", group: "agents", ready: true },
];
const workspaces = (items: WorkspaceView[], focus?: string): HostToPanel => ({ type: "workspaces", items, harnesses: HARNESSES, focus });
const card = (id: string, workspaceId: string, workspace: string, hasDiff = false) =>
  ({ id, workspaceId, workspace, title: "Run command", detail: "npm test", hasDiff });

test("the panel announces it is ready as soon as it loads", () => {
  const p = loadPanel();
  assert.deepEqual(p.sent, [{ type: "ready" }]);
});

test("an empty workspace shows the empty state with its agent's disclosure, until the first message", () => {
  const p = loadPanel();
  p.host(workspaces([MAIN, WT], "wt:fix"));
  const empty = p.doc.querySelector<HTMLElement>(".empty")!;
  assert.equal(empty.hidden, false);
  assert.match(empty.textContent!, /Build with YourStack/);
  assert.match(empty.textContent!, /Claude Code runs approved actions itself/, "the safety disclosure stays visible");
  p.host({ type: "userMessage", workspace: "wt:fix", text: "hi" });
  assert.equal(empty.hidden, true);
});

test("transcripts are per workspace; the host's focus switches the shown transcript and the panel reports it", () => {
  const p = loadPanel();
  p.host(workspaces([MAIN, WT]));
  p.host({ type: "userMessage", workspace: "main", text: "hello main" });
  p.host({ type: "text", workspace: "wt:fix", delta: "reply in fix" });
  assert.match(p.visibleLog().textContent!, /hello main/);
  assert.match(p.doc.querySelector(".workspace")!.textContent!, /Main/);
  p.host(workspaces([MAIN, WT], "wt:fix"));
  assert.match(p.visibleLog().textContent!, /reply in fix/);
  assert.doesNotMatch(p.visibleLog().textContent!, /hello main/);
  assert.match(p.doc.querySelector(".workspace")!.textContent!, /fix/);
  assert.deepEqual(p.sent.at(-1), { type: "focus", workspace: "wt:fix" });
});

test("the workspace chip opens the host's workspace menu and flags another workspace that is waiting or running", () => {
  const p = loadPanel();
  p.host(workspaces([MAIN, WT]));
  const chip = p.doc.querySelector<HTMLButtonElement>(".workspace")!;
  assert.equal(chip.dataset.attention, "");
  p.host(workspaces([MAIN, { ...WT, running: true }]));
  assert.equal(chip.dataset.attention, "running");
  p.host(workspaces([MAIN, { ...WT, running: true, waiting: 1 }]));
  assert.equal(chip.dataset.attention, "waiting");
  assert.match(chip.getAttribute("aria-label")!, /waiting for approval/);
  chip.click();
  assert.deepEqual(p.sent.at(-1), { type: "pickWorkspace" });
});

test("the agent chip shows the workspace's agent, opens the host's agent menu, flags one that needs setup, and is locked while it runs", () => {
  const p = loadPanel();
  p.host(workspaces([MAIN, WT], "wt:fix"));
  const chip = p.doc.querySelector<HTMLButtonElement>(".harness")!;
  assert.equal(chip.textContent, "Claude Code");
  assert.equal(chip.classList.contains("not-ready"), false);
  chip.click();
  assert.deepEqual(p.sent.at(-1), { type: "pickHarness" });
  p.host(workspaces([MAIN, { ...WT, harness: "codex" }], "wt:fix"));
  assert.ok(chip.classList.contains("not-ready"));
  assert.match(chip.title, /codex login/);
  assert.match(chip.getAttribute("aria-label")!, /isn't logged in/);
  p.host(workspaces([MAIN, { ...WT, running: true }]));
  assert.equal(chip.disabled, true);
});

test("the model chip shows the Deep Agents model, opens the model menu, and hides for CLI agents", () => {
  const p = loadPanel();
  p.host(STATUS);
  p.host(workspaces([MAIN, WT]));
  const chip = p.doc.querySelector<HTMLButtonElement>(".model")!;
  assert.equal(chip.hidden, false);
  assert.equal(chip.textContent, "deepseek-flash");
  assert.match(chip.title, /deepseek · deepseek-flash/, "the provider is in the tooltip");
  chip.click();
  assert.deepEqual(p.sent.at(-1), { type: "pickModel" });
  p.host(workspaces([MAIN, WT], "wt:fix"));
  assert.equal(chip.hidden, true, "a CLI agent picks its own model");
});

test("approval cards show their workspace and detail; Approve, Reject, and View diff answer the host", () => {
  const p = loadPanel();
  p.host(workspaces([MAIN, WT]));
  p.host({ type: "approval", card: card("a1", "main", "Main", true) });
  const box = p.all(".card")[0];
  assert.equal(box.querySelector(".card-workspace")!.textContent, "Main");
  assert.equal(box.querySelector(".card-detail")!.textContent, "npm test");
  p.button("View diff", box)!.click();
  p.button("Approve", box)!.click();
  p.button("Reject", box)!.click();
  assert.deepEqual(p.sent.slice(-3), [
    { type: "showDiff", id: "a1" },
    { type: "answer", id: "a1", approved: true },
    { type: "answer", id: "a1", approved: false },
  ]);
  p.host({ type: "approvalClosed", id: "a1" });
  assert.equal(p.all(".card").length, 0);
});

test("a card for another workspace lands in that transcript, brings it forward, and the panel reports the switch", () => {
  const p = loadPanel();
  p.host(workspaces([MAIN, WT]));
  p.host({ type: "approval", card: card("b1", "wt:fix", "fix") });
  assert.match(p.doc.querySelector(".workspace")!.textContent!, /fix/);
  assert.equal(p.visibleLog().querySelectorAll(".card").length, 1);
  assert.equal(p.button("View diff"), undefined, "no diff button without a diff");
  assert.deepEqual(p.sent.at(-1), { type: "focus", workspace: "wt:fix" });
});

test("a reloaded panel restores every waiting card from the host's snapshot, without duplicates", () => {
  const p = loadPanel();
  p.host(workspaces([MAIN, WT]));
  p.host({ type: "snapshot", cards: [card("c1", "main", "Main"), card("c2", "wt:fix", "fix")] });
  p.host({ type: "snapshot", cards: [card("c1", "main", "Main")] });
  assert.deepEqual(p.all(".card").map((c) => c.querySelector(".card-workspace")!.textContent).sort(), ["Main", "fix"]);
});

test("the composer sends to the shown workspace; Enter sends, Shift+Enter does not; while running the same button stops", () => {
  const p = loadPanel();
  p.host(workspaces([MAIN, WT], "wt:fix"));
  const input = p.doc.querySelector<HTMLTextAreaElement>(".input")!;
  assert.equal(p.button("Send")!.disabled, true, "nothing to send yet");
  input.value = "  fix the login bug  ";
  input.dispatchEvent(new p.window.Event("input"));
  assert.equal(p.button("Send")!.disabled, false);
  input.dispatchEvent(new p.window.KeyboardEvent("keydown", { key: "Enter", shiftKey: true }));
  assert.notDeepEqual(p.sent.at(-1)?.type, "send");
  input.dispatchEvent(new p.window.KeyboardEvent("keydown", { key: "Enter" }));
  assert.deepEqual(p.sent.at(-1), { type: "send", workspace: "wt:fix", text: "fix the login bug" });
  assert.equal(input.value, "");
  p.host(workspaces([MAIN, { ...WT, running: true }]));
  assert.equal(p.button("Send"), undefined);
  p.button("Stop")!.click();
  assert.deepEqual(p.sent.at(-1), { type: "stop", workspace: "wt:fix" });
});

test("model, file, and page text is shown as text and never becomes HTML", () => {
  const p = loadPanel();
  p.host(workspaces([MAIN]));
  const evil = `<img src=x onerror="window.pwned=1"><script>window.pwned=2</script>`;
  p.host({ type: "text", workspace: "main", delta: evil });
  p.host({ type: "toolCall", workspace: "main", id: "t1", name: evil, args: evil });
  p.host({ type: "approval", card: { ...card("e1", "main", "Main"), title: evil, detail: evil } });
  p.host({ ...STATUS, provider: evil, model: evil, problem: evil } as HostToPanel);
  assert.equal(p.doc.querySelectorAll("img, script").length, 0);
  assert.equal((p.window as any).pwned, undefined);
  assert.ok(p.visibleLog().textContent!.includes(evil), "the literal text is shown");
});

test("a setup problem shows as a banner with working buttons on Deep Agents only; Restricted Mode shows Read-only", () => {
  const p = loadPanel();
  p.host(workspaces([MAIN, WT]));
  p.host({ type: "status", ready: false, problem: "No API key stored for anthropic.", provider: "anthropic", model: "", restricted: true });
  const banner = p.doc.querySelector<HTMLElement>(".banner")!;
  assert.equal(banner.hidden, false);
  assert.match(banner.textContent!, /No API key stored/);
  assert.match(p.doc.querySelector(".mode")!.textContent!, /Read-only/);
  p.button("Choose provider and model")!.click();
  p.button("Open settings")!.click();
  assert.deepEqual(p.sent.slice(-2), [{ type: "pickModel" }, { type: "openSettings" }]);
  p.host(workspaces([MAIN, WT], "wt:fix"));
  assert.equal(banner.hidden, true, "the Deep Agents key problem doesn't concern Claude Code");
});

test("notices, errors, and Stopped show in the right transcript; clearing one workspace leaves the other", () => {
  const p = loadPanel();
  p.host(workspaces([MAIN, WT]));
  p.host({ type: "userMessage", workspace: "main", text: "keep me" });
  p.host({ type: "notice", workspace: "wt:fix", text: "Settings changed: the next message starts a new conversation." });
  p.host({ type: "finished", workspace: "wt:fix", reason: "error", message: "Claude Code stopped (exit code 3)" });
  p.host({ type: "finished", workspace: "wt:fix", reason: "stopped" });
  p.host(workspaces([MAIN, WT], "wt:fix"));
  const fixText = p.visibleLog().textContent!;
  assert.match(fixText, /Settings changed/);
  assert.match(fixText, /exit code 3/);
  assert.match(fixText, /Stopped\./);
  p.host({ type: "cleared", workspace: "wt:fix" });
  assert.equal(p.visibleLog().textContent, "");
  p.host(workspaces([MAIN, WT], "main"));
  assert.match(p.visibleLog().textContent!, /keep me/);
});

test("a streamed reply renders as Markdown; links and Copy ask the host; the user's own message stays plain text", () => {
  const p = loadPanel();
  p.host(workspaces([MAIN]));
  p.host({ type: "userMessage", workspace: "main", text: "show **me** `code`" });
  for (const delta of ["Here is ", "**the fix**:\n\n```ts\nconst a", " = 1;\n```\n\nSee [docs](https://example.com)."]) p.host({ type: "text", workspace: "main", delta });
  const reply = p.doc.querySelector(".assistant")!;
  assert.equal(reply.querySelector("strong")!.textContent, "the fix");
  assert.equal(reply.querySelector(".md-code code")!.textContent, "const a = 1;");
  const user = p.doc.querySelector(".user")!;
  assert.equal(user.textContent, "show **me** `code`");
  assert.equal(user.querySelector("strong, code"), null);
  p.button("Copy code", reply)!.click();
  reply.querySelector<HTMLElement>("a")!.click();
  assert.deepEqual(p.sent.slice(-2), [{ type: "copy", text: "const a = 1;" }, { type: "openLink", url: "https://example.com/" }]);
});

test("each reply renders only its own text: a tool call, a finish, or a new message starts a fresh reply", () => {
  const p = loadPanel();
  p.host(workspaces([MAIN]));
  p.host({ type: "text", workspace: "main", delta: "```\nopen fence" });
  p.host({ type: "toolCall", workspace: "main", id: "t1", name: "read_file", args: "{}" });
  p.host({ type: "text", workspace: "main", delta: "after the tool" });
  p.host({ type: "finished", workspace: "main", reason: "done" });
  p.host({ type: "text", workspace: "main", delta: "next turn" });
  const replies = p.all(".assistant");
  assert.equal(replies.length, 3);
  assert.equal(replies[0].querySelector(".md-code code")!.textContent, "open fence");
  assert.deepEqual([replies[1].textContent, replies[2].textContent], ["after the tool", "next turn"], "the open fence did not swallow later replies");
});

test("re-rendering a long reply on every delta stays fast: 99% of deltas at 50 KB fit in one frame (16 ms), none freezes the panel (50 ms)", () => {
  const p = loadPanel();
  p.host(workspaces([MAIN]));
  const chunk = "Some **text** with `code`, a [link](https://example.com), and a list:\n\n- one\n- two\n\n```ts\nconst x = 1;\n```\n\n";
  const reply = chunk.repeat(Math.ceil(50_000 / chunk.length)).slice(0, 50_000);
  const size = Math.ceil(reply.length / 1000);
  const times: number[] = [];
  for (let i = 0; i < reply.length; i += size) {
    const started = performance.now();
    p.host({ type: "text", workspace: "main", delta: reply.slice(i, i + size) });
    times.push(performance.now() - started);
  }
  const total = times.reduce((a, b) => a + b, 0);
  // A single garbage-collection pause can land on any one delta, so judge the typical frame (99th
  // percentile) against the frame budget, and the worst delta against a visible freeze.
  const sorted = [...times].sort((a, b) => a - b);
  const p99 = sorted[Math.ceil(sorted.length * 0.99) - 1];
  const slowest = sorted.at(-1)!;
  console.log(`markdown render: 50 KB reply in ${times.length} deltas: total ${Math.round(total)} ms, 99th percentile ${p99.toFixed(1)} ms, slowest ${slowest.toFixed(1)} ms`);
  assert.ok(p99 < 16, `99th percentile delta took ${p99.toFixed(1)} ms`);
  assert.ok(slowest < 50, `slowest delta took ${slowest.toFixed(1)} ms`);
  assert.equal(p.doc.querySelectorAll(".assistant").length, 1);
  assert.equal(p.doc.querySelectorAll(".assistant .md-code").length, (reply.match(/```ts/g) ?? []).length, "every block rendered once");
});

const tick = (ms: number) => new Promise((r) => setTimeout(r, ms));
const type = (p: ReturnType<typeof loadPanel>, value: string) => {
  const input = p.doc.querySelector<HTMLTextAreaElement>(".input")!;
  input.value = value;
  input.selectionStart = input.selectionEnd = value.length;
  input.dispatchEvent(new p.window.Event("input"));
  return input;
};
const key = (p: ReturnType<typeof loadPanel>, k: string) => p.doc.querySelector(".input")!.dispatchEvent(new p.window.KeyboardEvent("keydown", { key: k, cancelable: true }));

test("+ opens the attachment menu; picked files and folders become highlighted @mentions in the text and go with the message", () => {
  const p = loadPanel();
  p.host(workspaces([MAIN]));
  p.button("Add files or folders")!.click();
  assert.deepEqual(p.sent.at(-1), { type: "pickAttachments" });
  const input = type(p, "fix");
  p.host({ type: "addAttachments", items: [{ path: "src/app.ts", kind: "file" }, { path: "docs", kind: "folder" }, { path: "src/app.ts", kind: "file" }] });
  assert.equal(input.value, "fix @src/app.ts @docs/ ", "duplicates are dropped");
  assert.deepEqual(p.all(".input-layer .mention").map((m) => m.textContent), ["@src/app.ts", "@docs/"]);
  assert.equal(p.all(".attachments .attachment").length, 0, "files are mentions, not chips");
  key(p, "Enter");
  assert.deepEqual(p.sent.at(-1), { type: "send", workspace: "main", text: "fix @src/app.ts @docs/", attachments: [{ path: "src/app.ts", kind: "file" }, { path: "docs", kind: "folder" }] });
  assert.equal(p.all(".input-layer .mention").length, 0);
  p.host({ type: "userMessage", workspace: "main", text: "fix @src/app.ts", attachments: [{ path: "src/app.ts", kind: "file" }] });
  assert.equal(p.visibleLog().querySelector(".user .attachment")!.textContent, "app.ts");
});

test("Backspace right after a mention removes all of it, and it's no longer attached; a typed @word that wasn't picked isn't a mention", () => {
  const p = loadPanel();
  p.host(workspaces([MAIN]));
  const input = type(p, "see");
  p.host({ type: "addAttachments", items: [{ path: "src/app.ts", kind: "file" }] });
  assert.equal(input.value, "see @src/app.ts ");
  key(p, "Backspace");
  assert.equal(input.value, "see ");
  type(p, "see @notpicked please");
  assert.equal(p.all(".input-layer .mention").length, 0);
  key(p, "Enter");
  assert.deepEqual(p.sent.at(-1), { type: "send", workspace: "main", text: "see @notpicked please" });
});

test("the file open in the editor is offered as a dashed suggestion until it's mentioned", () => {
  const p = loadPanel();
  p.host(workspaces([MAIN]));
  const chip = p.doc.querySelector<HTMLButtonElement>(".suggest-file")!;
  assert.equal(chip.hidden, true);
  p.host({ type: "activeFile", path: "src/hooks/useRewards.ts" });
  assert.equal(chip.hidden, false);
  assert.equal(chip.textContent, "TSuseRewards.ts");
  assert.match(chip.title, /src\/hooks\/useRewards\.ts/);
  chip.click();
  assert.equal(p.doc.querySelector<HTMLTextAreaElement>(".input")!.value, "@src/hooks/useRewards.ts ");
  assert.equal(chip.hidden, true);
  p.host({ type: "activeFile" });
  assert.equal(chip.hidden, true);
});

test("text typed into the composer is drawn as text by the highlight layer, never as HTML", () => {
  const p = loadPanel();
  p.host(workspaces([MAIN]));
  type(p, `<img src=x onerror="window.pwned=1"> @x`);
  assert.equal(p.doc.querySelectorAll(".input-layer img").length, 0);
  assert.equal(p.doc.querySelector(".input-layer")!.textContent, `<img src=x onerror="window.pwned=1"> @x`);
  assert.equal((p.window as any).pwned, undefined);
});

test("@ searches workspace paths through the host; arrow keys and Enter insert the mention without sending", async () => {
  const p = loadPanel();
  p.host(workspaces([MAIN]));
  const input = type(p, "look at @src/ap");
  await tick(160);
  assert.deepEqual(p.sent.at(-1), { type: "searchFiles", query: "src/ap" });
  p.host({ type: "fileMatches", query: "src/ap", items: [{ path: "src/app.ts", kind: "file" }, { path: "src/api", kind: "folder" }] });
  assert.deepEqual(p.all(".suggestion .suggestion-label").map((s) => s.textContent), ["src/app.ts", "src/api/"]);
  key(p, "ArrowDown");
  key(p, "Enter");
  assert.equal(input.value, "look at @src/api/ ");
  assert.deepEqual(p.all(".input-layer .mention").map((m) => m.textContent), ["@src/api/"]);
  assert.ok(!p.sent.some((m) => m.type === "send"), "Enter picked the suggestion; nothing was sent");
  p.host({ type: "fileMatches", query: "stale", items: [{ path: "old.ts", kind: "file" }] });
  assert.equal(p.doc.querySelector<HTMLElement>(".popover")!.hidden, true, "answers to old queries are ignored");
});

test("/ lists skills for the YourStack agent and completes the name; Escape closes the list", () => {
  const p = loadPanel();
  p.host(workspaces([MAIN, WT]));
  p.host({ type: "skills", items: [{ name: "deploy", description: "Deploy the service" }, { name: "db-migrate", description: "Run migrations" }] });
  const input = type(p, "/d");
  assert.deepEqual(p.all(".suggestion .suggestion-label").map((s) => s.textContent), ["/deploy", "/db-migrate"]);
  key(p, "Enter");
  assert.equal(input.value, "/deploy ");
  type(p, "/d");
  key(p, "Escape");
  assert.equal(p.doc.querySelector<HTMLElement>(".popover")!.hidden, true);
  p.host(workspaces([MAIN, WT], "wt:fix"));
  type(p, "/d");
  assert.equal(p.doc.querySelector<HTMLElement>(".popover")!.hidden, true, "CLI agents have their own slash commands");
});

test("files dropped on the panel are sent to the host to check and attach", () => {
  const p = loadPanel();
  p.host(workspaces([MAIN]));
  const drop = new p.window.Event("drop", { bubbles: true, cancelable: true }) as any;
  drop.dataTransfer = { getData: (t: string) => (t === "text/uri-list" ? "file:///ws/src/app.ts\r\n# comment\r\nfile:///ws/docs\r\n" : "") };
  p.doc.getElementById("app")!.dispatchEvent(drop);
  assert.deepEqual(p.sent.at(-1), { type: "dropUris", uris: ["file:///ws/src/app.ts", "file:///ws/docs"] });
});

test("a message with a checkpoint offers Restore, which asks the host; a restored message's text returns to the composer", () => {
  const p = loadPanel();
  p.host(workspaces([MAIN]));
  p.host({ type: "userMessage", workspace: "main", text: "with checkpoint", id: "m1", checkpoint: "abc123", turn: 0 });
  p.host({ type: "userMessage", workspace: "main", text: "no checkpoint (Restricted Mode)", id: "m2", turn: 1 });
  const bubbles = p.all(".user");
  assert.equal(bubbles[1].querySelector(".restore"), null);
  p.button("Restore checkpoint", bubbles[0])!.click();
  assert.deepEqual(p.sent.at(-1), { type: "restore", workspace: "main", messageId: "m1" });
  p.host({ type: "setInput", workspace: "main", text: "with checkpoint" });
  assert.equal(p.doc.querySelector<HTMLTextAreaElement>(".input")!.value, "with checkpoint");
});

test("each message offers Fork from here; text attachments show their label", () => {
  const p = loadPanel();
  p.host(workspaces([MAIN]));
  p.host({ type: "userMessage", workspace: "main", text: "plan it", id: "m1", turn: 0 });
  p.button("Fork from here", p.all(".user")[0])!.click();
  assert.deepEqual(p.sent.at(-1), { type: "fork", workspace: "main", messageId: "m1" });
  p.host({ type: "addAttachments", items: [{ kind: "text", path: "Issue #7", text: "Login loops" }] });
  assert.equal(p.doc.querySelector(".attachments .attachment .chip-text")!.textContent, "Issue #7");
});

test("sequential-thinking steps show as numbered thought rows (revisions and branches labeled), as text, without their JSON reply", () => {
  const p = loadPanel();
  p.host(workspaces([MAIN]));
  p.host({ type: "toolCall", workspace: "main", id: "t1", name: "sequential_thinking", args: JSON.stringify({ thought: "List the <b>auth</b> paths", thoughtNumber: 1, totalThoughts: 3, nextThoughtNeeded: true }) });
  p.host({ type: "toolResult", workspace: "main", id: "t1", name: "sequential_thinking", output: '{"thoughtNumber":1}' });
  p.host({ type: "toolCall", workspace: "main", id: "t2", name: "sequential_thinking", args: JSON.stringify({ thought: "Actually the cookie", thoughtNumber: 2, totalThoughts: 3, isRevision: true, revisesThought: 1, nextThoughtNeeded: true }) });
  p.host({ type: "toolCall", workspace: "main", id: "t3", name: "sequential_thinking", args: JSON.stringify({ thought: "Try a header", thoughtNumber: 3, totalThoughts: 4, branchFromThought: 2, branchId: "alt", nextThoughtNeeded: false }) });
  assert.deepEqual(p.all(".thought .thought-head").map((h) => h.textContent), ["Thought 1/3", "Revision 2/3 (of thought 1)", "Branch 3/4 (from thought 2, alt)"]);
  assert.equal(p.all(".thought .thought-text")[0].textContent, "List the <b>auth</b> paths");
  assert.equal(p.doc.querySelectorAll(".thought b, .thought .result").length, 0);
});

test("a delegated subagent gets its own row; its text streams there as Markdown, not into the main reply", () => {
  const p = loadPanel();
  p.host(workspaces([MAIN]));
  p.host({ type: "toolCall", workspace: "main", id: "task1", name: "task", args: JSON.stringify({ subagent_type: "explorer", description: "find the login code" }) });
  p.host({ type: "toolCall", workspace: "main", id: "e1", name: "explorer > grep", args: "{}" });
  p.host({ type: "subagentText", workspace: "main", id: "task1", delta: "Found it in " });
  p.host({ type: "subagentText", workspace: "main", id: "task1", delta: "`src/auth.ts`." });
  p.host({ type: "text", workspace: "main", delta: "Main answer." });
  const row = p.doc.querySelector<HTMLDetailsElement>(".tool.subagent")!;
  assert.equal(row.open, true);
  assert.equal(row.querySelector(".tool-name")!.textContent, "Subagent: explorer");
  assert.equal(row.querySelector(".tool-detail")!.textContent, "find the login code");
  assert.equal(row.querySelector(".subagent-output code")!.textContent, "src/auth.ts");
  assert.equal(p.doc.querySelector(".assistant")!.textContent, "Main answer.");
  assert.equal(row.querySelector(".subagent-steps .tool .tool-name")!.textContent, "explorer > grep", "its own tool calls are inside its row");
});

test("the jobs chip appears with background jobs and opens the jobs menu", () => {
  const p = loadPanel();
  p.host(workspaces([MAIN]));
  const chip = p.doc.querySelector<HTMLButtonElement>(".jobs")!;
  assert.equal(chip.hidden, true);
  p.host({ type: "jobs", workspace: "main", running: 2, total: 3 });
  assert.equal(chip.hidden, false);
  assert.equal(chip.textContent, "2 jobs running");
  chip.click();
  assert.deepEqual(p.sent.at(-1), { type: "pickJob" });
  p.host({ type: "jobs", workspace: "main", running: 0, total: 1 });
  assert.equal(chip.textContent, "1 job done");
});

test("send options: Cmd/Ctrl+Enter queues, Option/Alt+Cmd/Ctrl+Enter sends in a forked session, Enter while running still sends (the host queues it)", () => {
  const p = loadPanel();
  p.host(workspaces([MAIN]));
  const input = p.doc.querySelector<HTMLTextAreaElement>(".input")!;
  const type = (text: string) => {
    input.value = text;
    input.dispatchEvent(new p.window.Event("input"));
  };
  type("later please");
  input.dispatchEvent(new p.window.KeyboardEvent("keydown", { key: "Enter", ctrlKey: true }));
  assert.deepEqual(p.sent.at(-1), { type: "send", workspace: "main", text: "later please", mode: "queue" });
  type("try another way");
  input.dispatchEvent(new p.window.KeyboardEvent("keydown", { key: "Enter", metaKey: true, altKey: true }));
  assert.deepEqual(p.sent.at(-1), { type: "send", workspace: "main", text: "try another way", mode: "fork" });
  p.host(workspaces([{ ...MAIN, running: true }]));
  type("and then this");
  input.dispatchEvent(new p.window.KeyboardEvent("keydown", { key: "Enter" }));
  assert.deepEqual(p.sent.at(-1), { type: "send", workspace: "main", text: "and then this" });
  type("fork while running");
  const before = p.sent.length;
  input.dispatchEvent(new p.window.KeyboardEvent("keydown", { key: "Enter", ctrlKey: true, altKey: true }));
  assert.equal(p.sent.length, before, "a fork waits for Stop");
  assert.equal(input.value, "fork while running", "and the text stays");
});

test("send options: the menu lists the three actions with shortcuts; forking is disabled while running; picking one sends with that mode", () => {
  const p = loadPanel();
  p.host(workspaces([MAIN]));
  const input = p.doc.querySelector<HTMLTextAreaElement>(".input")!;
  const menu = p.doc.querySelector<HTMLElement>(".send-menu")!;
  assert.equal(menu.hidden, true);
  p.button("More send options")!.click();
  assert.equal(menu.hidden, false);
  const options = p.all(".send-option");
  assert.deepEqual(options.map((o) => o.querySelector(".send-option-label")!.textContent), ["Send", "Queue for later", "Send in a forked session"]);
  assert.ok(options.every((o) => o.querySelector("kbd")!.textContent!.length > 0), "each shows its shortcut");
  assert.ok(options.every((o) => (o as HTMLButtonElement).disabled), "nothing to send yet");
  p.doc.body.click();
  assert.equal(menu.hidden, true, "a click elsewhere closes it");
  input.value = "fork this";
  input.dispatchEvent(new p.window.Event("input"));
  p.button("More send options")!.click();
  (options[2] as HTMLButtonElement).click();
  assert.deepEqual(p.sent.at(-1), { type: "send", workspace: "main", text: "fork this", mode: "fork" });
  assert.equal(menu.hidden, true);
  p.host(workspaces([{ ...MAIN, running: true }]));
  input.value = "x";
  input.dispatchEvent(new p.window.Event("input"));
  assert.deepEqual(options.map((o) => (o as HTMLButtonElement).disabled), [false, false, true]);
});

test("send options: queued messages show above the input with Remove; Send now appears once the queue has paused", () => {
  const p = loadPanel();
  const queue = [{ id: "q1", text: "next step", attachments: 0 }, { id: "q2", text: "<b>then</b> this", attachments: 2 }];
  p.host(workspaces([{ ...MAIN, running: true, queue }]));
  const list = p.doc.querySelector<HTMLElement>(".queue")!;
  assert.equal(list.hidden, false);
  assert.match(list.textContent!, /Queued \(2\): sends when the agent finishes/);
  assert.deepEqual(p.all(".queued-text").map((t) => t.textContent), ["next step", "<b>then</b> this"]);
  assert.equal(p.doc.querySelectorAll(".queue b").length, 0, "queued text stays text");
  assert.equal(p.all(".queued-badge")[0].textContent, "+2");
  assert.equal(p.button("Send now"), undefined, "while it runs, queued messages just wait");
  p.button("Remove from queue", p.all(".queued")[1])!.click();
  assert.deepEqual(p.sent.at(-1), { type: "unqueue", workspace: "main", id: "q2" });
  p.host(workspaces([{ ...MAIN, queue: [queue[0]], queuePaused: true }]));
  assert.match(list.textContent!, /paused/);
  p.button("Send now")!.click();
  assert.deepEqual(p.sent.at(-1), { type: "sendQueued", workspace: "main", id: "q1" });
  p.host(workspaces([MAIN]));
  assert.equal(list.hidden, true);
});

test("a message put back after a failed send gets its attachments back: mentions already in the text are recognized, not duplicated", () => {
  const p = loadPanel();
  p.host(workspaces([MAIN]));
  const input = p.doc.querySelector<HTMLTextAreaElement>(".input")!;
  const file = { path: "src/app.ts", kind: "file" as const };
  const issue = { path: "Issue #7", kind: "text" as const, text: "Login loops" };
  p.host({ type: "setInput", workspace: "main", text: "fix @src/app.ts please" });
  p.host({ type: "addAttachments", items: [file, issue] });
  assert.equal(input.value, "fix @src/app.ts please", "not inserted a second time");
  assert.equal(p.doc.querySelectorAll(".input-layer .mention").length, 1, "highlighted as a mention");
  input.dispatchEvent(new p.window.KeyboardEvent("keydown", { key: "Enter" }));
  assert.deepEqual(p.sent.at(-1), { type: "send", workspace: "main", text: "fix @src/app.ts please", attachments: [file, issue] });
});

test("with no folder to work in, the panel says why and offers Open Folder instead of staying blank", () => {
  const p = loadPanel();
  p.host({ type: "workspaces", items: [], harnesses: HARNESSES, problem: "Open a folder to use YourStack." });
  const empty = p.doc.querySelector<HTMLElement>(".empty")!;
  assert.equal(empty.hidden, false);
  assert.match(empty.textContent!, /Open a folder to use YourStack\./);
  assert.equal(p.doc.querySelector<HTMLTextAreaElement>(".input")!.disabled, true);
  p.button("Open Folder")!.click();
  assert.deepEqual(p.sent.at(-1), { type: "openFolder" });
  p.host(workspaces([MAIN]));
  assert.equal(p.button("Open Folder")!.hidden, true, "gone once a folder is open");
  assert.match(empty.textContent!, /Deep Agents asks before every edit/);
});

test("permission modes: the mode chip shows the current mode and opens a menu of only the agent's modes; picking one sends it", () => {
  const p = loadPanel();
  const modes = [
    { id: "ask", label: "Ask before edits", icon: "shield", description: "Asks before every edit." },
    { id: "acceptEdits", label: "Edit automatically", icon: "pencil", description: "Edits without asking." },
    { id: "plan", label: "Plan mode", icon: "bulb", description: "Plans only." },
  ];
  p.host(STATUS);
  p.host(workspaces([{ ...MAIN, mode: "ask", modes }]));
  const chip = p.doc.querySelector<HTMLButtonElement>(".footer .mode")!;
  assert.match(chip.textContent!, /Ask before edits/);
  assert.equal(chip.disabled, false);
  const menu = p.doc.querySelector<HTMLElement>(".mode-menu")!;
  assert.equal(menu.hidden, true);
  chip.click();
  assert.equal(menu.hidden, false);
  const options = p.all(".mode-option");
  assert.deepEqual(options.map((o) => o.querySelector(".mode-option-label")!.textContent), ["Ask before edits", "Edit automatically", "Plan mode"]);
  assert.match(options[1].textContent!, /Edits without asking\./, "each mode says what it means");
  assert.equal(options[0].getAttribute("aria-checked"), "true");
  options[2].click();
  assert.deepEqual(p.sent.at(-1), { type: "setMode", workspace: "main", mode: "plan" });
  assert.equal(menu.hidden, true);
  p.host(workspaces([{ ...MAIN, mode: "plan", modes }]));
  assert.match(chip.textContent!, /Plan mode/);
});

test("permission modes: Restricted Mode shows Read-only and no menu; an agent with one mode has nothing to choose", () => {
  const p = loadPanel();
  p.host({ ...STATUS, restricted: true } as HostToPanel);
  p.host(workspaces([{ ...MAIN, mode: "ask", modes: [{ id: "ask", label: "Ask before edits", icon: "shield", description: "x" }, { id: "plan", label: "Plan mode", icon: "bulb", description: "y" }] }]));
  const chip = p.doc.querySelector<HTMLButtonElement>(".footer .mode")!;
  assert.match(chip.textContent!, /Read-only/);
  assert.equal(chip.disabled, true);
  p.host(STATUS);
  p.host(workspaces([{ ...MAIN, mode: "ask", modes: [{ id: "ask", label: "Ask before edits", icon: "shield", description: "x" }] }]));
  assert.equal(chip.disabled, true);
});
