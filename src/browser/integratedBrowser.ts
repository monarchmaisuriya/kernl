import * as vscode from "vscode";
import WebSocket from "ws";
import { type AxNode, type FrameTree, outline, type Snapshot, type SnapshotRef } from "./snapshot";
import { assertNavigableUrl } from "./urlPolicy";

/**
 * Called just before kernl brings its tab to the front (which takes keyboard focus); the function it
 * returns puts focus back and says where ("their editor"), or undefined when it couldn't.
 */
export type FocusReturn = () => () => Promise<string | undefined>;

/** Focus goes back to the text editor that had it; anything else (a terminal, another view) can't be told apart, so it stays. */
export const editorFocusReturn: FocusReturn = () => {
  const tab = vscode.window.tabGroups.activeTabGroup.activeTab;
  if (!(tab?.input instanceof vscode.TabInputText)) return async () => undefined;
  const { uri } = tab.input;
  const viewColumn = tab.group.viewColumn;
  return async () => (await vscode.window.showTextDocument(uri, { viewColumn, preserveFocus: false }), "their editor");
};

/** How an action's input reached the page; `note` says what kernl had to do about its tab, for the agent. */
export interface InputResult {
  via: "input" | "script";
  note?: string;
}

/** VS Code's commands that focus editor group 1 to 8. */
const FOCUS_GROUP = ["First", "Second", "Third", "Fourth", "Fifth", "Sixth", "Seventh", "Eighth"].map((n) => `workbench.action.focus${n}EditorGroup`);
const sleep = (ms: number) => new Promise((r) => setTimeout(r, ms));
/** Frames a snapshot reads (ads and embeds can nest many). */
const MAX_FRAMES = 10;

/**
 * Run on an element: what a click at (x, y), in the top page's coordinates, would hit instead of it (""
 * when it's the element or inside it). In a frame, each page from the top down must hit the frame at that
 * point, and the point moves into the frame; Shadow DOM is searched from the element's own root. A frame
 * from another site can't be looked into from here: its element isn't checked.
 */
const HIT_TEST = `function(x, y) {
  const describe = (hit) => {
    if (!hit) return "it isn't on screen";
    const text = (hit.getAttribute("aria-label") || hit.textContent || "").replace(/\\s+/g, " ").trim().slice(0, 60);
    return "it's covered by <" + hit.tagName.toLowerCase() + (hit.id ? "#" + hit.id : "") + ">" + (text ? " \\"" + text + "\\"" : "");
  };
  const frames = [];
  for (let w = window; w !== w.top; w = w.parent) {
    let frame = null;
    try { frame = w.frameElement; } catch {}
    if (!frame) return "";
    frames.unshift(frame);
  }
  let px = x, py = y;
  for (const frame of frames) {
    const hit = frame.ownerDocument.elementFromPoint(px, py);
    if (hit !== frame) return describe(hit);
    const r = frame.getBoundingClientRect(), s = frame.ownerDocument.defaultView.getComputedStyle(frame);
    px -= r.left + frame.clientLeft + parseFloat(s.paddingLeft);
    py -= r.top + frame.clientTop + parseFloat(s.paddingTop);
  }
  const root = this.getRootNode();
  const hit = (typeof root.elementFromPoint === "function" ? root : document).elementFromPoint(px, py);
  return hit === this || (hit && this.contains(hit)) ? "" : describe(hit);
}`;

/** Run in the page: the document holding keyboard focus, inside same-site frames (where a key press arrives). */
const FOCUSED_DOCUMENT = `(() => { let d = document; for (;;) { const a = d.activeElement; let inner = null; try { inner = a && a.tagName === "IFRAME" ? a.contentDocument : null; } catch {} if (!inner) return d; d = inner; } })()`;

/** A console error, an uncaught exception, or a failed request, collected between actions. */
export interface PageEvent {
  kind: "console" | "exception" | "request";
  text: string;
}

