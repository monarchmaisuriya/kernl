// Click-through tests for the panel webview. The built out/webview/main.js runs in jsdom with a
// fake VS Code bridge: tests send host messages, click real elements, and check what the panel
// sends back. Covers the empty state, transcripts, the workspace and model chips, the agent picker,
// the composer's send/stop button, approval cards, snapshot restore, the setup banner, and that
// untrusted text never becomes HTML.
import { strict as assert } from "node:assert";
import { HOVER_OPEN_MS } from "../../src/webview/sendMenu";
import { readFileSync } from "node:fs";
import { resolve } from "node:path";
import { after, test } from "node:test";
import { JSDOM } from "jsdom";
import type { HarnessView, HostToPanel, PanelToHost, WorkspaceView } from "../../src/ui/protocol";

const script = readFileSync(resolve(__dirname, "../webview/main.js"), "utf8");

// Each panel's window is closed at the end, which stops its timers (a running tool row ticks every second).
const windows: { close(): void }[] = [];
after(() => windows.forEach((w) => w.close()));

function loadPanel() {
  const dom = new JSDOM(`<!DOCTYPE html><body><div id="app"></div></body>`, { runScripts: "outside-only" });
  windows.push(dom.window);
  const { window } = dom;
  const sent: PanelToHost[] = [];
  // Like the real webview bridge, messages are serialized on the way out (and leave jsdom's realm).
  (window as any).acquireVsCodeApi = () => ({ postMessage: (m: PanelToHost) => sent.push(JSON.parse(JSON.stringify(m))) });
  // jsdom has no layout, so no scrollIntoView (the Connections view scrolls a focused row into view).
  (window as any).Element.prototype.scrollIntoView = () => {};
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
const WT: WorkspaceView = { id: "wt:fix", label: "fix", harness: "claude-code", branch: "kernl/fix", running: false, waiting: 0, disclosure: "Claude Code runs approved actions itself.", queue: [], queuePaused: false, mode: "ask", modes: [], forkLimit: "Claude Code can fork only from the last message" };
const STATUS: HostToPanel = { type: "status", ready: true, provider: "deepseek", model: "deepseek-flash", restricted: false, thinkingDisplay: "auto" };
const HARNESSES: HarnessView[] = [
  { id: "deepagents", label: "kernl", group: "kernl", ready: true },
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

test("the panel tells the host when it gains and loses keyboard focus (kernl puts focus back there after showing its browser tab)", () => {
  const p = loadPanel();
  p.window.dispatchEvent(new p.window.FocusEvent("focus"));
  p.window.dispatchEvent(new p.window.FocusEvent("blur"));
  assert.deepEqual(p.sent.slice(1), [{ type: "keyboardFocus", inPanel: true }, { type: "keyboardFocus", inPanel: false }]);
});

test("an empty workspace shows the empty state with its agent's disclosure, until the first message", () => {
  const p = loadPanel();
  p.host(workspaces([MAIN, WT], "wt:fix"));
  const empty = p.doc.querySelector<HTMLElement>(".empty")!;
  assert.equal(empty.hidden, false);
  assert.match(empty.textContent!, /Build with kernl/);
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

test("a CLI agent's own model, thinking, and fast mode are chips: model and thinking open its choices, fast toggles; all wait while it runs", () => {
  const p = loadPanel();
  p.host(STATUS);
  const agentOptions: WorkspaceView["agentOptions"] = [
    { id: "model", name: "Model", kind: "model", type: "select", value: "opus[1m]", choices: [{ value: "opus", name: "Opus" }, { value: "opus[1m]", name: "Opus", description: "1M context" }] },
    { id: "effort", name: "Effort", kind: "thinking", type: "select", value: "high", choices: [{ value: "high", name: "High" }] },
    { id: "fast", name: "Fast mode", kind: "fast", type: "boolean", value: false },
  ];
  p.host(workspaces([MAIN, { ...WT, agentOptions }], "wt:fix"));
  const model = p.doc.querySelector<HTMLButtonElement>(".model")!;
  const thinking = p.doc.querySelector<HTMLButtonElement>(".chip.reasoning")!;
  const fast = p.doc.querySelector<HTMLButtonElement>(".chip.fast")!;
  assert.deepEqual([model.hidden, thinking.hidden, fast.hidden], [false, false, false]);
  assert.deepEqual([model.textContent, thinking.textContent, fast.textContent], ["Opus", "High", "Fast"]);
  assert.ok([model, thinking, fast].every((c) => c.firstElementChild?.classList.contains("icon")), "each chip leads with an icon");
  assert.match(thinking.getAttribute("aria-label")!, /^Thinking: High/, "the full label stays for screen readers");
  assert.equal(fast.querySelector("path")!.getAttribute("fill"), null, "an outline bolt when off");
  model.click();
  thinking.click();
  fast.click();
  assert.deepEqual(p.sent.slice(-3), [
    { type: "pickAgentOption", workspace: "wt:fix", id: "model" },
    { type: "pickAgentOption", workspace: "wt:fix", id: "effort" },
    { type: "setAgentOption", workspace: "wt:fix", id: "fast", value: true },
  ]);
  p.host(workspaces([MAIN, { ...WT, agentOptions: [agentOptions[0], { ...agentOptions[2], value: true }], running: true }], "wt:fix"));
  assert.equal(fast.textContent, "Fast");
  assert.equal(fast.querySelector("path")!.getAttribute("fill"), "currentColor", "a filled bolt when on");
  assert.equal(fast.getAttribute("aria-pressed"), "true");
  assert.equal(thinking.hidden, true, "no thinking option, no chip");
  assert.deepEqual([model.disabled, fast.disabled], [true, true]);
  p.host(workspaces([MAIN, WT], "wt:fix"));
  assert.deepEqual([model.hidden, thinking.hidden, fast.hidden], [true, true, true], "an agent that reported nothing yet shows no chips");
});

test("the thinking chip shows the model's thinking level, opens its menu, and hides without a thinking control or for CLI agents", () => {
  const p = loadPanel();
  p.host({ ...STATUS, provider: "anthropic", model: "claude-x", thinking: "medium" });
  p.host(workspaces([MAIN, WT]));
  const chip = p.doc.querySelector<HTMLButtonElement>(".chip.reasoning")!;
  assert.equal(chip.hidden, false);
  assert.equal(chip.textContent, "Medium");
  assert.match(chip.getAttribute("aria-label")!, /Change how much claude-x thinks/);
  chip.click();
  assert.deepEqual(p.sent.at(-1), { type: "pickThinking" });
  p.host({ ...STATUS, provider: "anthropic", model: "claude-x", thinking: "off" });
  assert.equal(chip.textContent, "Off");
  p.host(STATUS);
  assert.equal(chip.hidden, true, "deepseek has no thinking control");
  p.host({ ...STATUS, thinking: "low" });
  p.host(workspaces([MAIN, WT], "wt:fix"));
  assert.equal(chip.hidden, true, "a CLI agent has its own");
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
  p.host({ type: "status", ready: false, problem: "No API key stored for anthropic.", provider: "anthropic", model: "", restricted: true, thinkingDisplay: "auto" });
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

test("@ also finds conversations from any agent and workspace; a picked one becomes a chip (no @text) and is sent as a thread", async () => {
  const p = loadPanel();
  p.host(workspaces([MAIN]));
  const input = type(p, "use what we found in @log");
  await tick(160);
  assert.deepEqual(p.sent.at(-1), { type: "searchFiles", query: "log" });
  const thread = { workspaceKey: "k1", id: "c1", agent: "Claude Code", workspace: "Develop", updatedAt: Date.now() - 2 * 3600_000 };
  p.host({ type: "fileMatches", query: "log", items: [{ path: "Fix login loop", kind: "thread", thread }, { path: "src/login.ts", kind: "file" }] });
  assert.deepEqual(p.all(".suggestion .suggestion-label").map((s) => s.textContent), ["Fix login loop", "src/login.ts"]);
  assert.equal(p.all(".suggestion .suggestion-detail")[0].textContent, "Claude Code · Develop · 2 h ago");
  key(p, "Enter");
  assert.equal(input.value, "use what we found in ", "the @query typed for it is gone");
  assert.deepEqual(p.all(".attachments .chip-text").map((c) => c.textContent), ["Fix login loop"]);
  assert.match(p.doc.querySelector<HTMLElement>(".attachments .attachment")!.title, /^Conversation: Fix login loop \(Claude Code · Develop · 2 h ago\)$/);
  key(p, "Enter");
  const sent = p.sent.find((m) => m.type === "send") as any;
  assert.deepEqual(sent.attachments, [{ path: "Fix login loop", kind: "thread", thread }]);
});

const conversationRowsFor = (pending: boolean, agentRows: boolean) => [
  { kind: "new", title: "New conversation" },
  { kind: "kernl", id: "a", title: "Fix login", detail: "3 messages · Claude Code · 2 h ago", current: false, group: "Conversations" },
  { kind: "kernl", id: "b", title: "Refactor", detail: "1 message · kernl · 5 min ago", current: true, group: "Conversations" },
  ...(agentRows ? [{ kind: "agent", agent: "claude-code", sessionId: "s2", title: "Old idea", detail: "Claude Code session · 3 d ago", group: "Claude Code sessions not opened in kernl" }] : []),
  ...(pending ? [{ kind: "pending", agent: "claude-code", title: "Looking for Claude Code sessions…", group: "Claude Code sessions not opened in kernl" }] : []),
];

test("Conversations view: covers the panel with the workspace's conversations at once; an agent's sessions fill in later, keeping the search", () => {
  const p = loadPanel();
  p.host(workspaces([MAIN]));
  const view = p.doc.querySelector<HTMLElement>(".conversations")!;
  assert.equal(view.hidden, true);
  p.host({ type: "conversations", workspace: "main", title: "Conversations in Main", rows: conversationRowsFor(true, false) as any, open: true });
  assert.equal(view.hidden, false);
  assert.equal(view.querySelector(".panel-view-title")!.textContent, "Conversations in Main");
  assert.equal(p.doc.activeElement, view.querySelector(".conversations-search"), "the search box has focus");
  const titles = () => [...view.querySelectorAll(".conversation-title, .conversation-pending, .panel-view-group-title")].map((e) => e.textContent);
  assert.deepEqual(titles(), ["New conversation", "Conversations", "Fix login", "Refactor", "Claude Code sessions not opened in kernl", "Looking for Claude Code sessions…"]);
  assert.equal(view.querySelector('.conversation[aria-current="true"] .conversation-title')!.textContent, "Refactor");
  const search = view.querySelector<HTMLInputElement>(".conversations-search")!;
  search.value = "idea";
  search.dispatchEvent(new p.window.Event("input"));
  p.host({ type: "conversations", workspace: "main", title: "Conversations in Main", rows: conversationRowsFor(false, true) as any });
  assert.equal(search.value, "idea", "an update keeps the search");
  assert.deepEqual(titles(), ["New conversation", "Claude Code sessions not opened in kernl", "Old idea"]);
});

test("Conversations view: a picked row opens it and closes the view; Back and Escape close it with nothing sent", () => {
  const p = loadPanel();
  p.host(workspaces([MAIN]));
  const open = () => p.host({ type: "conversations", workspace: "main", title: "Conversations in Main", rows: conversationRowsFor(false, true) as any, open: true });
  const view = p.doc.querySelector<HTMLElement>(".conversations")!;
  const row = (title: string) => [...view.querySelectorAll<HTMLButtonElement>(".conversation")].find((b) => b.querySelector(".conversation-title")!.textContent === title)!;
  open();
  row("Fix login").click();
  assert.deepEqual(p.sent.at(-1), { type: "openConversation", workspace: "main", pick: { kind: "kernl", id: "a" } });
  assert.equal(view.hidden, true);
  open();
  row("Old idea").click();
  assert.deepEqual(p.sent.at(-1), { type: "openConversation", workspace: "main", pick: { kind: "agent", agent: "claude-code", sessionId: "s2" } });
  open();
  row("New conversation").click();
  assert.deepEqual(p.sent.at(-1), { type: "openConversation", workspace: "main", pick: { kind: "new" } });
  const before = p.sent.length;
  open();
  view.querySelector<HTMLButtonElement>(".conversations-back")!.click();
  assert.equal(view.hidden, true);
  assert.equal(p.doc.activeElement, p.doc.querySelector(".input"), "focus goes back to the message box");
  open();
  view.dispatchEvent(new p.window.KeyboardEvent("keydown", { key: "Escape", bubbles: true }));
  assert.equal(view.hidden, true);
  assert.equal(p.sent.length, before, "Back and Escape send nothing");
});

test("/ lists skills for the kernl agent and completes the name; Escape closes the list", () => {
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

test("/ lists kernl's own commands for every agent; choosing or typing one runs it instead of sending; the agent's command wins a clash", () => {
  const p = loadPanel();
  const modes = [{ id: "ask", label: "Ask before edits", icon: "shield", description: "x" }, { id: "plan", label: "Plan mode", icon: "bulb", description: "y" }];
  p.host(STATUS);
  p.host(workspaces([{ ...MAIN, modes }, WT]));
  p.host({ type: "skills", items: [{ name: "connect-db", description: "Connect the database" }] });
  const labels = () => p.all(".suggestion .suggestion-label").map((s) => s.textContent);
  const sends = () => p.sent.filter((m) => m.type === "send");

  // kernl's agent: kernl's commands, then its skills; /close is left out on the first tab.
  let input = type(p, "/c");
  assert.deepEqual(labels(), ["/new", "/conversations", "/connections", "/connect-db"]);
  assert.equal(p.all(".suggestion .suggestion-detail")[0].textContent, "New chat in this tab · kernl");
  key(p, "Enter");
  assert.deepEqual(p.sent.at(-1), { type: "runCommand", name: "new" });
  assert.equal(input.value, "");

  // Tab only completes a kernl command's name; Enter then runs it.
  input = type(p, "/ta");
  key(p, "Tab");
  assert.equal(input.value, "/tab ");
  assert.ok(!p.sent.some((m) => m.type === "runCommand" && m.name === "tab"), "Tab doesn't run it");
  key(p, "Enter");
  assert.deepEqual(p.sent.at(-1), { type: "runCommand", name: "tab" });
  assert.equal(input.value, "");

  // The host runs every command; /mode comes back as a request to open the mode chip's menu.
  type(p, "/mode");
  key(p, "Enter");
  assert.deepEqual(p.sent.at(-1), { type: "runCommand", name: "mode" });
  p.host({ type: "openModeMenu", workspace: "main" });
  assert.equal(p.doc.querySelector<HTMLElement>(".mode-menu")!.hidden, false, "the mode chip's menu opens");
  type(p, "/help");
  key(p, "Enter");
  assert.deepEqual(p.sent.at(-1), { type: "runCommand", name: "help" });

  // Typed in full with text after it: a note, and the text stays.
  input = type(p, "/new fix it");
  key(p, "Enter");
  assert.equal(input.value, "/new fix it");
  assert.equal(p.visibleLog().lastElementChild!.textContent, "/new takes nothing after it.");

  // A CLI agent that offers /resume: "/res" lists only the agent's, which is sent as text; /kernl:resume reaches kernl.
  p.host({ type: "commands", workspace: "wt:fix", items: [{ name: "resume", description: "Resume a session" }, { name: "review", description: "Review the changes", hint: "[instructions]" }] });
  p.host(workspaces([{ ...MAIN, modes }, WT], "wt:fix"));
  type(p, "/rev");
  assert.deepEqual(labels(), ["/review"]);
  assert.equal(p.all(".suggestion .suggestion-hint")[0].textContent, "[instructions]", "what the agent's command takes");
  input = type(p, "/res");
  assert.deepEqual(labels(), ["/resume"]);
  key(p, "Enter");
  assert.equal(input.value, "/resume ");
  key(p, "Enter");
  assert.equal(sends().at(-1)?.text, "/resume");
  type(p, "/kernl:resume");
  key(p, "Enter");
  assert.deepEqual(p.sent.at(-1), { type: "runCommand", name: "conversations" });
  assert.equal(sends().length, 1, "only the agent's command was sent");
});

test("files dropped on the panel are sent to the host to check and attach", () => {
  const p = loadPanel();
  p.host(workspaces([MAIN]));
  const drop = new p.window.Event("drop", { bubbles: true, cancelable: true }) as any;
  drop.dataTransfer = { getData: (t: string) => (t === "text/uri-list" ? "file:///ws/src/app.ts\r\n# comment\r\nfile:///ws/docs\r\n" : ""), types: ["text/uri-list"], files: [] };
  p.doc.getElementById("app")!.dispatchEvent(drop);
  assert.deepEqual(p.sent.at(-1), { type: "dropUris", uris: ["file:///ws/src/app.ts", "file:///ws/docs"] });
});

test("a message with a checkpoint offers Restore, which asks the host; a restored message's text returns to the composer", () => {
  const p = loadPanel();
  p.host(workspaces([MAIN]));
  p.host({ type: "userMessage", workspace: "main", text: "with checkpoint", id: "m1", checkpoint: "abc123", turn: 0 });
  p.host({ type: "userMessage", workspace: "main", text: "no checkpoint (Restricted Mode)", id: "m2", turn: 1 });
  const messages = p.all(".user-message");
  assert.equal(messages[1].querySelector(".restore"), null);
  p.button("Restore checkpoint", messages[0])!.click();
  assert.deepEqual(p.sent.at(-1), { type: "restore", workspace: "main", messageId: "m1" });
  p.host({ type: "setInput", workspace: "main", text: "with checkpoint" });
  assert.equal(p.doc.querySelector<HTMLTextAreaElement>(".input")!.value, "with checkpoint");
});

test("each message offers Fork from here; text attachments show their label", () => {
  const p = loadPanel();
  p.host(workspaces([MAIN]));
  p.host({ type: "userMessage", workspace: "main", text: "plan it", id: "m1", turn: 0 });
  p.button("Fork from here", p.all(".user-message")[0])!.click();
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
  assert.equal(row.querySelector(".tool-action")!.textContent, "Delegating to explorer");
  assert.equal(row.querySelector(".tool-target")!.textContent, "find the login code");
  assert.equal(row.querySelector(".subagent-output code")!.textContent, "src/auth.ts");
  assert.equal(p.doc.querySelector(".assistant")!.textContent, "Main answer.");
  assert.equal(row.querySelector(".subagent-steps .tool .tool-action")!.textContent, "explorer: Searching for", "its own tool calls are inside its row");
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

test("send options: no separate arrow; resting the pointer on Send opens its menu (only with something to send), Arrow Up opens it from the keyboard; picking one sends with that mode", async () => {
  const p = loadPanel();
  p.host(workspaces([MAIN]));
  const input = p.doc.querySelector<HTMLTextAreaElement>(".input")!;
  const menu = p.doc.querySelector<HTMLElement>(".send-menu")!;
  const sendButton = p.doc.querySelector<HTMLButtonElement>(".send")!;
  assert.equal(p.button("More send options"), undefined, "no arrow button");
  assert.equal(sendButton.getAttribute("aria-haspopup"), "menu");
  const hover = () => sendButton.dispatchEvent(new p.window.MouseEvent("mouseenter"));
  hover();
  await tick(HOVER_OPEN_MS + 50);
  assert.equal(menu.hidden, true, "nothing to send: no menu");
  input.value = "fork this";
  input.dispatchEvent(new p.window.Event("input"));
  input.focus();
  hover();
  await tick(HOVER_OPEN_MS - 200);
  assert.equal(menu.hidden, true, "not straight away");
  await tick(250);
  assert.equal(menu.hidden, false, "after resting on Send");
  assert.equal(p.doc.activeElement, input, "hovering keeps the cursor in the message box");
  const options = p.all(".send-option");
  assert.deepEqual(options.map((o) => o.querySelector(".send-option-label")!.textContent), ["Send", "Queue for later", "Send in a forked session"]);
  assert.ok(options.every((o) => o.querySelector("kbd")!.textContent!.length > 0), "each shows its shortcut");
  sendButton.dispatchEvent(new p.window.MouseEvent("mouseleave"));
  await tick(350);
  assert.equal(menu.hidden, true, "leaving closes it");
  sendButton.focus();
  sendButton.dispatchEvent(new p.window.KeyboardEvent("keydown", { key: "ArrowUp", bubbles: true }));
  assert.equal(menu.hidden, false);
  assert.equal(p.doc.activeElement, options[0], "from the keyboard, focus moves into the menu");
  (options[2] as HTMLButtonElement).click();
  assert.deepEqual(p.sent.at(-1), { type: "send", workspace: "main", text: "fork this", mode: "fork" });
  assert.equal(menu.hidden, true);
  p.host(workspaces([{ ...MAIN, running: true }]));
  input.value = "x";
  input.dispatchEvent(new p.window.Event("input"));
  assert.deepEqual(options.map((o) => (o as HTMLButtonElement).disabled), [false, false, true]);
});

test("tabs: pills named by conversation with a state slot (working, waiting, finished while away); + opens one, × closes one, a click switches; the chip keeps the workspace's name", () => {
  const p = loadPanel();
  const tab2 = { ...MAIN, id: "main~2", label: "Main · tab 2", tabOf: "main", title: "Fix the login loop", running: true };
  const tab3 = { ...MAIN, id: "main~3", label: "Main · tab 3", tabOf: "main", waiting: 1 };
  p.host(workspaces([{ ...MAIN, title: "Refactor", running: true }, tab3, tab2, WT], "main~2"));
  const tabs = () => p.all(".tab");
  assert.deepEqual(tabs().map((t) => t.querySelector(".tab-title")!.textContent), ["Refactor", "Fix the login loop", "New chat"], "the workspace first, then by number; not another workspace's");
  assert.deepEqual(tabs().map((t) => t.classList.contains("active")), [false, true, false]);
  assert.deepEqual(tabs().map((t) => t.querySelector(".tab-state")?.className ?? ""), ["tab-state working", "tab-state working", "tab-state waiting"]);
  assert.equal(tabs()[1].querySelector(".tab-button")!.getAttribute("aria-label"), "Fix the login loop, working");
  assert.equal(tabs()[1].querySelector(".tab-button")!.firstElementChild!.className, "tab-state working", "the state leads the pill, where it stays in view when titles are cut");
  assert.equal(tabs()[0].querySelector(".tab-slot"), null, "only a closable tab keeps a slot for ×");
  assert.equal(tabs()[0].querySelector(".tab-close"), null, "the first tab can't be closed");
  assert.equal(p.doc.querySelector(".workspace .chip-text")!.textContent, "Main", "the chip names the workspace");

  // The first tab finishes while another is shown: it keeps a dot until it's shown.
  p.host(workspaces([{ ...MAIN, title: "Refactor", running: false }, tab3, tab2, WT], "main~2"));
  assert.equal(tabs()[0].querySelector(".tab-state")?.className, "tab-state finished");
  assert.equal(tabs()[0].querySelector(".tab-button")!.getAttribute("aria-label"), "Refactor, finished");
  tabs()[0].querySelector<HTMLButtonElement>(".tab-button")!.click();
  assert.deepEqual(p.sent.at(-1), { type: "focus", workspace: "main" });
  assert.equal(tabs()[0].querySelector(".tab-state"), null, "shown: the dot goes");

  p.button("New tab")!.click();
  assert.deepEqual(p.sent.at(-1), { type: "newTab" });
  p.button("Close tab Fix the login loop")!.click();
  assert.deepEqual(p.sent.at(-1), { type: "closeTab", workspace: "main~2" });
});

test("tabs with the same title are numbered in strip order (empty ones are all \"New chat\"), in the pill, its label, and its close button", () => {
  const p = loadPanel();
  const tab = (n: number, title?: string) => ({ ...MAIN, id: `main~${n}`, label: `Main · tab ${n}`, tabOf: "main", ...(title ? { title } : {}) });
  p.host(workspaces([MAIN, tab(2), tab(3, "Fix the login loop"), tab(4), tab(5, "Fix the login loop")], "main"));
  assert.deepEqual(p.all(".tab-title").map((t) => t.textContent), ["New chat", "New chat 2", "Fix the login loop", "New chat 3", "Fix the login loop 2"]);
  assert.equal(p.all(".tab-button")[3].getAttribute("aria-label"), "New chat 3");
  assert.ok(p.button("Close tab New chat 3"), "each close button names its own tab");
});

test("tabs: one Tab stop (the shown tab); arrows, Home, and End show another; Delete closes; middle-click closes; double-click on empty space opens a tab", () => {
  const p = loadPanel();
  const tab2 = { ...MAIN, id: "main~2", label: "Main · tab 2", tabOf: "main", title: "Second" };
  const tab3 = { ...MAIN, id: "main~3", label: "Main · tab 3", tabOf: "main", title: "Third" };
  p.host(workspaces([{ ...MAIN, title: "First" }, tab2, tab3], "main"));
  const buttons = () => p.all(".tab-button");
  assert.deepEqual(buttons().map((b) => b.tabIndex), [0, -1, -1], "only the shown tab is in the Tab order");
  assert.ok(p.all(".tab-close").every((x) => (x as HTMLButtonElement).tabIndex === -1), "× isn't a Tab stop (Delete closes)");
  const press = (k: string) => (p.doc.activeElement as HTMLElement).dispatchEvent(new p.window.KeyboardEvent("keydown", { key: k, bubbles: true, cancelable: true }));
  buttons()[0].focus();
  press("ArrowRight");
  assert.deepEqual(p.sent.at(-1), { type: "focus", workspace: "main~2" });
  assert.equal(p.doc.activeElement, buttons()[1], "focus follows");
  assert.deepEqual(buttons().map((b) => b.tabIndex), [-1, 0, -1]);
  press("End");
  assert.deepEqual(p.sent.at(-1), { type: "focus", workspace: "main~3" });
  press("ArrowRight");
  assert.deepEqual(p.sent.at(-1), { type: "focus", workspace: "main" }, "wraps around");
  press("Delete");
  assert.notDeepEqual(p.sent.at(-1), { type: "closeTab", workspace: "main" }, "the first tab doesn't close");
  press("Home");
  press("ArrowLeft");
  press("Delete");
  assert.deepEqual(p.sent.at(-1), { type: "closeTab", workspace: "main~3" });
  p.all(".tab")[1].dispatchEvent(new p.window.MouseEvent("auxclick", { button: 1, bubbles: true, cancelable: true }));
  assert.deepEqual(p.sent.at(-1), { type: "closeTab", workspace: "main~2" }, "middle-click closes");
  p.doc.querySelector(".tabs")!.dispatchEvent(new p.window.MouseEvent("dblclick", { bubbles: true }));
  assert.deepEqual(p.sent.at(-1), { type: "newTab" }, "double-click on empty space opens a tab");
});

test("a queued message is edited in place: clicking it opens an editor (it won't send meanwhile); Enter saves, Escape cancels", () => {
  const p = loadPanel();
  const queue = [{ id: "q1", text: "next step", attachments: 0 }];
  p.host(workspaces([{ ...MAIN, running: true, queue }]));
  p.doc.querySelector<HTMLButtonElement>(".queued-text")!.click();
  assert.deepEqual(p.sent.at(-1), { type: "editQueued", workspace: "main", id: "q1", editing: true });
  const box = p.doc.querySelector<HTMLTextAreaElement>(".queued-edit")!;
  assert.equal(box.value, "next step");
  box.value = "next step, but in tests";
  box.dispatchEvent(new p.window.Event("input"));
  p.host(workspaces([{ ...MAIN, running: true, queue }]));
  const again = p.doc.querySelector<HTMLTextAreaElement>(".queued-edit")!;
  assert.equal(again.value, "next step, but in tests", "an update keeps what's typed");
  again.dispatchEvent(new p.window.KeyboardEvent("keydown", { key: "Enter", bubbles: true }));
  assert.deepEqual(p.sent.slice(-2), [
    { type: "updateQueued", workspace: "main", id: "q1", text: "next step, but in tests" },
    { type: "editQueued", workspace: "main", id: "q1", editing: false },
  ]);
  assert.equal(p.doc.querySelector(".queued-edit"), null);
  p.doc.querySelector<HTMLButtonElement>(".queued-text")!.click();
  p.doc.querySelector<HTMLTextAreaElement>(".queued-edit")!.dispatchEvent(new p.window.KeyboardEvent("keydown", { key: "Escape", bubbles: true }));
  assert.deepEqual(p.sent.at(-1), { type: "editQueued", workspace: "main", id: "q1", editing: false });
  assert.ok(!p.sent.slice(-2).some((m) => m.type === "updateQueued"), "Escape saves nothing");
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
  p.host({ type: "workspaces", items: [], harnesses: HARNESSES, problem: "Open a folder to use kernl." });
  const empty = p.doc.querySelector<HTMLElement>(".empty")!;
  assert.equal(empty.hidden, false);
  assert.match(empty.textContent!, /Open a folder to use kernl\./);
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

test("while the agent works, a Working indicator stays at the end of its transcript; it says when an approval is waiting, and goes away when the run ends", () => {
  const p = loadPanel();
  p.host(workspaces([MAIN]));
  p.host({ type: "userMessage", workspace: "main", text: "explain this" });
  assert.equal(p.doc.querySelector(".working"), null, "nothing while idle");
  p.host(workspaces([{ ...MAIN, running: true }]));
  const working = () => p.visibleLog().querySelector<HTMLElement>(".working");
  const label = () => working()?.querySelector(".working-label")?.textContent;
  assert.equal(label(), "Working");
  assert.equal(working()!.querySelector(".working-label")!.getAttribute("role"), "status", "only the label is announced");
  assert.equal(working()!.querySelector(".working-time")!.getAttribute("aria-hidden"), "true", "the ticking time isn't read out");
  assert.equal(working()!.querySelector(".working-time")!.textContent, "", "no time under 1 s");
  p.host({ type: "text", workspace: "main", delta: "This hook loads rewards." });
  assert.equal(p.visibleLog().lastElementChild, working(), "it stays below new output");
  p.host(workspaces([{ ...MAIN, running: true, waiting: 1 }]));
  assert.equal(label(), "Waiting for your approval");
  assert.ok(working()!.classList.contains("waiting"));
  p.host({ type: "finished", workspace: "main", reason: "done" });
  p.host(workspaces([MAIN]));
  assert.equal(p.doc.querySelector(".working"), null);
});

test("in-panel menus open next to the control that asked; picking, searching, Escape, and the host withdrawing all work", () => {
  const p = loadPanel();
  p.host(workspaces([MAIN]));
  const items = [
    { label: "kernl", separator: true },
    { label: "kernl", description: "your own model keys", checked: true },
    { label: "Agents", separator: true },
    { label: "Claude Code" },
    { label: "OpenCode", detail: "needs setup" },
  ];
  p.host({ type: "menu", id: "m1", title: "Agent", anchor: "agent", items, search: false });
  const menu = p.doc.querySelector<HTMLElement>(".anchored-menu")!;
  assert.equal(menu.hidden, false);
  assert.equal(p.doc.querySelector('[data-anchor="agent"]')!.classList.contains("harness"), true, "the agent chip is the anchor");
  assert.deepEqual(p.all(".menu-heading").map((h) => h.textContent), ["kernl", "Agents"]);
  assert.deepEqual(p.all(".menu-item .menu-item-label").map((l) => l.textContent), ["kernl", "Claude Code", "OpenCode"]);
  assert.equal(p.all(".menu-item")[0].getAttribute("aria-current"), "true");
  p.all(".menu-item")[1].click();
  assert.deepEqual(p.sent.at(-1), { type: "menuPick", id: "m1", index: 3 }, "the index is into the host's full list");
  assert.equal(menu.hidden, true);

  p.host({ type: "menu", id: "m2", title: "", anchor: "workspace", items: [{ label: "alpha" }, { label: "beta" }, { label: "gamma" }], search: true });
  const search = p.doc.querySelector<HTMLInputElement>(".menu-search")!;
  search.value = "BET";
  search.dispatchEvent(new p.window.Event("input"));
  assert.deepEqual(p.all(".menu-item .menu-item-label").map((l) => l.textContent), ["beta"]);
  search.dispatchEvent(new p.window.KeyboardEvent("keydown", { key: "Enter", bubbles: true }));
  assert.deepEqual(p.sent.at(-1), { type: "menuPick", id: "m2", index: 1 });

  p.host({ type: "menu", id: "m3", title: "", anchor: "title", items: [{ label: "x" }], search: false });
  menu.dispatchEvent(new p.window.KeyboardEvent("keydown", { key: "Escape", bubbles: true }));
  assert.deepEqual(p.sent.at(-1), { type: "menuPick", id: "m3" }, "Escape dismisses");

  p.host({ type: "menu", id: "m4", title: "", anchor: "attach", items: [{ label: "x" }], search: false });
  const before = p.sent.length;
  p.host({ type: "menuClosed", id: "m4" });
  assert.equal(menu.hidden, true);
  assert.equal(p.sent.length, before, "withdrawn by the host: no answer sent");
});

test("tool calls show as one line in plain words with a status and time, and open to readable arguments and output", () => {
  const p = loadPanel();
  p.host(workspaces([MAIN]));
  p.host({ type: "toolCall", workspace: "main", id: "t1", name: "read_file", args: JSON.stringify({ file_path: "/src/a.ts" }) });
  const row = p.doc.querySelector<HTMLDetailsElement>(".tool")!;
  assert.equal(row.querySelector(".tool-action")!.textContent, "Reading");
  assert.equal(row.querySelector(".tool-target")!.textContent, "src/a.ts");
  assert.equal(row.dataset.status, "running");
  assert.equal(row.querySelector(".tool-time")!.textContent, "", "no time while under 1 s");
  assert.deepEqual([row.querySelector(".tool-arg-key")!.textContent, row.querySelector(".tool-arg-value")!.textContent], ["file_path", "/src/a.ts"]);
  p.host({ type: "toolResult", workspace: "main", id: "t1", name: "read_file", output: "export const a = 1;" });
  assert.equal(row.dataset.status, "done");
  assert.equal(row.querySelector(".tool-output")!.textContent, "export const a = 1;");
  p.host({ type: "toolCall", workspace: "main", id: "t2", name: "execute", args: JSON.stringify({ command: "npm test" }) });
  p.host({ type: "toolResult", workspace: "main", id: "t2", name: "execute", output: "1 failing", failed: true });
  assert.equal(p.all(".tool")[1].dataset.status, "failed");
  assert.equal(p.all(".tool")[1].querySelector(".tool-action")!.textContent, "Failed: Running", "a failed call says so in its text");
  assert.equal((p.all(".tool")[1] as HTMLDetailsElement).open, true, "a failed call opens itself");
  p.host({ type: "toolCall", workspace: "main", id: "t3", name: "Read hello.txt", args: "{}" });
  p.host({ type: "finished", workspace: "main", reason: "stopped" });
  assert.equal(p.all(".tool")[2].dataset.status, "stopped", "a call that never reported back stops its timer");
  assert.equal(p.all(".tool")[2].querySelector(".tool-action")!.textContent, "Stopped: Read hello.txt");
});

test("a message shows at once; Restore appears on it when its restore point is ready", () => {
  const p = loadPanel();
  p.host(workspaces([MAIN]));
  p.host({ type: "userMessage", workspace: "main", text: "change the title", id: "u1", turn: 0 });
  const message = p.doc.querySelector<HTMLElement>(".user-message")!;
  assert.equal(message.querySelector(".restore"), null, "no restore point yet");
  p.host({ type: "checkpoint", workspace: "main", messageId: "u1", checkpoint: "abc123" });
  message.querySelector<HTMLButtonElement>(".restore")!.click();
  assert.deepEqual(p.sent.at(-1), { type: "restore", workspace: "main", messageId: "u1" });
  p.host({ type: "checkpoint", workspace: "main", messageId: "u1", checkpoint: "abc123" });
  assert.equal(message.querySelectorAll(".restore").length, 1, "only once");
  assert.deepEqual(p.all(".user-actions .message-action").map((b) => b.getAttribute("aria-label")), ["Copy message", "Restore checkpoint", "Fork from here"], "Restore lands between Copy and Fork");
});

test("thinking streams open as 'Thinking…', then collapses to 'Thought for …' with a preview when the reply starts; the setting can keep it open", () => {
  const p = loadPanel();
  p.host(STATUS);
  p.host(workspaces([MAIN]));
  p.host({ type: "thinking", workspace: "main", delta: "Look at the hook " });
  p.host({ type: "thinking", workspace: "main", delta: "before answering." });
  const block = p.doc.querySelector<HTMLDetailsElement>(".thinking")!;
  assert.equal(p.all(".thinking").length, 1, "chunks join one block");
  assert.equal(block.open, true);
  assert.equal(block.querySelector(".thinking-label")!.textContent, "Thinking…");
  assert.equal(block.querySelector(".thinking-text")!.textContent, "Look at the hook before answering.");
  p.host({ type: "text", workspace: "main", delta: "It loads rewards." });
  assert.equal(block.open, false, "collapses when the reply starts");
  assert.match(block.querySelector(".thinking-label")!.textContent!, /^Thought for \d+s$/);
  assert.equal(block.querySelector(".thinking-preview")!.textContent, "Look at the hook before answering.");
  p.host({ type: "thinking", workspace: "main", delta: "More thinking" });
  assert.equal(p.all(".thinking").length, 2, "new thinking after a reply is a new block");

  const q = loadPanel();
  q.host({ ...STATUS, thinkingDisplay: "expanded" } as HostToPanel);
  q.host(workspaces([MAIN]));
  q.host({ type: "thinking", workspace: "main", delta: "x" });
  q.host({ type: "finished", workspace: "main", reason: "done" });
  assert.equal(q.doc.querySelector<HTMLDetailsElement>(".thinking")!.open, true, "expanded stays open");
});

test("an agent's tool call is one row updated in place: kind icon, waiting, running, an edit's size with View diff, and file links", () => {
  const p = loadPanel();
  p.host(workspaces([WT], "wt:fix"));
  p.host({ type: "toolCall", workspace: "wt:fix", id: "e1", name: "Edit src/a.ts", args: "{}", kind: "edit", status: "pending", locations: [{ path: "src/a.ts", line: 3 }] });
  const row = p.doc.querySelector<HTMLDetailsElement>(".tool")!;
  assert.equal(row.dataset.status, "pending");
  assert.equal(row.querySelector(".tool-status"), null, "no status marks: the row's state is in its text and style");
  p.host({ type: "toolCall", workspace: "wt:fix", id: "e1", name: "Edit src/a.ts", args: "{}", kind: "edit", status: "running", diff: { path: "src/a.ts", added: 2, removed: 1 } });
  assert.equal(p.all(".tool").length, 1, "the same row, not a new one");
  assert.equal(row.dataset.status, "running");
  assert.equal(row.querySelector(".tool-diff")!.textContent, "+2−1");
  p.button("View diff", row)!.click();
  assert.deepEqual(p.sent.at(-1), { type: "showToolDiff", workspace: "wt:fix", id: "e1" });
  p.host({ type: "toolCall", workspace: "wt:fix", id: "e1", name: "Edit src/a.ts", args: "{}", kind: "edit", locations: [{ path: "src/a.ts", line: 3 }], diff: { path: "src/a.ts", added: 2, removed: 1 } });
  assert.equal(row.dataset.status, "running", "a report without a status keeps the mark");
  p.button("src/a.ts:3", row)!.click();
  assert.deepEqual(p.sent.at(-1), { type: "openLocation", workspace: "wt:fix", path: "src/a.ts", line: 3 });
  p.host({ type: "toolResult", workspace: "wt:fix", id: "e1", name: "Edit src/a.ts", output: "done" });
  assert.equal(row.dataset.status, "done");
});

test("the plan is pinned above the input: what's being done now and how far along; each update replaces it; a new conversation clears it", () => {
  const p = loadPanel();
  p.host(workspaces([MAIN]));
  const bar = p.doc.querySelector<HTMLDetailsElement>(".plan-bar")!;
  assert.equal(bar.hidden, true);
  p.host({ type: "plan", workspace: "main", entries: [{ content: "Read the hook", status: "completed" }, { content: "Explain it", status: "in_progress" }, { content: "Suggest fixes", status: "pending" }] });
  assert.equal(bar.hidden, false);
  assert.equal(bar.querySelector(".plan-current")!.textContent, "Current: Explain it");
  assert.equal(bar.querySelector(".plan-count")!.textContent, "1/3");
  assert.deepEqual(p.all(".plan-entry").map((e) => e.dataset.status), ["completed", "in_progress", "pending"]);
  p.host({ type: "plan", workspace: "main", entries: [{ content: "Only step", status: "completed" }] });
  assert.equal(p.all(".plan-entry").length, 1, "replaced, not merged");
  assert.equal(bar.querySelector(".plan-current")!.textContent, "Plan complete");
  p.host({ type: "cleared", workspace: "main" });
  assert.equal(bar.hidden, true);
});

test("the context ring shows how full the context is, with warning levels and the numbers in its label", () => {
  const p = loadPanel();
  p.host(workspaces([MAIN]));
  const ring = p.doc.querySelector<HTMLElement>(".context-ring")!;
  assert.equal(ring.hidden, true, "hidden until the agent reports it");
  p.host({ type: "context", workspace: "main", used: 150000, size: 200000, cost: { amount: 0.42, currency: "USD" } });
  assert.equal(ring.querySelector(".context-label")!.textContent, "75%");
  assert.equal(ring.dataset.level, "filling");
  assert.match(ring.getAttribute("aria-label")!, /150k of 200k tokens \(75%\).*0\.42/);
  p.host({ type: "context", workspace: "main", used: 196000, size: 200000 });
  assert.equal(ring.dataset.level, "full");
  assert.match(ring.title, /nearly full/);
});

test("approval cards: an agent's 'always' option shows in its own words; shortcuts approve once, always, or reject the newest card, but not while typing", () => {
  const p = loadPanel();
  p.host(workspaces([WT], "wt:fix"));
  p.host({ type: "approval", card: { ...card("c1", "wt:fix", "fix"), always: "Always allow" } });
  p.button("Always allow")!.click();
  assert.deepEqual(p.sent.at(-1), { type: "answer", id: "c1", approved: true, always: true });
  p.host({ type: "approval", card: card("c2", "wt:fix", "fix") });
  assert.equal(p.button("Always allow", p.doc.querySelector('[data-card-id="c2"]')!), undefined, "not offered: no always button");
  const key = (k: string, alt = false) => p.doc.dispatchEvent(new p.window.KeyboardEvent("keydown", { key: k, metaKey: true, altKey: alt, bubbles: true }));
  key("y");
  assert.deepEqual(p.sent.at(-1), { type: "answer", id: "c2", approved: true });
  const before = p.sent.length;
  key("y", true);
  assert.equal(p.sent.length, before, "always isn't offered on c2, so nothing is sent");
  key("z", true);
  assert.deepEqual(p.sent.at(-1), { type: "answer", id: "c2", approved: false });
  const count = p.sent.length;
  p.doc.querySelector<HTMLTextAreaElement>(".input")!.focus();
  key("y");
  assert.equal(p.sent.length, count, "ignored while the message box has focus");
});

test("screen readers: the transcript doesn't read out tokens; finished replies, approvals, and errors are announced; each turn has a heading", () => {
  const p = loadPanel();
  p.host(workspaces([MAIN]));
  const logs = p.doc.querySelector<HTMLElement>(".logs")!;
  assert.deepEqual([logs.getAttribute("role"), logs.getAttribute("aria-live")], ["log", "off"]);
  const polite = p.doc.querySelector<HTMLElement>('[role="status"][aria-live="polite"].sr-only')!;
  const urgent = p.doc.querySelector<HTMLElement>('[role="alert"]')!;
  p.host({ type: "userMessage", workspace: "main", text: "explain" });
  p.host({ type: "text", workspace: "main", delta: "It loads " });
  p.host({ type: "text", workspace: "main", delta: "rewards." });
  assert.equal(polite.textContent, "", "nothing while streaming");
  p.host({ type: "finished", workspace: "main", reason: "done" });
  assert.equal(polite.textContent, "Reply finished. It loads rewards.");
  assert.deepEqual(p.all(".log h3.sr-only").map((h) => h.textContent), ["Your message", "Reply"]);
  p.host({ type: "approval", card: card("a1", "main", "Main") });
  assert.equal(polite.textContent, "Approval needed: Run command");
  p.host({ type: "finished", workspace: "main", reason: "error", message: "No API key stored." });
  assert.equal(urgent.textContent, "Something went wrong: No API key stored.");
});

test("message actions: Copy, Restore, Fork sit under your message; Copy and Fork under a finished reply, which copies every block of the turn's reply", () => {
  const p = loadPanel();
  p.host(workspaces([MAIN]));
  p.host({ type: "userMessage", workspace: "main", text: "explain useRewards", id: "u1", checkpoint: "abc", turn: 0 });
  const userRow = p.doc.querySelector<HTMLElement>(".user-message > .message-actions")!;
  assert.ok(userRow.previousElementSibling?.classList.contains("user"), "the row is under the bubble, not inside it");
  assert.equal(p.all(".user").length, 1, "the row doesn't take the bubble's style (only the bubble is .user)");
  p.button("Copy message", userRow)!.click();
  assert.deepEqual(p.sent.at(-1), { type: "copy", text: "explain useRewards" });
  assert.equal(p.button("Copied", userRow)?.classList.contains("copy"), true, "Copy confirms");
  p.host({ type: "text", workspace: "main", delta: "It loads rewards." });
  p.host({ type: "toolCall", workspace: "main", id: "t1", name: "read_file", args: JSON.stringify({ file_path: "/src/a.ts" }) });
  p.host({ type: "toolResult", workspace: "main", id: "t1", name: "read_file", output: "x" });
  assert.equal(p.doc.querySelector(".reply-actions"), null, "no reply actions while the turn runs");
  p.host({ type: "text", workspace: "main", delta: "Then it caches them." });
  p.host({ type: "finished", workspace: "main", reason: "done" });
  const replyRow = p.doc.querySelector<HTMLElement>(".reply-actions")!;
  assert.equal(p.visibleLog().lastElementChild, replyRow, "under the reply");
  p.button("Copy reply", replyRow)!.click();
  assert.deepEqual(p.sent.at(-1), { type: "copy", text: "It loads rewards.\n\nThen it caches them." });
  p.button("Fork from here", replyRow)!.click();
  assert.deepEqual(p.sent.at(-1), { type: "fork", workspace: "main", messageId: "u1" });
  assert.deepEqual(p.all(".message-actions.latest"), [userRow, replyRow], "the newest turn's rows stay visible");
  p.host({ type: "userMessage", workspace: "main", text: "and errors?", id: "u2", turn: 1 });
  assert.equal(p.all(".message-actions.latest").length, 1, "earlier rows show on hover only");
  p.host({ type: "finished", workspace: "main", reason: "stopped" });
  assert.equal(p.all(".reply-actions").length, 1, "a turn with no reply text gets no reply row");
});

test("message actions: a CLI agent's earlier turns can't be forked, and say why; kernl's own agent can fork any turn", () => {
  const p = loadPanel();
  p.host(workspaces([WT]));
  p.host({ type: "userMessage", workspace: "wt:fix", text: "first", id: "u1", turn: 0 });
  p.host({ type: "text", workspace: "wt:fix", delta: "one" });
  p.host({ type: "finished", workspace: "wt:fix", reason: "done" });
  const forks = () => p.all(".message-action.fork");
  assert.equal(forks().some((b) => b.getAttribute("aria-disabled") === "true"), false, "the latest turn can fork");
  p.host({ type: "userMessage", workspace: "wt:fix", text: "second", id: "u2", turn: 1 });
  const [userFork, replyFork, latestFork] = forks();
  for (const b of [userFork, replyFork]) {
    assert.equal(b.getAttribute("aria-disabled"), "true");
    assert.equal(b.title, "Claude Code can fork only from the last message");
  }
  const before = p.sent.length;
  userFork.click();
  assert.equal(p.sent.length, before, "nothing is sent");
  assert.equal(latestFork.getAttribute("aria-disabled"), null);

  const k = loadPanel();
  k.host(workspaces([MAIN]));
  k.host({ type: "userMessage", workspace: "main", text: "first", id: "u1", turn: 0 });
  k.host({ type: "userMessage", workspace: "main", text: "second", id: "u2", turn: 1 });
  assert.equal(k.all(".message-action.fork").some((b) => b.getAttribute("aria-disabled") === "true"), false);
});

test("message actions come back when a conversation is replayed", () => {
  const p = loadPanel();
  p.host(workspaces([MAIN]));
  const events: HostToPanel[] = [
    { type: "userMessage", workspace: "main", text: "hi", id: "u1", checkpoint: "abc", turn: 0 },
    { type: "text", workspace: "main", delta: "hello" },
    { type: "finished", workspace: "main", reason: "done" },
  ];
  events.forEach(p.host);
  p.host({ type: "cleared", workspace: "main" });
  events.forEach(p.host);
  assert.equal(p.all(".user-actions").length, 1);
  assert.equal(p.all(".reply-actions").length, 1);
  assert.ok(p.button("Restore checkpoint"));
});

test("the Working indicator shows how long the run has taken, from 1 s", async () => {
  const p = loadPanel();
  p.host(workspaces([MAIN]));
  p.host(workspaces([{ ...MAIN, running: true }]));
  await new Promise((r) => setTimeout(r, 1100));
  assert.equal(p.doc.querySelector(".working-time")!.textContent, "· 1s");
  p.host(workspaces([MAIN]));
  p.host(workspaces([{ ...MAIN, running: true }]));
  assert.equal(p.doc.querySelector(".working-time")!.textContent, "", "a new run starts from zero");
});

test("a command row leads with the agent's description, the command after it; without one it reads Running, then Ran", () => {
  const p = loadPanel();
  p.host(workspaces([WT]));
  p.host({ type: "toolCall", workspace: "wt:fix", id: "x1", name: "cd /ws && grep -n useRewards src", args: "{}", kind: "execute", status: "running", command: "grep -n useRewards src", description: "Find usages of useRewards" });
  const row = p.doc.querySelector<HTMLElement>(".tool")!;
  assert.ok(row.classList.contains("command"));
  assert.equal(row.querySelector(".tool-action")!.textContent, "Find usages of useRewards");
  assert.equal(row.querySelector(".tool-target")!.textContent, "grep -n useRewards src");
  assert.equal(row.querySelector("summary")!.title, "Find usages of useRewards\ngrep -n useRewards src");
  p.host({ type: "toolCall", workspace: "wt:fix", id: "x2", name: "npm test", args: "{}", kind: "execute", status: "running", command: "npm test" });
  const plain = p.all(".tool")[1];
  assert.equal(plain.querySelector(".tool-action")!.textContent, "Running");
  p.host({ type: "toolResult", workspace: "wt:fix", id: "x2", name: "npm test", output: "ok" });
  assert.equal(plain.querySelector(".tool-action")!.textContent, "Ran");
});

test("a long output shows its first and last 5 lines, and Show all opens the rest", () => {
  const p = loadPanel();
  p.host(workspaces([MAIN]));
  const output = Array.from({ length: 40 }, (_, i) => `line ${i + 1}`).join("\n");
  p.host({ type: "toolCall", workspace: "main", id: "t1", name: "execute", args: JSON.stringify({ command: "npm test" }) });
  p.host({ type: "toolResult", workspace: "main", id: "t1", name: "execute", output });
  const shown = () => p.all(".tool .tool-output").map((o) => o.textContent);
  assert.deepEqual(shown(), ["line 1\nline 2\nline 3\nline 4\nline 5", "line 36\nline 37\nline 38\nline 39\nline 40"]);
  p.button("Show all 40 lines")!.click();
  assert.deepEqual(shown(), [output]);
  p.host({ type: "toolCall", workspace: "main", id: "t2", name: "execute", args: JSON.stringify({ command: "ls" }) });
  const twelve = Array.from({ length: 12 }, (_, i) => `f${i}`).join("\n");
  p.host({ type: "toolResult", workspace: "main", id: "t2", name: "execute", output: twelve });
  assert.equal(p.all(".tool")[1].querySelector(".tool-output")!.textContent, twelve, "hiding a line or two saves nothing");
});

test("reads and searches in a row become one line, Exploring while they run and Explored when done, that opens to the rows", () => {
  const p = loadPanel();
  p.host(workspaces([WT]));
  const call = (id: string, name: string, kind: string) => p.host({ type: "toolCall", workspace: "wt:fix", id, name, args: "{}", kind, status: "running" });
  const done = (id: string, failed = false) => p.host({ type: "toolResult", workspace: "wt:fix", id, name: id, output: "x", failed });
  call("r1", "Read src/a.ts", "read");
  assert.equal(p.doc.querySelector(".tool-group"), null, "a single read stays a plain row");
  call("s1", "grep -n useRewards", "search");
  const group = p.doc.querySelector<HTMLDetailsElement>(".tool-group")!;
  assert.equal(group.querySelector(".tool-action")!.textContent, "Exploring · 1 file, 1 search");
  assert.equal(group.open, false, "collapsed");
  for (const id of ["s2", "s3", "s4"]) call(id, `grep ${id}`, "search");
  for (const id of ["r1", "s1", "s2", "s3"]) done(id);
  done("s4", true);
  assert.equal(group.querySelector(".tool-action")!.textContent, "Explored 1 file, 4 searches");
  assert.equal(group.querySelector(".tool-group-failed")!.textContent, "· 1 failed");
  assert.equal(group.dataset.groupStatus, "failed");
  assert.equal(group.querySelectorAll(".tool-group-rows > .tool").length, 5, "it opens to the five rows");
  assert.equal(p.visibleLog().querySelectorAll(":scope > .tool").length, 1, "one line in the transcript");
  p.host({ type: "text", workspace: "wt:fix", delta: "Found it." });
  call("r2", "Read src/b.ts", "read");
  call("x1", "npm test", "execute");
  call("r3", "Read src/c.ts", "read");
  assert.equal(p.all(".tool-group").length, 1, "text, or another kind of call, ends a group");
});

test("grouping: kernl's own lookups group too, inside a subagent's steps as well; an edit never does", () => {
  const p = loadPanel();
  p.host(workspaces([{ ...MAIN, running: true }]));
  p.host({ type: "toolCall", workspace: "main", id: "a", name: "read_file", args: JSON.stringify({ file_path: "/a.ts" }) });
  p.host({ type: "toolCall", workspace: "main", id: "b", name: "grep", args: JSON.stringify({ pattern: "x" }) });
  assert.equal(p.all(".tool-group").length, 1, "the Working indicator between them doesn't count");
  p.host({ type: "toolCall", workspace: "main", id: "e", name: "edit_file", args: JSON.stringify({ file_path: "/a.ts" }) });
  p.host({ type: "toolCall", workspace: "main", id: "t", name: "task", args: JSON.stringify({ subagent_type: "explorer", description: "find it" }) });
  p.host({ type: "toolCall", workspace: "main", id: "t1", name: "explorer > glob", args: JSON.stringify({ pattern: "*.ts" }) });
  p.host({ type: "toolCall", workspace: "main", id: "t2", name: "explorer > read_file", args: JSON.stringify({ file_path: "/b.ts" }) });
  const sub = p.doc.querySelector(".subagent-steps")!;
  assert.equal(sub.querySelectorAll(".tool-group").length, 1);
  assert.equal(sub.querySelector(".tool-group .tool-action")!.textContent, "Exploring · 1 file, 1 search");
  p.host({ type: "finished", workspace: "main", reason: "stopped" });
  assert.equal(sub.querySelector(".tool-group .tool-action")!.textContent, "Explored 1 file, 1 search", "Stop settles the group");
});

test("tool rows carry no tick or cross: done is plain text, a failure reads 'Failed: <description>', and a group shows only its failure count", () => {
  const p = loadPanel();
  p.host(workspaces([WT]));
  p.host({ type: "toolCall", workspace: "wt:fix", id: "x1", name: "grep x", args: "{}", kind: "execute", status: "running", command: "grep -n x src", description: "Find usages of x" });
  p.host({ type: "toolCall", workspace: "wt:fix", id: "x2", name: "npm test", args: "{}", kind: "execute", status: "running", command: "npm test" });
  p.host({ type: "toolResult", workspace: "wt:fix", id: "x1", name: "grep x", output: "no such file", failed: true });
  p.host({ type: "toolResult", workspace: "wt:fix", id: "x2", name: "npm test", output: "boom", failed: true });
  const [described, plain] = p.all(".tool");
  assert.equal(described.querySelector(".tool-action")!.textContent, "Failed: Find usages of x");
  assert.equal(described.querySelector(".tool-target")!.textContent, "grep -n x src");
  assert.equal(plain.querySelector(".tool-action")!.textContent, "Failed:", "an undescribed command: 'Failed:' then the command");
  assert.equal(plain.querySelector(".tool-target")!.textContent, "npm test");
  p.host({ type: "toolCall", workspace: "wt:fix", id: "r1", name: "Read a.ts", args: "{}", kind: "read", status: "running" });
  p.host({ type: "toolCall", workspace: "wt:fix", id: "r2", name: "Read b.ts", args: "{}", kind: "read", status: "running" });
  const group = p.doc.querySelector<HTMLElement>(".tool-group")!;
  assert.equal(group.dataset.groupStatus, "running", "a running group's text shimmers (styled by state)");
  p.host({ type: "toolResult", workspace: "wt:fix", id: "r1", name: "Read a.ts", output: "a" });
  p.host({ type: "toolResult", workspace: "wt:fix", id: "r2", name: "Read b.ts", output: "b" });
  assert.equal(group.querySelector(".tool-action")!.textContent, "Explored 2 files");
  assert.equal(p.doc.querySelectorAll(".tool-status").length, 0, "no status marks anywhere");
  for (const summary of p.all(".tool > summary")) assert.ok(summary.firstElementChild!.classList.contains("tool-kind"), "each line starts with its kind icon");
});

test("read-only shell lookups fold in with reads and searches, even when the command arrives after the call's first report", () => {
  const p = loadPanel();
  p.host(workspaces([WT]));
  p.host({ type: "toolCall", workspace: "wt:fix", id: "r1", name: "Read src/a.ts", args: "{}", kind: "read", status: "running" });
  // Claude Code's first report of a Bash call can have an empty input; the command follows.
  p.host({ type: "toolCall", workspace: "wt:fix", id: "x1", name: "Terminal", args: "{}", kind: "execute", status: "pending" });
  assert.equal(p.doc.querySelector(".tool-group"), null, "not a lookup yet");
  p.host({ type: "toolCall", workspace: "wt:fix", id: "x1", name: "grep -n x src", args: "{}", kind: "execute", status: "running", command: "grep -n x src", description: "Find x", lookup: "search" });
  const group = p.doc.querySelector<HTMLElement>(".tool-group")!;
  assert.ok(group, "it joins the read before it");
  p.host({ type: "toolCall", workspace: "wt:fix", id: "x2", name: "cat b.ts", args: "{}", kind: "execute", status: "running", command: "cat b.ts", lookup: "read" });
  p.host({ type: "toolCall", workspace: "wt:fix", id: "x3", name: "npm test", args: "{}", kind: "execute", status: "running", command: "npm test" });
  for (const id of ["r1", "x1", "x2", "x3"]) p.host({ type: "toolResult", workspace: "wt:fix", id, name: id, output: "ok" });
  assert.equal(group.querySelector(".tool-action")!.textContent, "Explored 2 files, 1 search");
  assert.equal(p.visibleLog().querySelectorAll(":scope > .tool").length, 2, "the group, then npm test on its own line");
  assert.equal(group.querySelectorAll(".tool-group-rows > .tool")[1].querySelector(".tool-action")!.textContent, "Find x", "inside, the row keeps its description");
});

test("kernl's mark (the logo's glyph) marks the agent: the empty state, the Working indicator, thinking, and Auto mode", () => {
  const p = loadPanel();
  p.host(workspaces([{ ...MAIN, mode: "auto", modes: [{ id: "auto", label: "Auto mode", icon: "kernl", description: "" }, { id: "ask", label: "Ask before edits", icon: "shield", description: "" }] }]));
  const big = p.doc.querySelector<HTMLElement>(".empty .kernl-mark")!;
  assert.ok(big, "the empty state");
  assert.equal(big.style.width, "40px");
  assert.equal(big.getAttribute("aria-hidden"), "true");
  assert.ok(p.doc.querySelector(".mode .kernl-mark"), "the Auto mode chip");
  p.host(workspaces([{ ...MAIN, running: true }]));
  assert.ok(p.doc.querySelector(".working-mark .kernl-mark"), "the Working indicator");
  p.host({ type: "thinking", workspace: "main", delta: "hmm" });
  assert.ok(p.doc.querySelector(".thinking summary .kernl-mark"), "thinking");
  assert.equal(p.doc.querySelectorAll("svg path[d^='M3.33 3h2.13']").length, 0, "the old hand-drawn K is gone");
});

test("an image a call read shows as a thumbnail on its line and its group's line, and larger with Open when opened", () => {
  const p = loadPanel();
  p.host({ ...STATUS, previewBase: "https://res.test/previews" } as HostToPanel);
  p.host(workspaces([WT]));
  p.host({ type: "toolCall", workspace: "wt:fix", id: "i1", name: "Read logo.png", args: "{}", kind: "read", status: "running", locations: [{ path: "media/logo.png" }] });
  p.host({ type: "toolResult", workspace: "wt:fix", id: "i1", name: "Read logo.png", output: "" });
  p.host({ type: "toolPreview", workspace: "wt:fix", id: "i1", file: "conv-1/i1-abcd1234.png" });
  const row = p.doc.querySelector<HTMLDetailsElement>(".tool")!;
  const thumb = row.querySelector<HTMLImageElement>(":scope > summary > .tool-thumb")!;
  assert.equal(thumb.src, "https://res.test/previews/conv-1/i1-abcd1234.png");
  assert.equal(thumb.getAttribute("aria-hidden"), "true", "decorative on the line");
  const image = row.querySelector<HTMLImageElement>(".tool-preview .tool-image")!;
  assert.equal(image.alt, "logo.png");
  p.button("Open logo.png", row)!.click();
  assert.deepEqual(p.sent.at(-1), { type: "openLocation", workspace: "wt:fix", path: "media/logo.png" });
  p.host({ type: "toolCall", workspace: "wt:fix", id: "r2", name: "Read a.ts", args: "{}", kind: "read", status: "running" });
  const group = p.doc.querySelector<HTMLElement>(".tool-group")!;
  assert.equal(group.querySelectorAll(":scope > summary .tool-thumb").length, 1, "the group's line carries its members' thumbnails");
  for (const bad of ["../../secrets.png", "conv/x.svg", "https://evil.test/x.png"]) {
    p.host({ type: "toolPreview", workspace: "wt:fix", id: "r2", file: bad });
  }
  assert.equal(p.all(".tool-thumb").length, 2, "only a saved preview's own name is loaded (the row's and the group's copy)");
});

test("a group shows at most three thumbnails, then how many more", () => {
  const p = loadPanel();
  p.host({ ...STATUS, previewBase: "https://res.test/previews" } as HostToPanel);
  p.host(workspaces([WT]));
  for (const n of [1, 2, 3, 4, 5]) {
    p.host({ type: "toolCall", workspace: "wt:fix", id: `i${n}`, name: `Read ${n}.png`, args: "{}", kind: "read", status: "running" });
    p.host({ type: "toolPreview", workspace: "wt:fix", id: `i${n}`, file: `c/i${n}-0000000${n}.png` });
  }
  const line = p.doc.querySelector(".tool-group > summary")!;
  assert.equal(line.querySelectorAll(".tool-group-thumbs .tool-thumb").length, 3);
  assert.equal(line.querySelector(".tool-thumb-more")!.textContent, "+2");
});

test("a group's line names the files it read as chips that open them, without opening the group", () => {
  const p = loadPanel();
  p.host(workspaces([WT]));
  p.host({ type: "toolCall", workspace: "wt:fix", id: "r1", name: "Read src/a.ts", args: "{}", kind: "read", status: "running", locations: [{ path: "src/a.ts", line: 3 }] });
  p.host({ type: "toolCall", workspace: "wt:fix", id: "s1", name: "grep x", args: "{}", kind: "search", status: "running" });
  p.host({ type: "toolCall", workspace: "wt:fix", id: "r2", name: "Read src/a.ts", args: "{}", kind: "read", status: "running", locations: [{ path: "src/a.ts", line: 40 }] });
  p.host({ type: "toolCall", workspace: "wt:fix", id: "r3", name: "Read lib/b.ts", args: "{}", kind: "read", status: "running", locations: [{ path: "lib/b.ts" }] });
  const group = p.doc.querySelector<HTMLDetailsElement>(".tool-group")!;
  const chips = [...group.querySelectorAll<HTMLButtonElement>(":scope > summary .tool-file-chip")];
  assert.deepEqual(chips.map((c) => c.textContent), ["a.ts", "b.ts"], "each file once, by name");
  assert.equal(chips[1].title, "Open lib/b.ts");
  chips[1].click();
  assert.deepEqual(p.sent.at(-1), { type: "openLocation", workspace: "wt:fix", path: "lib/b.ts" });
  assert.equal(group.open, false, "the chip opens the file, not the group");

  const k = loadPanel();
  k.host(workspaces([MAIN]));
  k.host({ type: "toolCall", workspace: "main", id: "a", name: "read_file", args: JSON.stringify({ file_path: "/src/app.ts" }) });
  k.host({ type: "toolCall", workspace: "main", id: "b", name: "grep", args: JSON.stringify({ pattern: "x" }) });
  assert.deepEqual([...k.doc.querySelectorAll(".tool-file-chip")].map((c) => c.textContent), ["app.ts"], "kernl's own read_file names its file too");
});

test("a fetched page shows its site on the line and its address as a link when opened; search hits become links with a count", () => {
  const p = loadPanel();
  p.host(workspaces([WT]));
  p.host({ type: "toolCall", workspace: "wt:fix", id: "f1", name: "Fetch https://docs.example.com/guide/setup?x=1", args: JSON.stringify({ url: "https://docs.example.com/guide/setup?x=1", prompt: "How to set up?" }), kind: "fetch", status: "running" });
  const fetchRow = p.all(".tool")[0];
  assert.equal(fetchRow.querySelector(".tool-action")!.textContent, "Fetch");
  assert.equal(fetchRow.querySelector(".tool-target")!.textContent, "docs.example.com", "the site, not the whole address");
  assert.equal(fetchRow.querySelector("summary")!.title, "Fetch https://docs.example.com/guide/setup?x=1");
  p.button("https://docs.example.com/guide/setup?x=1", fetchRow)!.click();
  assert.deepEqual(p.sent.at(-1), { type: "openLink", url: "https://docs.example.com/guide/setup?x=1" });

  p.host({ type: "toolCall", workspace: "wt:fix", id: "w1", name: 'Search "acp protocol"', args: JSON.stringify({ query: "acp protocol" }), kind: "fetch", status: "running" });
  p.host({ type: "toolResult", workspace: "wt:fix", id: "w1", name: "search", output: "Agent Client Protocol (https://agentclientprotocol.com/)\nZed docs (https://zed.dev/docs/ai)" });
  const searchRow = p.all(".tool")[1];
  assert.equal(searchRow.querySelector(".tool-hits")!.textContent, "2 results");
  const hits = [...searchRow.querySelectorAll<HTMLButtonElement>(".tool-hit")];
  assert.deepEqual(hits.map((h) => [h.querySelector(".tool-hit-title")!.textContent, h.querySelector(".tool-hit-site")!.textContent]), [["Agent Client Protocol", "agentclientprotocol.com"], ["Zed docs", "zed.dev"]]);
  hits[1].click();
  assert.deepEqual(p.sent.at(-1), { type: "openLink", url: "https://zed.dev/docs/ai" });
  assert.equal(searchRow.querySelector(".tool-output"), null, "the raw lines aren't repeated");
  assert.equal(p.doc.querySelectorAll("img").length, 0, "nothing is loaded from the web: no favicons");

  p.host({ type: "toolCall", workspace: "wt:fix", id: "f2", name: "Fetch javascript:alert(1)", args: JSON.stringify({ url: "javascript:alert(1)" }), kind: "fetch", status: "running" });
  assert.equal(p.all(".tool")[2].querySelector(".tool-site"), null, "only http(s) pages get a site chip and a link");

  const k = loadPanel();
  k.host(workspaces([MAIN]));
  k.host({ type: "toolCall", workspace: "main", id: "n1", name: "browser_navigate", args: JSON.stringify({ url: "http://localhost:5173/login" }) });
  assert.deepEqual([k.doc.querySelector(".tool-action")!.textContent, k.doc.querySelector(".tool-site")!.textContent], ["Opening", "localhost"], "kernl's browser shows the site too");
});

test("drag and drop: the composer names the ways in; a drag over the panel marks the drop target until it leaves or drops", () => {
  const p = loadPanel();
  p.host(workspaces([MAIN]));
  assert.match(p.doc.querySelector<HTMLTextAreaElement>(".input")!.placeholder, /@ to add files/, "the way that always works (Explorer drags are broken upstream)");
  assert.match(p.button("Add files or folders")!.title, /right-click, Add to kernl chat/, "the tooltip names the Explorer's way in; the label stays short");
  const app = p.doc.getElementById("app")!;
  const fire = (type: string, target: Element = app) => {
    const e = new p.window.Event(type, { bubbles: true, cancelable: true }) as any;
    e.dataTransfer = { getData: () => "", types: ["Files"], files: [] };
    e.relatedTarget = type === "dragleave" && target !== app ? app : null;
    target.dispatchEvent(e);
    return e;
  };
  const hint = p.doc.querySelector<HTMLElement>(".drop-hint")!;
  assert.equal(fire("dragenter").defaultPrevented, true, "taken, so VS Code doesn't hand a Finder drag back to the workbench");
  fire("dragenter", p.doc.querySelector(".input")!); // entering a child element
  assert.equal(hint.hidden, false);
  assert.ok(p.doc.querySelector(".composer")!.classList.contains("drop-target"));
  fire("dragleave", p.doc.querySelector(".input")!);
  assert.equal(hint.hidden, false, "still over the panel");
  fire("dragleave");
  assert.equal(hint.hidden, true);
});

test("drag and drop: Explorer items go to the host; a Finder text file is attached by content; a drop with nothing usable says why and is logged", async () => {
  const p = loadPanel();
  p.host(workspaces([MAIN]));
  const app = p.doc.getElementById("app")!;
  const drop = (dataTransfer: any) => {
    const e = new p.window.Event("drop", { bubbles: true, cancelable: true }) as any;
    e.dataTransfer = dataTransfer;
    app.dispatchEvent(e);
  };
  const settle = () => new Promise((r) => setTimeout(r, 20));
  drop({ getData: (t: string) => (t === "application/vnd.code.uri-list" ? "file:///ws/src/a.ts\nfile:///ws/docs" : ""), types: ["application/vnd.code.uri-list"], files: [] });
  assert.deepEqual(p.sent.at(-1), { type: "dropUris", uris: ["file:///ws/src/a.ts", "file:///ws/docs"] }, "every item, folders included");

  drop({ getData: () => "", types: ["Files"], files: [new File(["# Notes\n"], "notes.md", { type: "text/markdown" })] });
  await settle();
  assert.deepEqual([...p.doc.querySelectorAll(".attachments .chip-text")].map((c) => c.textContent), ["notes.md"]);

  const before = p.sent.length;
  drop({ getData: () => "", types: ["Files"], files: [new File([new Uint8Array([0x89, 0x50, 0, 0])], "logo.png", { type: "image/png" })] });
  await settle();
  const note = p.doc.querySelector<HTMLElement>(".drop-note")!;
  assert.equal(note.hidden, false);
  assert.match(note.textContent!, /Couldn't attach logo\.png \(not text\)\. Drag workspace files from the Explorer instead\./);
  assert.deepEqual(p.sent.slice(before), [{ type: "dropIgnored", types: ["Files"] }], "the host logs what it carried");

  // From Finder, a drop carries the files and their file:// links: the files are read by content.
  drop({ getData: (t: string) => (t === "text/uri-list" ? "file:///Users/m/Desktop/todo.txt" : ""), types: ["Files", "text/uri-list"], files: [new File(["buy milk\n"], "todo.txt", { type: "text/plain" })] });
  await settle();
  assert.ok([...p.doc.querySelectorAll(".attachments .chip-text")].some((c) => c.textContent === "todo.txt"), "attached by content, not refused as outside the workspace");

  // A link from a browser goes to the host, which says why it can't attach it.
  drop({ getData: (t: string) => (t === "text/uri-list" ? "https://example.com/page" : ""), types: ["text/uri-list"], files: [] });
  assert.deepEqual(p.sent.at(-1), { type: "dropUris", uris: ["https://example.com/page"] });

  // Dropping the same file again after editing it: the newer text replaces the older.
  drop({ getData: () => "", types: ["Files"], files: [new File(["# Notes v2\n"], "notes.md", { type: "text/markdown" })] });
  await settle();
  assert.equal([...p.doc.querySelectorAll(".attachments .chip-text")].filter((c) => c.textContent === "notes.md").length, 1);
});

test("drag and drop: moving text within the composer isn't the panel's drop; it keeps the browser's behavior", () => {
  const p = loadPanel();
  p.host(workspaces([MAIN]));
  const app = p.doc.getElementById("app")!;
  const textDrag = (type: string) => {
    const e = new p.window.Event(type, { bubbles: true, cancelable: true }) as any;
    e.dataTransfer = { getData: (t: string) => (t === "text/plain" ? "some words" : ""), types: ["text/plain"], files: [] };
    app.dispatchEvent(e);
    return e;
  };
  assert.equal(textDrag("dragenter").defaultPrevented, false);
  assert.equal(p.doc.querySelector<HTMLElement>(".drop-hint")!.hidden, true, "no drop target for moving text");
  const before = p.sent.length;
  assert.equal(textDrag("drop").defaultPrevented, false, "the text is inserted where it's dropped");
  assert.equal(p.sent.length, before);
});

test("new output follows the transcript only when you're at its end; your own message always scrolls to it", () => {
  const p = loadPanel();
  p.host(workspaces([MAIN]));
  p.host({ type: "userMessage", workspace: "main", text: "first" });
  const log = p.visibleLog();
  // jsdom has no layout: a 1000 px transcript in a 300 px view.
  Object.defineProperty(log, "scrollHeight", { configurable: true, get: () => 1000 });
  Object.defineProperty(log, "clientHeight", { configurable: true, get: () => 300 });
  log.scrollTop = 200; // reading further up
  p.host({ type: "text", workspace: "main", delta: "more output" });
  assert.equal(log.scrollTop, 200, "reading isn't interrupted");
  log.scrollTop = 690; // at the end (within 40 px)
  p.host({ type: "text", workspace: "main", delta: " and more" });
  assert.equal(log.scrollTop, 1000, "at the end, new output follows");
  log.scrollTop = 100;
  p.host({ type: "userMessage", workspace: "main", text: "second" });
  assert.equal(log.scrollTop, 1000, "your own message scrolls to the end");
});

test("a failed row keeps 'Failed:' when the agent updates it after the result", () => {
  const p = loadPanel();
  p.host(workspaces([WT]));
  const call = { type: "toolCall" as const, workspace: "wt:fix", id: "x1", name: "grep x", args: "{}", kind: "execute", command: "grep -n x src", description: "Find usages of x" };
  p.host({ ...call, status: "running" });
  p.host({ type: "toolResult", workspace: "wt:fix", id: "x1", name: "grep x", output: "boom", failed: true });
  p.host(call); // the late update: same call, no status
  const row = p.doc.querySelector<HTMLElement>(".tool")!;
  assert.equal(row.querySelector(".tool-action")!.textContent, "Failed: Find usages of x");
  assert.equal(row.dataset.status, "failed");
});

const connections = (): HostToPanel & { type: "connections" } => ({
  type: "connections",
  items: [
    { id: "agent:codex", kind: "agent", owner: "Codex", label: "Codex", state: "needsAction", detail: "Codex isn't logged in", source: "codex login status", checkedAt: Date.now() - 12_000, fix: { label: "Log in", action: "login", target: "codex" } },
    { id: "agent:claude-code", kind: "agent", owner: "Claude Code", label: "Claude Code", state: "ready", detail: "Logged in: claude.ai login (max)", source: "claude auth status", checkedAt: Date.now(), checking: true },
    { id: "key:anthropic", kind: "providerKey", owner: "kernl", label: "anthropic key", state: "needsAction", detail: "anthropic refused the key (HTTP 401)", source: "key check (GET /models)", checkedAt: Date.now(), fix: { label: "Set key", action: "setKey", target: "anthropic" } },
    { id: "mcp:claude-code:notion", kind: "mcp", owner: "Claude Code", label: "notion", state: "needsAction", detail: "Needs authentication", source: "claude mcp list", checkedAt: Date.now() },
    { id: "mcp:kernl:docs", kind: "mcp", owner: "kernl", label: "docs", state: "failed", detail: "connection refused", source: "kernl agent", checkedAt: Date.now() },
    { id: "plugin:claude-code:render@m", kind: "plugin", owner: "Claude Code", label: "render", state: "off", detail: "Installed, turned off", source: "claude plugin list", checkedAt: Date.now() },
  ],
});

test("Connections: groups rows by kind and agent, with state, what the source said, when, and a fix button that asks the host", () => {
  const p = loadPanel();
  p.host(workspaces([MAIN]));
  p.host(connections());
  const view = p.doc.querySelector<HTMLElement>(".connections")!;
  assert.equal(view.hidden, true, "updates don't open it");
  p.host({ ...connections(), open: true });
  assert.equal(view.hidden, false);
  assert.deepEqual(p.sent.at(-1), { type: "showConnections" }, "opening asks the host to check everything");
  assert.deepEqual(p.all(".connections .panel-view-group-title").map((t) => t.textContent), ["Agents", "Keys", "MCP servers: Claude Code", "MCP servers: kernl", "Plugins: Claude Code"]);
  const codex = p.doc.querySelector<HTMLElement>('[data-id="agent:codex"]')!;
  assert.equal(codex.querySelector(".connection-state")!.textContent, "Needs you");
  assert.equal(codex.querySelector(".connection-meta")!.textContent, "codex login status · 12 s ago");
  p.button("Log in", codex)!.click();
  assert.deepEqual(p.sent.at(-1), { type: "connectionAction", action: "login", target: "codex" });
  const claude = p.doc.querySelector<HTMLElement>('[data-id="agent:claude-code"]')!;
  assert.equal(claude.dataset.checking, "true");
  assert.equal(claude.querySelector(".connection-state")!.textContent, "Checking…");
  p.button("Check now")!.click();
  assert.deepEqual(p.sent.at(-1), { type: "connectionAction", action: "check", target: "all" });
  view.dispatchEvent(new p.window.KeyboardEvent("keydown", { key: "Escape", bubbles: true }));
  assert.equal(view.hidden, true);
});

test("an agent that needs setup gets a warning button beside the chip that opens Connections at that agent", () => {
  const p = loadPanel();
  p.host(workspaces([{ ...MAIN, harness: "codex" }]));
  p.host(connections());
  const setup = p.doc.querySelector<HTMLButtonElement>(".chip.setup")!;
  assert.equal(setup.hidden, false);
  assert.match(setup.title, /codex login/);
  setup.click();
  assert.equal(p.doc.querySelector<HTMLElement>(".connections")!.hidden, false);
  assert.deepEqual(p.sent.at(-1), { type: "showConnections", focus: "agent:codex" });
  assert.ok(p.doc.querySelector('[data-id="agent:codex"]')!.classList.contains("focused"));
  p.host(workspaces([MAIN]));
  assert.equal(setup.hidden, true, "a ready agent has no warning button");
});

test("Connections text from the host is never HTML", () => {
  const p = loadPanel();
  p.host({ type: "connections", open: true, items: [{ id: "mcp:x:<img>", kind: "mcp", owner: "x", label: "<img src=x onerror=alert(1)>", state: "failed", detail: "<b>bold</b>", source: "s", checkedAt: Date.now() }] } as HostToPanel);
  assert.equal(p.doc.querySelectorAll(".connections img, .connections b").length, 0);
  assert.equal(p.doc.querySelector(".connection-label")!.textContent, "<img src=x onerror=alert(1)>");
});

test("the agent chip and its setup warning sit in the bottom row between the workspace and mode chips, not in the toolbar", () => {
  const p = loadPanel();
  p.host(STATUS);
  p.host(workspaces([MAIN]));
  const footer = [...p.doc.querySelectorAll(".footer .chip")].map((c) => c.className);
  const at = (cls: string) => footer.findIndex((c) => c.split(" ").includes(cls));
  assert.ok(at("workspace") < at("setup") && at("setup") < at("harness") && at("harness") < at("mode"), footer.join(" | "));
  assert.equal(p.doc.querySelector(".toolbar .harness"), null);
  assert.equal(p.doc.querySelector(".toolbar .setup"), null);
});

test("the agent chip shows the kernl mark for kernl and a terminal for a CLI agent; the model chip shows the model's name without its provider prefix", () => {
  const p = loadPanel();
  p.host({ ...STATUS, provider: "custom:gateway", model: "litellm/GPT-5.6 Sol" });
  p.host(workspaces([MAIN, WT]));
  const agent = p.doc.querySelector<HTMLButtonElement>(".harness")!;
  const model = p.doc.querySelector<HTMLButtonElement>(".model")!;
  assert.ok(agent.firstElementChild!.classList.contains("kernl-mark"), "kernl's own agent");
  assert.equal(model.textContent, "GPT-5.6 Sol");
  assert.match(model.title, /custom:gateway · litellm\/GPT-5.6 Sol/, "the full id stays in the tooltip");
  p.host(workspaces([MAIN, WT], "wt:fix"));
  assert.equal(agent.firstElementChild!.tagName.toLowerCase(), "svg", "a CLI agent: the terminal icon");
});

test("Send is a plain icon button like +: dimmed with nothing to send, the arrow in the accent color with text, the stop square while the agent runs", () => {
  const p = loadPanel();
  p.host(workspaces([MAIN]));
  const sendButton = p.doc.querySelector<HTMLButtonElement>(".send")!;
  const input = p.doc.querySelector<HTMLTextAreaElement>(".input")!;
  assert.equal(sendButton.className, p.doc.querySelector(".attach")!.className.replace("attach", "send"), "the same kind of button as +");
  assert.equal(p.doc.querySelector(".send-group"), null, "no pill");
  assert.deepEqual([sendButton.disabled, sendButton.classList.contains("ready")], [true, false], "empty: dimmed");
  input.value = "hi";
  input.dispatchEvent(new p.window.Event("input"));
  assert.deepEqual([sendButton.disabled, sendButton.classList.contains("ready")], [false, true], "text: ready");
  input.value = "";
  input.dispatchEvent(new p.window.Event("input"));
  p.host(workspaces([{ ...MAIN, running: true }]));
  assert.deepEqual([sendButton.disabled, sendButton.classList.contains("ready"), sendButton.classList.contains("stop")], [false, false, true], "running: Stop");
});

test("the unsent message is sent to the host a moment after it changes and cleared on send; a saved draft fills only an empty box", async () => {
  const p = loadPanel();
  p.host(workspaces([MAIN]));
  const input = p.doc.querySelector<HTMLTextAreaElement>(".input")!;
  input.value = "open browser and look for brevo loyalty apis";
  input.dispatchEvent(new p.window.Event("input"));
  assert.ok(!p.sent.some((m) => m.type === "draft"), "not on every keystroke");
  await tick(450);
  assert.deepEqual(p.sent.filter((m) => m.type === "draft").at(-1), { type: "draft", text: "open browser and look for brevo loyalty apis", attachments: [] });
  input.dispatchEvent(new p.window.KeyboardEvent("keydown", { key: "Enter", cancelable: true }));
  assert.deepEqual(p.sent.filter((m) => m.type === "draft").at(-1), { type: "draft", text: "", attachments: [] }, "sent: the draft is cleared at once");
  p.host({ type: "restoreDraft", text: "look at @src/a.ts", attachments: [{ path: "src/a.ts", kind: "file" }] });
  assert.equal(input.value, "look at @src/a.ts");
  assert.ok(p.doc.querySelector(".input-layer .mention"), "the file is recognized again");
  input.value = "typed since";
  p.host({ type: "restoreDraft", text: "older draft", attachments: [] });
  assert.equal(input.value, "typed since", "never over what was typed");
});
