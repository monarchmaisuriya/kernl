import { execFile } from "node:child_process";
import { CLI_AGENTS, type CliAgentId } from "./acp/agents";
import { resolveCommand } from "./acp/commands";

/**
 * Whether each agent harness can start right now, and if not, why. A harness counts as not ready
 * only when its status is definitely negative (not installed, or the CLI says it's logged out);
 * when a status check can't run or can't be read, the harness stays usable and the agent's own
 * error shows on first use, so a broken check never locks anyone out.
 */
export interface Readiness {
  ready: boolean;
  /** What's missing, in words, with the fix. */
  problem?: string;
}

export interface ReadinessDeps {
  /** Path of a command, or undefined when not installed. */
  find(command: string): string | undefined;
  /** Runs a command; resolves with its output (stdout and stderr), or undefined when it fails or times out. */
  run(command: string, args: string[]): Promise<string | undefined>;
  /** A key stored for the agent in YourStack (then its own login doesn't matter). */
  hasStoredKey(id: CliAgentId): Promise<boolean>;
  /** The user overrode how the agent launches (yourstack.agentCommands): their command, their setup. */
  hasLaunchOverride(id: CliAgentId): boolean;
}

export async function cliReadiness(id: CliAgentId, deps: ReadinessDeps): Promise<Readiness> {
  if (deps.hasLaunchOverride(id)) return { ready: true };
  const label = CLI_AGENTS[id].label.replace(/ \(experimental\)$/, "");
  const binary = { "claude-code": "claude", codex: "codex", opencode: "opencode" }[id];
  if (!deps.find(binary)) return { ready: false, problem: `${label} isn't installed (no '${binary}' command found).` };
  if (id !== "opencode" && !deps.find("npx")) return { ready: false, problem: `${label} needs Node.js (npx) for its connector; install Node.js.` };
  if (await deps.hasStoredKey(id)) return { ready: true };
  if (id === "claude-code") {
    const out = await deps.run(binary, ["auth", "status"]);
    let status: { loggedIn?: unknown } | undefined;
    try {
      status = out ? JSON.parse(out) : undefined;
    } catch {
      status = undefined;
    }
    if (status?.loggedIn === false) return { ready: false, problem: "Claude Code isn't logged in: run `claude` in a terminal and use /login, or add an API key." };
  }
  if (id === "codex") {
    const out = await deps.run(binary, ["login", "status"]);
    if (out && /not logged in/i.test(out)) return { ready: false, problem: "Codex isn't logged in: run `codex login` in a terminal, or add an API key." };
  }
  // OpenCode runs on its free models without a login; its own provider setup lives in OpenCode.
  return { ready: true };
}

/** The real process runner: 10 s cap, never throws. Both streams count: `codex login status` writes to stderr. */
export function runQuiet(command: string, args: string[]): Promise<string | undefined> {
  const path = resolveCommand(command) ?? command;
  return new Promise((resolve) => {
    execFile(path, args, { timeout: 10_000, maxBuffer: 1 << 20 }, (err, stdout, stderr) => {
      const out = `${stdout ?? ""}${stderr ?? ""}`;
      resolve(err && !out ? undefined : out);
    });
  });
}