/**
 * VS Code's integrated browser, driven over CDP. The only file that knows the mechanism:
 * an "editor-browser" debug session (stable debug API) whose page session answers js-debug's
 * "requestCDPProxy" request with a WebSocket. That request is not a documented VS Code API,
 * so test/vscode/browser.test.ts guards it; swap to the proposed `browser` API here once stable.
 */
export class IntegratedBrowser implements vscode.Disposable {
  private ws: WebSocket | undefined;
  private session: vscode.DebugSession | undefined;
  /** The connection being made; calls that arrive meanwhile share it instead of opening a second tab. */
  private connecting: Promise<void> | undefined;
  private nextId = 1;
  private pending = new Map<number, { resolve: (v: any) => void; reject: (e: Error) => void }>();
  /** Every CDP method sent, in order. Lets tests prove a rejected action sent nothing. */
  readonly sentMethods: string[] = [];
  /** Element references from this page's snapshots (ref -> the page's node); a navigation makes them stale. */
  private refs = new Map<string, SnapshotRef>();
  /** Each element's ref (page node -> ref), so every snapshot gives it the same one. */
  private refByNode = new Map<number, string>();
  /** Refs are numbered for the browser's whole life: a ref is never given to another element, even on another page. */
  private refCount = 0;
  private refOf = (backendNodeId: number) => {
    let ref = this.refByNode.get(backendNodeId);
    if (!ref) (ref = `e${++this.refCount}`), this.refByNode.set(backendNodeId, ref);
    return ref;
  };
  private events: PageEvent[] = [];
  /** kernl's browser tab, as VS Code reported it opening (VS Code keeps the same object while it's open). */
  private tab: vscode.Tab | undefined;
  /** Requests in flight, for waiting until the page settles after an action. */
  private inflight = new Set<string>();

  /**
   * A session that ends on its own (the user closed the tab) is forgotten, so the next call opens a new
   * tab. Its connection is closed too: js-debug keeps the proxy's WebSocket open after the page is gone.
   */
  private sessionEnded = vscode.debug.onDidTerminateDebugSession((s) => {
    if (!this.session || (s !== this.session && s !== this.session.parentSession)) return;
    this.session = undefined;
    this.tab = undefined;
    this.ws?.close();
  });

  /**
   * `timeoutMs` is read for every call: how long one browser action (or a page load) may take.
   * `returnFocus` says where keyboard focus goes back after kernl brings its tab to the front.
   */
  constructor(
    private timeoutMs: () => number = () => 30_000,
    private returnFocus: FocusReturn = editorFocusReturn,
  ) {}

  get sessionType(): string | undefined {
    return this.session?.type;
  }

  /** Connects on first use, and again after the tab was closed or its connection dropped. */
  private connect(): Promise<void> {
    if (this.ws?.readyState === WebSocket.OPEN) return Promise.resolve();
    this.connecting ??= this.open().finally(() => (this.connecting = undefined));
    return this.connecting;
  }

  private async open(): Promise<void> {
    // A dropped connection to a tab that's still open reconnects to that tab, so no second tab opens.
    if (this.session) {
      const ws = await this.proxy(this.session).catch(() => undefined);
      if (ws) return this.attach(ws);
      await this.stopSession();
    }
    const child = new Promise<vscode.DebugSession>((resolve, reject) => {
      const timer = setTimeout(() => {
        sub.dispose();
        reject(new Error("VS Code did not start an integrated browser page session within 15 s"));
      }, 15_000);
      const sub = vscode.debug.onDidStartDebugSession((s) => {
        if (!s.parentSession || !/editor-browser/.test(s.type)) return;
        clearTimeout(timer);
        sub.dispose();
        resolve(s);
      });
    });
    // The first browser tab VS Code opens after the launch is the session's (VS Code shows browser tabs to
    // extensions with no input type); the event can come after the session starts, so it's watched a while.
    this.tab = undefined;
    const watch = vscode.window.tabGroups.onDidChangeTabs((e) => {
      const tab = e.opened.find((t) => t.input === undefined);
      if (tab) (this.tab = tab), watch.dispose();
    });
    setTimeout(() => watch.dispose(), 10_000);
    const launched = await vscode.debug.startDebugging(
      undefined,
      { type: "editor-browser", request: "launch", name: "kernl Browser", url: "about:blank" },
      { noDebug: true, suppressDebugToolbar: true, suppressDebugView: true, suppressDebugStatusbar: true } as vscode.DebugSessionOptions,
    );
    if (!launched) {
      watch.dispose();
      throw new Error("VS Code refused to start the integrated browser (editor-browser debug session)");
    }
    this.session = await child;
    await this.attach(await this.proxy(this.session));
  }

