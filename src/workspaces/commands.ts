import { join } from "node:path";
import * as vscode from "vscode";
import type { Logger } from "../log";
import type { ProposalDiffs } from "../ui/proposalDiffs";
import type { HarnessView } from "../ui/protocol";
import { baseContent, changedFiles, createWorkspace, discardWorkspace, mergeWorkspace, rememberHarness, repoRoot, type WorkspaceInfo } from "./worktrees";

/** The questions the workspace flows ask. VS Code's own dialogs in production; scripted in integration tests. */
export interface Prompts {
  input(options: vscode.InputBoxOptions): Thenable<string | undefined>;
  pick<T extends vscode.QuickPickItem>(items: T[], options: vscode.QuickPickOptions): Thenable<T | undefined>;
  /** A modal confirmation; true only when the user chose `action`. */
  confirm(message: string, detail: string, action: string): Thenable<boolean>;
}

export const vscodePrompts: Prompts = {
  input: (options) => vscode.window.showInputBox(options),
  pick: (items, options) => vscode.window.showQuickPick(items, options),
  confirm: async (message, detail, action) => (await vscode.window.showWarningMessage(message, { modal: true, detail }, action)) === action,
};

export interface WorkspaceCommandHost {
  log: Logger;
  diffs: ProposalDiffs;
  worktreeStorage: string;
  /** The main folder (the repository's own checkout). */
  mainRoot(): string | undefined;
  prompts(): Prompts;
  /** Every agent the user can pick, built-in and named. */
  harnesses(): HarnessView[];
}

const STATUS_LABEL: Record<string, string> = { A: "added", M: "modified", D: "deleted", R: "renamed", "?": "new, uncommitted" };

/** The user-facing flows for worktree workspaces: create, review, merge, discard, remember the agent. */
export class WorkspaceCommands {
  constructor(private host: WorkspaceCommandHost) {}

  /** Asks for a name and an agent, then creates the worktree. Returns undefined if cancelled or impossible. */
  async create(): Promise<WorkspaceInfo | undefined> {
    const root = this.host.mainRoot();
    if (!root) return void vscode.window.showErrorMessage("Open a folder to use workspaces.");
    if (!vscode.workspace.isTrusted) return void vscode.window.showErrorMessage("Workspaces need a trusted folder. Trust this workspace first.");
    const repo = await repoRoot(root).catch(() => undefined);
    if (!repo) return void vscode.window.showErrorMessage("Workspaces need a git repository. Run git init and commit once first.");
    const name = await this.host.prompts().input({ title: "New workspace: name", prompt: "Becomes the branch kernl/<name>", placeHolder: "fix-login-redirect", ignoreFocusOut: true });
    if (!name) return undefined;
    const pick = await this.host.prompts().pick(
      this.host.harnesses().map((h) => ({ label: h.label, id: h.id })),
      { title: "Agent for this workspace" },
    );
    if (!pick) return undefined;
    const info = await createWorkspace(repo, this.host.worktreeStorage, name, pick.id);
    this.host.log.info(`created workspace ${info.name} at ${info.path} from ${info.base}`);
    return info;
  }

  async review(info: WorkspaceInfo) {
    const files = await changedFiles(info);
    if (files.length === 0) return void vscode.window.showInformationMessage(`Workspace ${info.name} has no changes since it branched from ${info.base}.`);
    const pick = await this.host.prompts().pick(
      files.map((f) => ({ label: f.path, description: STATUS_LABEL[f.status] ?? f.status, file: f })),
      { title: `Changes in ${info.branch} since it branched from ${info.base}` },
    );
    if (!pick) return;
    const fileUri = vscode.Uri.file(join(info.path, pick.file.path));
    await this.host.diffs.showAgainstFile(`review-${info.name}`, `${pick.file.path}: branch point ↔ ${info.branch}`, await baseContent(info, pick.file.path), fileUri);
  }

  async merge(info: WorkspaceInfo) {
    const root = this.host.mainRoot();
    if (!root) return;
    const files = await changedFiles(info);
    const confirmed = await this.host.prompts().confirm(
      `Merge ${info.branch} into ${info.base}?`,
      `${files.length} changed file(s). Uncommitted work in the workspace is committed first. Your main checkout must be on ${info.base} and clean.`,
      "Merge",
    );
    if (!confirmed) return;
    const out = await mergeWorkspace(await repoRoot(root), info);
    if (out.merged) vscode.window.showInformationMessage(`Merged ${info.branch} into ${info.base}. Discard the workspace when you no longer need it.`);
    else vscode.window.showErrorMessage(out.reason);
  }

  /** Returns true when the workspace was discarded. */
  async discard(info: WorkspaceInfo, beforeRemove: () => void): Promise<boolean> {
    const root = this.host.mainRoot();
    if (!root) return false;
    const files = await changedFiles(info);
    const confirmed = await this.host.prompts().confirm(
      `Discard workspace ${info.name}?`,
      `Deletes the worktree folder and the branch ${info.branch}. ${files.length} changed file(s) that are not merged will be lost.`,
      "Discard",
    );
    if (!confirmed) return false;
    beforeRemove();
    await discardWorkspace(await repoRoot(root), info);
    return true;
  }

  /** Remembers a worktree workspace's agent in its branch config, next to its base. */
  async rememberHarness(info: WorkspaceInfo, harness: string) {
    await rememberHarness(await repoRoot(info.path), info, harness);
  }
}
