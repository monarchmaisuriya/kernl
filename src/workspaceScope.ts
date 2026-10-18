import * as vscode from "vscode";

/** A local folder of the window; each one is a top-level workspace in the panel. */
export interface ScopeFolder {
  root: string;
  name: string;
}

export type WorkspaceScope =
  | { ok: true; folders: ScopeFolder[]; trusted: boolean }
  | { ok: false; reason: string };

/** The agent works on the window's local folders, one agent per folder. Trust decides whether it may change anything. */
export function currentWorkspaceScope(): WorkspaceScope {
  const folders = vscode.workspace.workspaceFolders ?? [];
  if (folders.length === 0) return { ok: false, reason: "Open a folder to use YourStack." };
  const local = folders.filter((f) => f.uri.scheme === "file");
  if (!local.length) return { ok: false, reason: `YourStack needs a local folder; this window's folders are '${folders[0].uri.scheme}' folders.` };
  return { ok: true, folders: local.map((f) => ({ root: f.uri.fsPath, name: f.name })), trusted: vscode.workspace.isTrusted };
}
