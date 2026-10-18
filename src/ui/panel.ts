import { randomBytes } from "node:crypto";
import * as vscode from "vscode";
import type { Redactor } from "../log";
import { PanelChannel } from "./panelChannel";
import { type HostToPanel, isPanelToHost, type PanelToHost } from "./protocol";

export const PANEL_VIEW_ID = "yourstack.panel";

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

  constructor(private extensionUri: vscode.Uri, private redactor: Redactor, private onMessage: (m: PanelToHost) => void) {}

  resolveWebviewView(view: vscode.WebviewView) {
    const webview = view.webview;
    this.channel.attach((m) => void webview.postMessage(m));
    webview.options = { enableScripts: true, localResourceRoots: [vscode.Uri.joinPath(this.extensionUri, "out", "webview"), vscode.Uri.joinPath(this.extensionUri, "media")] };
    webview.html = panelHtml(webview, this.extensionUri);
    webview.onDidReceiveMessage((m) => {
      if (isPanelToHost(m)) this.onMessage(m);
    });
    view.onDidDispose(() => this.channel.detach());
  }

  post(message: HostToPanel) {
    const scrubbed = JSON.parse(this.redactor.scrub(JSON.stringify(message))) as HostToPanel;
    if (this.channel.post(scrubbed)) this.delivered.fire(scrubbed);
  }

  /** Called when the webview reports it is ready; the caller then sends status and a snapshot. */
  markReady() {
    this.channel.markReady();
  }

  async reveal() {
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
<title>YourStack</title>
</head>
<body>
<div id="app"></div>
<script nonce="${nonce}" src="${script}"></script>
</body>
</html>`;
}