  /** A WebSocket to the tab's page, through js-debug's CDP proxy. */
  private async proxy(session: vscode.DebugSession): Promise<WebSocket> {
    const proxy = await session.customRequest("requestCDPProxy");
    const ws = new WebSocket(`ws://${proxy.host}:${proxy.port}${proxy.path ?? ""}`);
    await new Promise<void>((resolve, reject) => {
      ws.once("open", () => resolve());
      ws.once("error", reject);
    });
    return ws;
  }

  private async attach(ws: WebSocket): Promise<void> {
    // After it opens, an error is followed by "close", which fails the waiting calls; nothing else to do.
    ws.on("error", () => {});
    ws.on("message", (raw) => {
      const msg = JSON.parse(String(raw));
      if (msg.id === undefined && msg.method) return this.onEvent(msg.method, msg.params ?? {});
      const waiter = msg.id !== undefined ? this.pending.get(msg.id) : undefined;
      if (!waiter) return;
      this.pending.delete(msg.id);
      if (msg.error) waiter.reject(new Error(`CDP ${msg.error.code}: ${msg.error.message}`));
      else waiter.resolve(msg.result);
    });
    ws.on("close", () => {
      for (const w of this.pending.values()) w.reject(new Error("The integrated browser tab was closed"));
      this.pending.clear();
      this.ws = undefined;
    });
    this.ws = ws;
    // Console errors, uncaught exceptions, and failed requests are reported with the next action's result.
    // js-debug shares its connection to the tab, so its proxy forwards events only to a client that
    // subscribes to them (JsDebug.subscribe); enabling a domain alone delivers none.
    // Without it the connection can't report page changes, so it isn't kept.
    await this.send("JsDebug.subscribe", { events: ["Runtime.*", "Log.*", "Network.*", "Page.*"] }).catch((err) => {
      ws.close();
      throw new Error(`The integrated browser's debugger didn't let kernl follow the page (JsDebug.subscribe: ${err.message})`);
    });
    for (const domain of ["Runtime.enable", "Log.enable", "Network.enable", "Page.enable"]) await this.send(domain).catch(() => {});
  }

  /** Ends the debug session; one that already ended (its tab was closed) counts as stopped. */
  private async stopSession(): Promise<void> {
    const session = this.session;
    this.session = undefined;
    this.tab = undefined;
    if (session) await vscode.debug.stopDebugging(session.parentSession ?? session).then(undefined, () => undefined);
  }

  private onEvent(method: string, p: any) {
    const add = (e: PageEvent) => this.events.length < 50 && this.events.push({ ...e, text: e.text.slice(0, 300) });
    switch (method) {
      case "Runtime.consoleAPICalled":
        if (p.type === "error" || p.type === "assert") add({ kind: "console", text: (p.args ?? []).map((a: any) => a.value ?? a.description ?? "").join(" ") });
        return;
      case "Runtime.exceptionThrown":
        add({ kind: "exception", text: p.exceptionDetails?.exception?.description ?? p.exceptionDetails?.text ?? "exception" });
        return;
      case "Log.entryAdded":
        if (p.entry?.level === "error") add({ kind: "console", text: p.entry.text ?? "" });
        return;
      case "Network.requestWillBeSent":
        this.inflight.add(p.requestId);
        return;
      case "Network.responseReceived":
        if (p.response?.status >= 400) add({ kind: "request", text: `${p.response.status} ${p.response.url}` });
        return;
      case "Network.loadingFinished":
        this.inflight.delete(p.requestId);
        return;
      case "Network.loadingFailed":
        this.inflight.delete(p.requestId);
        if (!p.canceled) add({ kind: "request", text: `failed (${p.errorText}) ${p.type ?? ""}`.trim() });
        return;
      case "Page.frameNavigated":
        // The page navigated: every ref is stale. A frame navigated: its refs are (another snapshot gives its new ones).
        if (!p.frame?.parentId) this.refs.clear(), this.refByNode.clear();
        else for (const [ref, n] of this.refs) if (n.frameId === p.frame.id) this.refs.delete(ref);
        return;
    }
  }

