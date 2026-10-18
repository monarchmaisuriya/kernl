import * as vscode from "vscode";

export type WorkspaceScope =
  | { ok: true; root: string; trusted: boolean }
  | { ok: false; reason: string };

/** The agent works on exactly one local folder. Trust decides whether it may change anything. */
export function currentWorkspaceScope(): WorkspaceScope {
  const folders = vscode.workspace.workspaceFolders ?? [];
  if (folders.length === 0) return { ok: false, reason: "Open a folder to use YourStack." };
  if (folders.length > 1) return { ok: false, reason: "YourStack supports a single-folder workspace in this version; this workspace has several folders." };
  const folder = folders[0];
  if (folder.uri.scheme !== "file") return { ok: false, reason: `YourStack needs a local folder, got a '${folder.uri.scheme}' folder.` };
  return { ok: true, root: folder.uri.fsPath, trusted: vscode.workspace.isTrusted };
}
