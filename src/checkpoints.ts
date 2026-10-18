import { execFile } from "node:child_process";
import { createHash } from "node:crypto";
import { existsSync } from "node:fs";
import { mkdir, rm, writeFile } from "node:fs/promises";
import { join } from "node:path";

/** Marks the line in a checkpoint's commit message listing its nested repositories' checkpoints. */
const NESTED = "nested-checkpoints: ";

/**
 * Snapshots of a workspace's files, taken before each message, so a later "restore" can put
 * them back. A separate git repository in extension storage tracks the workspace (git-dir there,
 * work-tree = the workspace), so the user's own repository is never touched and folders without
 * git work too. The workspace's .gitignore files apply, so dependencies and build output aren't
 * copied. Shell side effects outside files (databases, network) are not covered by any snapshot.
 *
 * Git records a repository nested inside the workspace (a folder holding several projects) as a
 * single commit pointer, not its files, so each nested repository gets its own snapshot (with its
 * own .gitignore), recursively; the outer checkpoint lists them in its commit message.
 */
const ALWAYS_SKIP = ["node_modules/", ".venv/", "__pycache__/", ".DS_Store", ".git"].join("\n") + "\n";

export interface CheckpointFile {
  /** A = would be re-created, M = would be changed back, D = would be deleted. */
  status: "A" | "M" | "D";
  path: string;
}

export class Checkpoints {
  /** Git operations on one workspace run one at a time (they share an index and its lock file). */
  private queues = new Map<string, Promise<unknown>>();

  constructor(private storageDir: string) {}

  private serial<T>(root: string, work: () => Promise<T>): Promise<T> {
    const next = (this.queues.get(root) ?? Promise.resolve()).catch(() => {}).then(work);
    this.queues.set(root, next);
    return next;
  }

  private gitDir(root: string) {
    return join(this.storageDir, createHash("sha256").update(root).digest("hex").slice(0, 16));
  }

  private git(root: string, args: string[]): Promise<string> {
    const full = ["-c", "gc.auto=0", "-c", "core.autocrlf=false", "-c", "core.quotepath=false", "--git-dir", this.gitDir(root), "--work-tree", root, ...args];
    return new Promise((resolve, reject) =>
      execFile("git", full, { cwd: root, maxBuffer: 64 << 20, env: { ...process.env, GIT_TERMINAL_PROMPT: "0" } }, (err, stdout, stderr) =>
        err ? reject(new Error(`git ${args[0]} failed: ${String(stderr || err.message).trim()}`)) : resolve(String(stdout)),
      ),
    );
  }

  private async ensureRepo(root: string) {
    const dir = this.gitDir(root);
    if (existsSync(join(dir, "HEAD"))) return;
    await mkdir(dir, { recursive: true });
    await this.git(root, ["init", "-q"]);
    await writeFile(join(dir, "info", "exclude"), ALWAYS_SKIP);
    await this.git(root, ["config", "user.name", "kernl checkpoints"]);
    await this.git(root, ["config", "user.email", "checkpoints@kernl.local"]);
  }

  /** Records the workspace's current files; returns the checkpoint id (a commit in the shadow repository). */
  snapshot(root: string, label: string): Promise<string> {
    return this.serial(root, () => this.snapshotNow(root, label));
  }

  private async snapshotNow(root: string, label: string): Promise<string> {
    await this.ensureRepo(root);
    await this.git(root, ["add", "-A", "."]);
    const nested: Record<string, string> = {};
    for (const path of await this.nestedRepos(root)) nested[path] = await this.snapshotNow(join(root, path), label);
    const tree = (await this.git(root, ["write-tree"])).trim();
    const message = Object.keys(nested).length ? `${label}\n\n${NESTED}${JSON.stringify(nested)}` : label;
    const commit = (await this.git(root, ["commit-tree", tree, "-m", message])).trim();
    // A ref per checkpoint keeps it from ever being garbage-collected.
    await this.git(root, ["update-ref", `refs/checkpoints/${commit}`, commit]);
    return commit;
  }

  /** What restoring `checkpoint` would change in the workspace now. */
  changes(root: string, checkpoint: string): Promise<CheckpointFile[]> {
    return this.serial(root, () => this.changesNow(root, checkpoint));
  }

  /** Folders holding their own git repository (staged as commit pointers by the last add). */
  private async nestedRepos(root: string): Promise<string[]> {
    const out = await this.git(root, ["ls-files", "-s"]);
    return out.split("\n").filter((l) => l.startsWith("160000 ")).map((l) => l.split("\t")[1]);
  }

  /** The nested repositories' checkpoints recorded with `checkpoint` (none for older checkpoints). */
  private async nestedOf(root: string, checkpoint: string): Promise<Record<string, string>> {
    const body = await this.git(root, ["log", "-1", "--format=%B", checkpoint]);
    const line = body.split("\n").find((l) => l.startsWith(NESTED));
    return line ? JSON.parse(line.slice(NESTED.length)) : {};
  }

  private async changesNow(root: string, checkpoint: string): Promise<CheckpointFile[]> {
    await this.git(root, ["add", "-A", "."]);
    const nested = await this.nestedOf(root, checkpoint);
    const inner: CheckpointFile[] = [];
    for (const [path, sub] of Object.entries(nested)) {
      for (const f of await this.changesNow(join(root, path), sub)) inner.push({ status: f.status, path: `${path}/${f.path}` });
    }
    const out = await this.git(root, ["diff-index", "--cached", "--name-status", "--no-renames", "--ignore-submodules=all", checkpoint]);
    // diff-index compares the checkpoint (old) to now (new): a file added since is deleted by restoring.
    const flip = { A: "D", D: "A", M: "M" } as const;
    return out
      .split("\n")
      .filter(Boolean)
      .map((line) => {
        const [status, ...rest] = line.split("\t");
        return { status: flip[status[0] as "A" | "D" | "M"] ?? "M", path: rest.join("\t") };
      })
      .concat(inner);
  }

  /** Puts the workspace's files back to `checkpoint`: changed files reverted, new ones deleted, deleted ones re-created. */
  restore(root: string, checkpoint: string): Promise<void> {
    return this.serial(root, () => this.restoreNow(root, checkpoint));
  }

  private async restoreNow(root: string, checkpoint: string): Promise<void> {
    await this.git(root, ["add", "-A", "."]);
    await this.git(root, ["read-tree", "-u", "--reset", checkpoint]);
    for (const [path, sub] of Object.entries(await this.nestedOf(root, checkpoint))) {
      await mkdir(join(root, path), { recursive: true });
      await this.restoreNow(join(root, path), sub);
    }
  }

  /** Deletes every snapshot repository. */
  async clear(): Promise<void> {
    await rm(this.storageDir, { recursive: true, force: true });
  }
}