  /** Console errors and failed requests since the last call. */
  takeEvents(): PageEvent[] {
    return this.events.splice(0);
  }

  /** Waits until the page has loaded and its network has been quiet for 500 ms (at most `maxMs`). */
  async settle(maxMs = 5_000): Promise<void> {
    const deadline = Date.now() + maxMs;
    let quietSince = Date.now();
    while (Date.now() < deadline) {
      const ready = await this.evaluate<string>("document.readyState").catch(() => "loading");
      if (ready !== "complete" || this.inflight.size) quietSince = Date.now();
      else if (Date.now() - quietSince >= 500) return;
      await new Promise((r) => setTimeout(r, 100));
    }
  }

  /** The page as an outline of what a person sees and can act on, each element with a ref for the actions. */
  async snapshot(): Promise<Snapshot> {
    const { nodes } = await this.send("Accessibility.getFullAXTree");
    const page = await this.evaluate<{ href: string; title: string }>("({href: location.href, title: document.title})");
    const snap = outline(nodes as AxNode[], page, this.refOf, await this.frameTrees());
    for (const [ref, node] of snap.refs) this.refs.set(ref, node);
    return snap;
  }

  /**
   * The page's frames, nested ones too (up to MAX_FRAMES), each with its tree; a frame from another site
   * runs in its own process, which this connection can't read, so it comes without one.
   */
  private async frameTrees(): Promise<FrameTree[]> {
    const { frameTree } = await this.send("Page.getFrameTree");
    const frames: { id: string; url: string }[] = [];
    const walk = (t: any) => {
      for (const c of t.childFrames ?? []) if (frames.length < MAX_FRAMES) (frames.push({ id: c.frame.id, url: c.frame.url }), walk(c));
    };
    walk(frameTree);
    return Promise.all(frames.map(async (f) => ({ id: f.id, url: f.url, nodes: (await this.send("Accessibility.getFullAXTree", { frameId: f.id }).catch(() => undefined))?.nodes as AxNode[] | undefined })));
  }

  /** A ref from this page's snapshots, or why it can't be used. */
  private node(ref: string) {
    const n = this.refs.get(ref);
    if (!n) throw new Error(`No element ${ref} on this page (it changed since that snapshot): take a new browser_snapshot.`);
    return n;
  }

  /** The element a ref names on the page, for approval cards: 'button "Accept all"'; undefined for an unknown ref. */
  describeRef(ref: string): string | undefined {
    const n = this.refs.get(ref);
    return n ? `${n.role}${n.name ? ` "${n.name}"` : ""}` : undefined;
  }

  /**
   * Real input (a click, a key, typed text), checked by `attempt` to have reached the page. VS Code
   * sometimes stops passing real input to a browser tab that isn't in front (seen after browser debug
   * sessions were restarted); kernl then brings its tab to the front (which takes keyboard focus), tries
   * again, and puts focus back.
   */
  private async withRealInput(attempt: () => Promise<boolean>): Promise<{ ok: boolean; note?: string }> {
    if (await attempt()) return { ok: true };
    const restore = this.returnFocus();
    if (!(await this.showTab())) return { ok: false, note: "kernl's browser tab wasn't taking input, and kernl couldn't bring it to the front" };
    let ok = false;
    let back: string | undefined;
    try {
      ok = await attempt();
    } finally {
      // Focus goes back even when the retry fails (an element found covered once the tab is in front).
      back = await restore().catch(() => undefined);
    }
    const focus = back ? `and put the user's focus back in ${back}` : "and the user's focus stayed on that tab";
    return { ok, note: `kernl's browser tab wasn't taking input: kernl brought it to the front ${focus}` };
  }

