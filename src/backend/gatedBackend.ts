import {
  type DeleteResult,
  type EditResult,
  type ExecuteResponse,
  type FileUploadResponse,
  FilesystemBackend,
  type GrepResult,
  type ReadRawResult,
  type ReadResult,
  type WriteResult,
} from "deepagents";
import { type ApprovalGate, isSensitivePath } from "../gate/approvalGate";
import { applyStringEdit } from "./editApply";
import { resolveInRoot } from "./paths";
import type { WorkspaceFiles } from "./workspaceFiles";

export type CommandRunner = (command: string) => Promise<ExecuteResponse>;

const REJECTED = "rejected by user";

/**
 * Deep Agents backend for the workspace folder. Reads come from disk; reads of credential-like
 * files (.env, *.pem, *.key, id_*) ask first, and their grep matches are withheld.
 */
export class WorkspaceReadBackend extends FilesystemBackend {
  constructor(protected root: string, protected gate: ApprovalGate) {
    super({ rootDir: root, virtualMode: true });
  }

  private async readAllowed(path: string) {
    return !isSensitivePath(path) || this.gate.request({ kind: "read", path });
  }
  async read(path: string, offset?: number, limit?: number): Promise<ReadResult> {
    if (!(await this.readAllowed(path))) return { error: REJECTED };
    return super.read(path, offset, limit);
  }
  async readRaw(path: string): Promise<ReadRawResult> {
    if (!(await this.readAllowed(path))) return { error: REJECTED };
    return super.readRaw(path);
  }
  async downloadFiles(paths: string[]) {
    const results = [];
    for (const path of paths) {
      if (await this.readAllowed(path)) results.push(...(await super.downloadFiles([path])));
      else results.push({ path, content: null, error: "permission_denied" as const });
    }
    return results;
  }
  async grep(pattern: string, path?: string | null, glob?: string | null, maxCount?: number | null): Promise<GrepResult> {
    const result = await super.grep(pattern, path ?? undefined, glob ?? undefined, maxCount);
    return result.matches ? { ...result, matches: result.matches.filter((m) => !isSensitivePath(m.path)) } : result;
  }
}

/**
 * Trusted-workspace backend. Its five side effects (write, edit, delete, uploadFiles, execute)
 * each ask the gate and are applied through WorkspaceFiles / the terminal runner, never by
 * FilesystemBackend's own disk writes. Having `execute` and `id` makes Deep Agents offer its shell tool.
 */
export class GatedBackend extends WorkspaceReadBackend {
  readonly id = "kernl-agent-workspace";

  constructor(root: string, gate: ApprovalGate, private files: WorkspaceFiles, private runCommand: CommandRunner) {
    super(root, gate);
  }

  /**
   * Approval can take minutes. Before applying, the file must still be exactly what the user saw
   * as "before" and have no unsaved edits; otherwise applying would silently discard their change.
   */
  private async changedSinceApproval(abs: string, path: string, before: string | null): Promise<string | undefined> {
    if (this.files.hasUnsavedChanges(abs) || (await this.files.readText(abs)) !== before) {
      return `File '${path}' changed while waiting for approval; nothing was written. Re-read it and propose the change again`;
    }
    return undefined;
  }

  async write(path: string, content: string): Promise<WriteResult> {
    const abs = resolveInRoot(this.root, path);
    if (this.files.hasUnsavedChanges(abs)) return { error: `File '${path}' has unsaved changes in the editor; ask the user to save or revert it first` };
    const before = await this.files.readText(abs);
    if (!(await this.gate.request({ kind: "write", path, before, after: content }))) return { error: REJECTED };
    const changed = await this.changedSinceApproval(abs, path, before);
    if (changed) return { error: changed };
    await this.files.writeText(abs, content);
    return { path, filesUpdate: null };
  }

  async edit(path: string, oldString: string, newString: string, replaceAll?: boolean): Promise<EditResult> {
    const abs = resolveInRoot(this.root, path);
    if (this.files.hasUnsavedChanges(abs)) return { error: `File '${path}' has unsaved changes in the editor; ask the user to save or revert it first` };
    const before = await this.files.readText(abs);
    if (before === null) return { error: `File '${path}' not found` };
    const outcome = applyStringEdit(before, oldString, newString, replaceAll);
    if ("error" in outcome) return { error: outcome.error };
    if (!(await this.gate.request({ kind: "edit", path, before, after: outcome.text }))) return { error: REJECTED };
    const changed = await this.changedSinceApproval(abs, path, before);
    if (changed) return { error: changed };
    await this.files.writeText(abs, outcome.text);
    return { path, filesUpdate: null, occurrences: outcome.occurrences };
  }

  async delete(path: string): Promise<DeleteResult> {
    const abs = resolveInRoot(this.root, path);
    if (!(await this.gate.request({ kind: "delete", path }))) return { error: REJECTED };
    await this.files.delete(abs);
    return { path };
  }

  async uploadFiles(uploads: Array<[string, Uint8Array]>): Promise<FileUploadResponse[]> {
    const results: FileUploadResponse[] = [];
    for (const [path, bytes] of uploads) {
      const written = await this.write(path, new TextDecoder().decode(bytes));
      results.push({ path, error: written.error ? "permission_denied" : null });
    }
    return results;
  }

  async execute(command: string): Promise<ExecuteResponse> {
    if (!(await this.gate.request({ kind: "execute", command }))) return { output: REJECTED, exitCode: null, truncated: false };
    return this.runCommand(command);
  }
}

const RESTRICTED = "This workspace is in Restricted Mode; the agent can only read files. Trust the workspace to allow changes.";

/** Reads only (Restricted Mode, and the user's skill folders). No `execute`/`id`, so Deep Agents offers no shell tool. */
export class ReadOnlyBackend extends WorkspaceReadBackend {
  constructor(root: string, gate: ApprovalGate, private reason = RESTRICTED) {
    super(root, gate);
  }

  private refuse() {
    return { error: this.reason };
  }
  async write(): Promise<WriteResult> {
    return this.refuse();
  }
  async edit(): Promise<EditResult> {
    return this.refuse();
  }
  async delete(): Promise<DeleteResult> {
    return this.refuse();
  }
  async uploadFiles(uploads: Array<[string, Uint8Array]>): Promise<FileUploadResponse[]> {
    return uploads.map(([path]) => ({ path, error: "permission_denied" as const }));
  }
}
