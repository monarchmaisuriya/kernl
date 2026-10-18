import { execFileSync } from "node:child_process";
import { accessSync, constants } from "node:fs";
import { homedir } from "node:os";
import { delimiter, join } from "node:path";

// VS Code started from the Dock gets a short PATH, so also look where CLI installers put binaries.
const EXTRA_DIRS = [
  join(homedir(), ".local", "bin"),
  join(homedir(), ".opencode", "bin"),
  join(homedir(), ".npm-global", "bin"),
  join(homedir(), ".volta", "bin"),
  "/opt/homebrew/bin",
  "/usr/local/bin",
  "/usr/bin",
];

function isExecutable(path: string) {
  try {
    accessSync(path, constants.X_OK);
    return true;
  } catch {
    return false;
  }
}

/**
 * Absolute path of a command, or undefined. Checks PATH and the usual install folders, then
 * asks the user's login shell (which loads nvm/asdf/etc.). `name` is a fixed catalog value, never model input.
 */
export function resolveCommand(name: string, env: NodeJS.ProcessEnv = process.env): string | undefined {
  if (name.includes("/")) return isExecutable(name) ? name : undefined;
  const dirs = [...(env.PATH ?? "").split(delimiter), ...EXTRA_DIRS].filter(Boolean);
  for (const dir of dirs) {
    const candidate = join(dir, name);
    if (isExecutable(candidate)) return candidate;
  }
  const shell = env.SHELL;
  if (!shell || process.platform === "win32") return undefined;
  try {
    const out = execFileSync(shell, ["-lc", `command -v ${name}`], { encoding: "utf8", timeout: 5_000, env }).trim().split("\n").pop();
    return out && isExecutable(out) ? out : undefined;
  } catch {
    return undefined;
  }
}