  /** Shows kernl's tab in its editor group (focusing that group); false when it isn't open or can't be shown. */
  private async showTab(): Promise<boolean> {
    const tab = this.tab;
    const index = tab ? tab.group.tabs.indexOf(tab) : -1;
    const focusGroup = tab ? FOCUS_GROUP[tab.group.viewColumn - 1] : undefined;
    if (!tab || index < 0 || !focusGroup) return false;
    await vscode.commands.executeCommand(focusGroup);
    await vscode.commands.executeCommand("workbench.action.openEditorAtIndex", index);
    await sleep(300);
    return tab.group.activeTab === tab;
  }

  /** The note for an action that fell back to the page's script. */
  private scriptNote(note: string | undefined) {
    return `${note ?? "kernl's browser tab wasn't taking input"}; kernl used the page's script instead (some pages ignore that)`;
  }

  /**
   * Clicks an element with real mouse events at its center (scrolled into view), checking the element got
   * the click; one that didn't, even with kernl's tab in front, is clicked through the page's script.
   * Something else at that point (a banner, a dialog, a sticky bar) isn't clicked: the error says what's there.
   */
  async clickRef(ref: string): Promise<InputResult> {
    const { backendNodeId } = this.node(ref);
    const { object } = await this.send("DOM.resolveNode", { backendNodeId });
    const real = await this.withRealInput(async () => {
      await this.send("DOM.scrollIntoViewIfNeeded", { backendNodeId }).catch(() => {});
      // Marked in the element's own window (a frame's, for an element in a frame).
      await this.send("Runtime.callFunctionOn", { objectId: object.objectId, functionDeclaration: "function(){ window.__kernlClicked = false; this.addEventListener('click', () => (window.__kernlClicked = true), { once: true, capture: true }); }" });
      const { model } = await this.send("DOM.getBoxModel", { backendNodeId });
      const q = model.content as number[];
      const x = (q[0] + q[2] + q[4] + q[6]) / 4;
      const y = (q[1] + q[3] + q[5] + q[7]) / 4;
      const covered = await this.send("Runtime.callFunctionOn", { objectId: object.objectId, functionDeclaration: HIT_TEST, arguments: [{ value: x }, { value: y }], returnByValue: true });
      if (covered.result?.value) throw new Error(`Didn't click ${this.describeRef(ref) ?? ref}: ${covered.result.value}. Close or scroll past it, then take a new browser_snapshot.`);
      await this.send("Input.dispatchMouseEvent", { type: "mouseMoved", x, y });
      await this.send("Input.dispatchMouseEvent", { type: "mousePressed", x, y, button: "left", buttons: 1, clickCount: 1 });
      await this.send("Input.dispatchMouseEvent", { type: "mouseReleased", x, y, button: "left", buttons: 0, clickCount: 1 });
      // A click that loaded a new page arrived too: that page has no mark (undefined, not false), or can't be asked yet.
      const arrived = await this.send("Runtime.callFunctionOn", { objectId: object.objectId, functionDeclaration: "function(){ return window.__kernlClicked !== false; }", returnByValue: true }).catch(() => undefined);
      return arrived?.result?.value !== false;
    });
    if (real.ok) return { via: "input", note: real.note };
    await this.send("Runtime.callFunctionOn", { objectId: object.objectId, functionDeclaration: "function(){ this.click(); }" });
    return { via: "script", note: this.scriptNote(real.note) };
  }

