// The only commands kernl runs to learn a connection's status. Each one only reads: it never logs
// in or out, never writes config, and never sends a prompt (a real prompt makes a CLI refresh and
// rewrite stored logins). Callers name a command from this table; there is no way to pass other
// arguments, so nothing else can run through here.
import { execFile } from "node:child_process";

export const STATUS_COMMANDS = {
  claudeAuthJson: { binary: "claude", args: ["auth", "status", "--json"] },
  claudeAuthText: { binary: "claude", args: ["auth", "status", "--text"] },
  claudeMcpList: { binary: "claude", args: ["mcp", "list"] },
  claudePluginList: { binary: "claude", args: ["plugin", "list", "--json"] },
  codexLoginStatus: { binary: "codex", args: ["login", "status"] },
  codexMcpList: { binary: "codex", args: ["mcp", "list", "--json"] },
  opencodeAuthList: { binary: "opencode", args: ["auth", "list", "--format", "json"] },
  opencodeMcpList: { binary: "opencode", args: ["mcp", "list"] },
} as const;

export type StatusCommand = keyof typeof STATUS_COMMANDS;

export interface CommandResult {
  /** The process's exit code; null when it timed out, was killed, or couldn't start. */
  exitCode: number | null;
  /** stdout then stderr (some CLIs write their status to stderr). */
  output: string;
  timedOut: boolean;
}

/** Where and how to run a status command: the agent's own binary, with the environment kernl launches the agent with. */
export interface CommandTarget {
  path: string;
  env: Record<string, string | undefined>;
  cwd?: string;
}

export type Exec = (path: string, args: readonly string[], options: { env: Record<string, string | undefined>; cwd?: string; timeoutMs: number }) => Promise<CommandResult>;

export const STATUS_TIMEOUT_MS = 10_000;

/** Runs one allowlisted status command; never throws (a failure is a result with exitCode null). */
export function runStatusCommand(name: StatusCommand, target: CommandTarget, exec: Exec = execStatus, timeoutMs = STATUS_TIMEOUT_MS): Promise<CommandResult> {
  const command = STATUS_COMMANDS[name];
  if (!command) return Promise.reject(new Error(`Expected one of ${Object.keys(STATUS_COMMANDS).join(", ")}, got ${JSON.stringify(name)}`));
  return exec(target.path, command.args, { env: target.env, cwd: target.cwd, timeoutMs });
}

/** The real runner: no shell, a time cap, 1 MB of output. */
export const execStatus: Exec = (path, args, options) =>
  new Promise((resolve) => {
    execFile(path, [...args], { env: options.env as NodeJS.ProcessEnv, cwd: options.cwd, timeout: options.timeoutMs, maxBuffer: 1 << 20 }, (err: any, stdout, stderr) => {
      const output = `${stdout ?? ""}${stderr ?? ""}`;
      const timedOut = !!err?.killed && err?.signal === "SIGTERM";
      const exitCode = !err ? 0 : typeof err.code === "number" ? err.code : null;
      resolve({ exitCode: timedOut ? null : exitCode, output, timedOut });
    });
  });
