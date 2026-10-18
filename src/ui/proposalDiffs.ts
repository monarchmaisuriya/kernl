import * as vscode from "vscode";

const SCHEME = "kernl-proposal";

/** Serves the before/after text of pending edits so they can be opened in VS Code's diff editor. */
export class ProposalDiffs implements vscode.TextDocumentContentProvider, vscode.Disposable {
  private texts = new Map<string, string>();
  private registration = vscode.workspace.registerTextDocumentContentProvider(SCHEME, this);

  provideTextDocumentContent(uri: vscode.Uri): string {
    return this.texts.get(uri.toString()) ?? "";
  }

  async show(id: string, path: string, before: string | null, after: string) {
    const name = path.split("/").pop() || "file";
    const left = vscode.Uri.from({ scheme: SCHEME, path: `/${id}/current/${name}` });
    const right = vscode.Uri.from({ scheme: SCHEME, path: `/${id}/proposed/${name}` });
    this.texts.set(left.toString(), before ?? "");
    this.texts.set(right.toString(), after);
    await vscode.commands.executeCommand("vscode.diff", left, right, `${path}: current ↔ proposed (approve in kernl)`, { preview: true, preserveFocus: true });
  }

  /** Base text (virtual) against a real file, e.g. a workspace file under review. */
  async showAgainstFile(key: string, title: string, before: string | null, file: vscode.Uri) {
    const left = vscode.Uri.from({ scheme: SCHEME, path: `/${key}/base/${file.path.split("/").pop()}` });
    this.texts.set(left.toString(), before ?? "");
    await vscode.commands.executeCommand("vscode.diff", left, file, title, { preview: true });
  }

  forget(id: string) {
    for (const key of [...this.texts.keys()]) if (key.includes(`/${id}/`)) this.texts.delete(key);
  }

  dispose() {
    this.registration.dispose();
  }
}