  /**
   * Types into a field like a person: focus, replace what's there, insert the text as real input (so
   * pages that track keystrokes, React ones included, see it); a field that still doesn't hold it gets
   * the value set through the page's own setter. Enter afterwards when `submit`.
   */
  async typeRef(ref: string, text: string, submit = false): Promise<InputResult> {
    const { backendNodeId } = this.node(ref);
    const { object } = await this.send("DOM.resolveNode", { backendNodeId });
    const call = (fn: string, args: unknown[] = []) => this.send("Runtime.callFunctionOn", { objectId: object.objectId, functionDeclaration: fn, arguments: args.map((value) => ({ value })), returnByValue: true });
    const real = await this.withRealInput(async () => {
      await this.send("DOM.scrollIntoViewIfNeeded", { backendNodeId }).catch(() => {});
      await this.send("DOM.focus", { backendNodeId });
      await call("function(){ if (typeof this.select === 'function') this.select(); else if (this.isContentEditable) document.execCommand('selectAll'); }");
      await this.send("Input.insertText", { text });
      const held = await call("function(t){ const v = 'value' in this ? this.value : this.textContent; return String(v ?? '').includes(t); }", [text]);
      return held.result?.value === true;
    });
    let result: InputResult = { via: "input", note: real.note };
    if (!real.ok) {
      await call(
        "function(t){ const proto = Object.getPrototypeOf(this); const set = Object.getOwnPropertyDescriptor(proto, 'value')?.set; if (set) set.call(this, t); else this.textContent = t; this.dispatchEvent(new Event('input', {bubbles: true})); this.dispatchEvent(new Event('change', {bubbles: true})); }",
        [text],
      );
      result = { via: "script", note: this.scriptNote(real.note) };
    }
    if (!submit) return result;
    const enter = await this.pressKey("Enter");
    return enter.via === "script" ? enter : { via: result.via, note: result.note ?? enter.note };
  }

  /**
   * Presses a key on the focused element (Enter, Tab, Escape, arrows, Backspace, a letter) as real
   * input, checking the page got it; otherwise the page's script dispatches the key (and Enter in a
   * form submits it).
   */
  async pressKey(key: string): Promise<InputResult> {
    const named: Record<string, { code: string; vk: number; text?: string }> = {
      Enter: { code: "Enter", vk: 13, text: "\r" },
      Tab: { code: "Tab", vk: 9 },
      Escape: { code: "Escape", vk: 27 },
      Backspace: { code: "Backspace", vk: 8 },
      Delete: { code: "Delete", vk: 46 },
      ArrowUp: { code: "ArrowUp", vk: 38 },
      ArrowDown: { code: "ArrowDown", vk: 40 },
      ArrowLeft: { code: "ArrowLeft", vk: 37 },
      ArrowRight: { code: "ArrowRight", vk: 39 },
      PageDown: { code: "PageDown", vk: 34 },
      PageUp: { code: "PageUp", vk: 33 },
      Space: { code: "Space", vk: 32, text: " " },
    };
    const k = named[key] ?? (key.length === 1 ? { code: `Key${key.toUpperCase()}`, vk: key.toUpperCase().charCodeAt(0), text: key } : undefined);
    if (!k) throw new Error(`Unknown key "${key}": use Enter, Tab, Escape, Backspace, Delete, Space, an arrow (ArrowUp...), PageUp, PageDown, or a single character.`);
    const base = { key: key === "Space" ? " " : key, code: k.code, windowsVirtualKeyCode: k.vk };
    const real = await this.withRealInput(async () => {
      // Marked in the window that has keyboard focus (a frame's, when a field in a frame is focused).
      await this.evaluate(`(() => { const w = ${FOCUSED_DOCUMENT}.defaultView; w.__kernlKey = false; w.addEventListener('keydown', () => (w.__kernlKey = true), { once: true, capture: true }); window.__kernlKeyWindow = w; })()`);
      await this.send("Input.dispatchKeyEvent", { type: k.text ? "keyDown" : "rawKeyDown", ...base, ...(k.text ? { text: k.text } : {}) });
      await this.send("Input.dispatchKeyEvent", { type: "keyUp", ...base });
      // A key that loaded a new page (Enter in a form) arrived too: that page has no mark (undefined, not false), or can't be asked yet.
      return this.evaluate<boolean>("(window.__kernlKeyWindow ?? window).__kernlKey !== false").catch(() => true);
    });
    if (real.ok) return { via: "input", note: real.note };
    await this.evaluate(
      `(() => { const doc = ${FOCUSED_DOCUMENT}; const el = doc.activeElement ?? doc.body; const init = { key: ${JSON.stringify(base.key)}, code: ${JSON.stringify(k.code)}, bubbles: true, cancelable: true };
        const go = el.dispatchEvent(new KeyboardEvent('keydown', init)); el.dispatchEvent(new KeyboardEvent('keyup', init));
        if (go && init.key === 'Enter' && el.form && el.tagName !== 'TEXTAREA') el.form.requestSubmit(); })()`,
    );
    return { via: "script", note: this.scriptNote(real.note) };
  }

