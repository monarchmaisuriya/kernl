import * as vscode from "vscode";
import type { WorkspaceFiles } from "./workspaceFiles";

/**
 * Applies approved changes through the editor: existing files are replaced with a WorkspaceEdit
 * (so Undo works) and saved; new files are created; deletes go to the trash.
 */
export class VscodeWorkspaceFiles implements WorkspaceFiles {
  private openDocument(absPath: string) {
    return vscode.workspace.textDocuments.find((d) => d.uri.scheme === "file" && d.uri.fsPath === absPath);
  }

  async readText(absPath: string): Promise<string | null> {
    const open = this.openDocument(absPath);
    if (open) return open.getText();
    try {
      return new TextDecoder().decode(await vscode.workspace.fs.readFile(vscode.Uri.file(absPath)));
    } catch (e) {
      if (e instanceof vscode.FileSystemError && e.code === "FileNotFound") return null;
      throw e;
    }
  }

  hasUnsavedChanges(absPath: string): boolean {
    return this.openDocument(absPath)?.isDirty ?? false;
  }

  async writeText(absPath: string, text: string): Promise<void> {
    const uri = vscode.Uri.file(absPath);
    if ((await this.readText(absPath)) === null) {
      await vscode.workspace.fs.writeFile(uri, new TextEncoder().encode(text));
      return;
    }
    const doc = await vscode.workspace.openTextDocument(uri);
    const edit = new vscode.WorkspaceEdit();
    edit.replace(uri, new vscode.Range(doc.positionAt(0), doc.positionAt(doc.getText().length)), text);
    if (!(await vscode.workspace.applyEdit(edit))) throw new Error(`VS Code refused the edit to ${absPath}`);
    if (!(await doc.save())) throw new Error(`VS Code could not save ${absPath}`);
  }

  async delete(absPath: string): Promise<void> {
    await vscode.workspace.fs.delete(vscode.Uri.file(absPath), { recursive: true, useTrash: true });
  }
}
