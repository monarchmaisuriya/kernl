import { createHash } from "node:crypto";
import { existsSync, mkdirSync, realpathSync } from "node:fs";
import { basename, join, sep } from "node:path";
import { git } from "./git";

/** A Conductor-style workspace: a git worktree on its own branch, outside the repo folder. */
export interface WorkspaceInfo {
  name: string;
  branch: string;
  path: string;
  /** Branch (or commit) the workspace started from and merges back into. */
  base: string;
  /** Harness chosen for this workspace, e.g. "claude-code". */
  harness: string;
}

export const BRANCH_PREFIX = "yourstack/";

/** Lowercase letters, digits, and dashes; 1-40 characters. Never model input; typed by the user. */
export function sanitizeName(raw: string): string {
  const name = raw.trim().toLowerCase().replace(/[^a-z0-9]+/g, "-").replace(/^-+|-+$/g, "").slice(0, 40);
  if (!name) throw new Error(`Expected a workspace name with letters or digits, got '${raw}'`);
  return name;
}

export async function repoRoot(dir: string): Promise<string> {
  return realpathSync((await git(dir, ["rev-parse", "--show-toplevel"])).trim());
}

/** Where this repo's worktrees live: extension storage, one folder per repo. */
export function storageDirFor(storageRoot: string, repo: string): string {
  return join(storageRoot, `${basename(repo)}-${createHash("sha1").update(repo).digest("hex").slice(0, 8)}`);
}

const configKey = (name: string, key: string) => `branch.${BRANCH_PREFIX}${name}.yourstack${key}`;

export async function createWorkspace(repo: string, storageRoot: string, rawName: string, harness: string): Promise<WorkspaceInfo> {
  const name = sanitizeName(rawName);
  await git(repo, ["rev-parse", "--verify", "HEAD"]).catch(() => {
    throw new Error("This repository has no commits yet; commit once before creating a workspace");
  });
  const head = (await git(repo, ["rev-parse", "--abbrev-ref", "HEAD"])).trim();
  const base = head === "HEAD" ? (await git(repo, ["rev-parse", "HEAD"])).trim() : head;
  const dir = storageDirFor(storageRoot, repo);
  const path = join(dir, name);
  if (existsSync(path)) throw new Error(`A workspace named '${name}' already exists`);
  mkdirSync(dir, { recursive: true });
  const branch = `${BRANCH_PREFIX}${name}`;
  await git(repo, ["worktree", "add", "-b", branch, path, base]);
  await git(repo, ["config", configKey(name, "Base"), base]);
  await git(repo, ["config", configKey(name, "Harness"), harness]);
  return { name, branch, path: realpathSync(path), base, harness };
}

/** Workspaces of this repo: worktrees under its storage folder on a yourstack/ branch. */
export async function listWorkspaces(repo: string, storageRoot: string): Promise<WorkspaceInfo[]> {
  const dir = storageDirFor(storageRoot, repo);
  const realDir = existsSync(dir) ? realpathSync(dir) : dir;
  const out = await git(repo, ["worktree", "list", "--porcelain"]);
  const found: WorkspaceInfo[] = [];
  for (const block of out.split("\n\n")) {
    const path = /^worktree (.+)$/m.exec(block)?.[1];
    const branch = /^branch refs\/heads\/(.+)$/m.exec(block)?.[1];
    if (!path || !branch?.startsWith(BRANCH_PREFIX) || !path.startsWith(realDir + sep)) continue;
    const name = branch.slice(BRANCH_PREFIX.length);
    const read = (key: string) => git(repo, ["config", "--get", configKey(name, key)]).then((v) => v.trim(), () => "");
    found.push({ name, branch, path, base: (await read("Base")) || "main", harness: (await read("Harness")) || "deepagents" });
  }
  return found;
}

export interface ChangedFile {
  /** git status letter: A added, M modified, D deleted, R renamed, ? untracked */
  status: string;
  path: string;
}

/**
 * The commit the workspace branched from (merge base of its branch and base). Review compares
 * against this, so later commits on the base branch never show up as workspace changes.
 */
export async function reviewBase(ws: WorkspaceInfo): Promise<string> {
  return (await git(ws.path, ["merge-base", ws.base, "HEAD"])).trim();
}

/** Everything the workspace changed since it branched: committed on the branch plus uncommitted. */
export async function changedFiles(ws: WorkspaceInfo): Promise<ChangedFile[]> {
  const files = new Map<string, string>();
  const committed = await git(ws.path, ["diff", "--name-status", await reviewBase(ws), "HEAD"]);
  for (const line of committed.split("\n").filter(Boolean)) {
    const [status, ...rest] = line.split("\t");
    files.set(rest.at(-1)!, status[0]);
  }
  const pending = await git(ws.path, ["status", "--porcelain", "--untracked-files=all"]);
  for (const line of pending.split("\n").filter(Boolean)) {
    const code = line.slice(0, 2).trim();
    const path = line.slice(3).split(" -> ").at(-1)!;
    files.set(path, code === "??" ? "?" : code[0]);
  }
  return [...files].map(([path, status]) => ({ status, path })).sort((a, b) => a.path.localeCompare(b.path));
}

/** File content where the workspace branched off, or null when it did not exist there. */
export async function baseContent(ws: WorkspaceInfo, path: string): Promise<string | null> {
  return git(ws.path, ["show", `${await reviewBase(ws)}:${path}`]).catch(() => null);
}

export type MergeOutcome = { merged: true; committedPending: boolean } | { merged: false; reason: string };

/**
 * Merges the workspace branch into its base in the main checkout. Preconditions: the main
 * checkout is on the base branch and clean. Uncommitted work in the worktree is committed first.
 * On a conflict the merge is aborted, so the main checkout is left as it was.
 */
export async function mergeWorkspace(repo: string, ws: WorkspaceInfo): Promise<MergeOutcome> {
  const current = (await git(repo, ["rev-parse", "--abbrev-ref", "HEAD"])).trim();
  if (current !== ws.base) return { merged: false, reason: `The main checkout is on '${current}', but this workspace merges into '${ws.base}'. Switch to '${ws.base}' first.` };
  if ((await git(repo, ["status", "--porcelain"])).trim()) return { merged: false, reason: "The main checkout has uncommitted changes. Commit or stash them first." };
  const pending = (await git(ws.path, ["status", "--porcelain", "--untracked-files=all"])).trim() !== "";
  if (pending) {
    await git(ws.path, ["add", "-A"]);
    await git(ws.path, ["commit", "-m", `YourStack workspace ${ws.name}`]);
  }
  try {
    await git(repo, ["merge", "--no-ff", "--no-edit", ws.branch]);
    return { merged: true, committedPending: pending };
  } catch (err: any) {
    await git(repo, ["merge", "--abort"]).catch(() => {});
    return { merged: false, reason: `Merge stopped and was undone: ${err.message}` };
  }
}

/** Remembers which agent a workspace uses, next to its base, in the branch's git config. */
export async function rememberHarness(repo: string, ws: WorkspaceInfo, harness: string): Promise<void> {
  await git(repo, ["config", configKey(ws.name, "Harness"), harness]);
}

/** Removes the worktree, its branch, and its settings. Irreversible for uncommitted and unmerged work. */
export async function discardWorkspace(repo: string, ws: WorkspaceInfo): Promise<void> {
  await git(repo, ["worktree", "remove", "--force", ws.path]);
  await git(repo, ["branch", "-D", ws.branch]);
  for (const key of ["Base", "Harness"]) await git(repo, ["config", "--unset", configKey(ws.name, key)]).catch(() => {});
}
