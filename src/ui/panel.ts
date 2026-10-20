import { randomBytes } from "node:crypto";
import * as vscode from "vscode";
import type { Redactor } from "../log";
import { PanelChannel } from "./panelChannel";
import { type HostToPanel, isPanelToHost, type PanelToHost } from "./protocol";

export const PANEL_VIEW_ID = "kernl.panel";

/**
 * The chat panel. Every outgoing message is scrubbed of API keys; incoming messages are
 * validated against the protocol. Until a webview reports ready, messages are dropped and the
 * host sends a full snapshot on ready (see PanelChannel).
 */
export class AgentPanel implements vscode.WebviewViewProvider {
  private channel = new PanelChannel<HostToPanel>();
  private delivered = new vscode.EventEmitter<HostToPanel>();
  /** Every message that actually reached a ready webview (used by the integration tests). */
  readonly onDidDeliver = this.delivered.event;
  /** Each reveal (it takes keyboard focus), with where it was called from: the integration suite's timeline shows what moved focus. */
  private revealed = new vscode.EventEmitter<string>();
  readonly onDidReveal = this.revealed.event;
  /** Each step of the webview's life (resolved, shown, hidden, ready, disposed): the integration suite's timeline shows when the panel loaded. */
  private lifecycle = new vscode.EventEmitter<string>();
  readonly onLifecycle = this.lifecycle.event;

  private view: vscode.WebviewView | undefined;
  private hidden = new vscode.EventEmitter<void>();
  /** The panel was hidden or closed (an open in-panel menu can't be answered any more). */
  readonly onDidHide = this.hidden.event;

  constructor(private extensionUri: vscode.Uri, private redactor: Redactor, private onMessage: (m: PanelToHost) => void, private previewsDir?: vscode.Uri) {}

  /** Where the webview loads tool images from (see SessionStore.previewsDir), once it exists. */
  previewBase(): string | undefined {
    return this.view && this.previewsDir ? this.view.webview.asWebviewUri(this.previewsDir).toString() : undefined;
  }

  /** True while the panel is on screen and its webview is listening. */
  get visible(): boolean {
    return !!this.view?.visible && this.channel.isReady;
  }

  /** Where the webview is in its life right now, for a listener that subscribes late. */
  lifecycleState(): string {
    return this.view ? `resolved, ${this.view.visible ? "visible" : "hidden"}, ${this.channel.isReady ? "ready" : "not ready"}` : "not resolved";
  }

  resolveWebviewView(view: vscode.WebviewView) {
    this.view = view;
    this.lifecycle.fire(`resolved (${view.visible ? "visible" : "hidden"})`);
    view.onDidChangeVisibility(() => {
      this.lifecycle.fire(view.visible ? "shown" : "hidden");
      if (!view.visible) this.hidden.fire();
    });
    const webview = view.webview;
    this.channel.attach((m) => void webview.postMessage(m));
    // The panel's own files, plus tool images (only that folder of kernl's storage, not the conversations).
    const roots = [vscode.Uri.joinPath(this.extensionUri, "out", "webview"), vscode.Uri.joinPath(this.extensionUri, "media"), ...(this.previewsDir ? [this.previewsDir] : [])];
    webview.options = { enableScripts: true, localResourceRoots: roots };
    webview.html = panelHtml(webview, this.extensionUri);
    webview.onDidReceiveMessage((m) => {
      if (isPanelToHost(m)) this.onMessage(m);
    });
    view.onDidDispose(() => {
      this.lifecycle.fire("disposed");
      this.channel.detach();
      this.view = undefined;
      this.hidden.fire();
    });
  }

  post(message: HostToPanel) {
    const scrubbed = JSON.parse(this.redactor.scrub(JSON.stringify(message))) as HostToPanel;
    if (this.channel.post(scrubbed)) this.delivered.fire(scrubbed);
  }

  /** Called when the webview reports it is ready; the caller then sends status and a snapshot. */
  markReady() {
    this.channel.markReady();
    this.lifecycle.fire("ready");
  }

  async reveal() {
    this.revealed.fire(new Error("reveal").stack?.split("\n").slice(2, 6).map((l) => l.trim()).join(" <- ") ?? "");
    await vscode.commands.executeCommand(`${PANEL_VIEW_ID}.focus`);
  }
}

/** Strict CSP: no inline script, scripts only from the bundle with a per-load nonce, styles only from the extension. */
export function contentSecurityPolicy(cspSource: string, nonce: string): string {
  return [`default-src 'none'`, `img-src ${cspSource} data:`, `style-src ${cspSource}`, `script-src 'nonce-${nonce}'`, `font-src ${cspSource}`].join("; ");
}

function panelHtml(webview: vscode.Webview, extensionUri: vscode.Uri): string {
  const nonce = randomBytes(16).toString("base64");
  const script = webview.asWebviewUri(vscode.Uri.joinPath(extensionUri, "out", "webview", "main.js"));
  const style = webview.asWebviewUri(vscode.Uri.joinPath(extensionUri, "media", "panel.css"));
  return `<!DOCTYPE html>
<html lang="en">
<head>
<meta charset="UTF-8">
<meta http-equiv="Content-Security-Policy" content="${contentSecurityPolicy(webview.cspSource, nonce)}">
<meta name="viewport" content="width=device-width, initial-scale=1.0">
<link rel="stylesheet" href="${style}">
<title>kernl</title>
</head>
<body>
<div id="app"></div>
<script nonce="${nonce}" src="${script}"></script>
</body>
</html>`;
}
