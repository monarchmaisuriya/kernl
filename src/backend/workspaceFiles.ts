import { mkdir, readFile, rm, writeFile } from "node:fs/promises";
import { dirname } from "node:path";

/**
 * How approved changes reach files. The VS Code implementation goes through the editor
 * (undoable, respects open buffers); the Node one is for tests and has no editor.
 */
export interface WorkspaceFiles {
  /** File text, or null when the file does not exist. */
  readText(absPath: string): Promise<string | null>;
  hasUnsavedChanges(absPath: string): boolean;
  /** Creates or replaces the file with `text`. */
  writeText(absPath: string, text: string): Promise<void>;
  delete(absPath: string): Promise<void>;
}

export class NodeWorkspaceFiles implements WorkspaceFiles {
  async readText(absPath: string) {
    try {
      return await readFile(absPath, "utf8");
    } catch (e: any) {
      if (e?.code === "ENOENT") return null;
      throw e;
    }
  }
  hasUnsavedChanges() {
    return false;
  }
  async writeText(absPath: string, text: string) {
    await mkdir(dirname(absPath), { recursive: true });
    await writeFile(absPath, text, "utf8");
  }
  async delete(absPath: string) {
    await rm(absPath, { recursive: true });
  }
}
