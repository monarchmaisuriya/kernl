import { existsSync, realpathSync } from "node:fs";
import { dirname, join, posix, sep } from "node:path";

/**
 * Maps an agent path ("/src/app.ts", always rooted at the workspace) to an absolute path inside
 * `root`. Rejects ".." segments and any path whose nearest existing ancestor resolves (through
 * symlinks) outside the workspace.
 */
export function resolveInRoot(root: string, agentPath: string): string {
  const slashed = agentPath.replace(/\\/g, "/");
  // Checked before normalizing: normalize would silently fold "/.." into "/".
  if (slashed.split("/").includes("..")) throw new Error(`Path escapes the workspace: ${agentPath}`);
  const normalized = posix.normalize(`/${slashed}`);
  const abs = join(root, normalized);
  const realRoot = realpathSync(root);
  let probe = abs;
  while (!existsSync(probe)) probe = dirname(probe);
  const realProbe = realpathSync(probe);
  if (realProbe !== realRoot && !realProbe.startsWith(realRoot + sep)) throw new Error(`Path escapes the workspace: ${agentPath}`);
  return abs;
}
