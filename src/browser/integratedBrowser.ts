import * as vscode from "vscode";
import WebSocket from "ws";
import { assertNavigableUrl } from "./urlPolicy";

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

  /** `timeoutMs` is read for every call: how long one browser action (or a page load) may take. */
  constructor(private timeoutMs: () => number = () => 30_000) {}

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
    // A session left from a closed tab or a dropped connection is ended before a new one starts.
    if (this.session) await vscode.debug.stopDebugging(this.session.parentSession ?? this.session).then(undefined, () => undefined);
    this.session = undefined;
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
    const launched = await vscode.debug.startDebugging(
      undefined,
      { type: "editor-browser", request: "launch", name: "kernl Browser", url: "about:blank" },
      { noDebug: true, suppressDebugToolbar: true, suppressDebugView: true, suppressDebugStatusbar: true } as vscode.DebugSessionOptions,
    );
    if (!launched) throw new Error("VS Code refused to start the integrated browser (editor-browser debug session)");
    this.session = await child;
    const proxy = await this.session.customRequest("requestCDPProxy");
    const ws = new WebSocket(`ws://${proxy.host}:${proxy.port}${proxy.path ?? ""}`);
    await new Promise<void>((resolve, reject) => {
      ws.once("open", () => resolve());
      ws.once("error", reject);
    });
    // After it opens, an error is followed by "close", which fails the waiting calls; nothing else to do.
    ws.on("error", () => {});
    ws.on("message", (raw) => {
      const msg = JSON.parse(String(raw));
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
    this.ws?.close();
    if (this.session) await vscode.debug.stopDebugging(this.session.parentSession ?? this.session);
    this.session = undefined;
  }
}