  /** Scrolls the page up or down by about a screen. */
  async scroll(direction: "up" | "down"): Promise<void> {
    await this.evaluate(`window.scrollBy({ top: ${direction === "down" ? "" : "-"}window.innerHeight * 0.8 })`);
  }

  /** Goes back one page in this tab's history; false when there's nothing to go back to. */
  async back(): Promise<boolean> {
    const { currentIndex, entries } = await this.send("Page.getNavigationHistory");
    if (currentIndex <= 0) return false;
    await this.send("Page.navigateToHistoryEntry", { entryId: entries[currentIndex - 1].id });
    return true;
  }

  /** One CDP call; it fails after the browser timeout instead of waiting forever (a page script that never settles). */
  private async send(method: string, params: Record<string, unknown> = {}): Promise<any> {
    await this.connect();
    this.sentMethods.push(method);
    const id = this.nextId++;
    const timeoutMs = this.timeoutMs();
    return new Promise((resolve, reject) => {
      const timer = setTimeout(() => {
        this.pending.delete(id);
        reject(new Error(`The integrated browser didn't answer ${method} within ${Math.round(timeoutMs / 1000)} s`));
      }, timeoutMs);
      const settle = <T>(fn: (v: T) => void) => (v: T) => (clearTimeout(timer), fn(v));
      this.pending.set(id, { resolve: settle(resolve), reject: settle(reject) });
      this.ws!.send(JSON.stringify({ id, method, params }));
    });
  }

  async evaluate<T>(expression: string): Promise<T> {
    const r = await this.send("Runtime.evaluate", { expression, returnByValue: true, awaitPromise: true });
    if (r.exceptionDetails) throw new Error(`Page script failed: ${r.exceptionDetails.exception?.description ?? r.exceptionDetails.text}`);
    return r.result.value as T;
  }

  async navigate(url: string, timeoutMs = this.timeoutMs()): Promise<void> {
    assertNavigableUrl(url);
    await this.send("Page.navigate", { url });
    const deadline = Date.now() + timeoutMs;
    while (Date.now() < deadline) {
      const s = await this.evaluate<{ href: string; ready: string }>("({href: location.href, ready: document.readyState})").catch(() => undefined);
      if (s && s.href !== "about:blank" && s.ready === "complete") return;
      if (s && url === "about:blank") return;
      await new Promise((r) => setTimeout(r, 150));
    }
    throw new Error(`Page did not finish loading ${url} within ${timeoutMs} ms`);
  }

  async screenshotPng(): Promise<string> {
    const r = await this.send("Page.captureScreenshot", { format: "png" });
    return r.data as string;
  }

  async dispose() {
    this.sessionEnded.dispose();
    // Ending the debug session leaves its tab open; closing the page closes the tab.
    if (this.ws?.readyState === WebSocket.OPEN) await this.send("Page.close").catch(() => {});
    this.ws?.close();
    await this.stopSession();
  }
}
