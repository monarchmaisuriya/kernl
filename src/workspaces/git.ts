import { spawn } from "node:child_process";

export class GitError extends Error {}

/** Runs git with fixed arguments (no shell). Rejects with git's own message on a non-zero exit. */
export function git(cwd: string, args: string[]): Promise<string> {
  return new Promise((resolve, reject) => {
    const child = spawn("git", args, { cwd, stdio: ["ignore", "pipe", "pipe"] });
    let out = "";
    let err = "";
    child.stdout.on("data", (d) => (out += d));
    child.stderr.on("data", (d) => (err += d));
    child.once("error", (e) => reject(new GitError(`git could not start: ${e.message}`)));
    child.once("close", (code) => {
      if (code === 0) resolve(out);
      else reject(new GitError(`git ${args[0]} failed: ${(err || out).trim().split("\n").slice(-3).join(" ")}`));
    });
  });
}

/** True only for "this folder is not inside a git repository"; every other git failure is a real error. */
export function isNotARepository(err: unknown): boolean {
  return err instanceof GitError && /not a git repository/i.test(err.message);
}
