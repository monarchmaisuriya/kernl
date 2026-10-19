// Where each CLI agent keeps its sessions on disk. kernl doesn't read these stores (the agents list
// and load their own sessions over ACP); a change in one only tells kernl that agent's list is stale.
// Claude Code also records each running process's session, which is how a session open in another
// app (a terminal, the Claude desktop app) is recognized.
import { readdir, readFile } from "node:fs/promises";
import { homedir } from "node:os";
import { join } from "node:path";
import type { CliAgentId } from "./agents";

/** The folder and file pattern whose changes mean the agent's session list changed. */
export function sessionStore(agent: CliAgentId, env: NodeJS.ProcessEnv = process.env, home = homedir()): { base: string; pattern: string } {
  switch (agent) {
    case "claude-code":
      return { base: join(env.CLAUDE_CONFIG_DIR || join(home, ".claude"), "projects"), pattern: "*/*.jsonl" };
    case "codex":
      return { base: env.CODEX_HOME || join(home, ".codex"), pattern: "state_*.sqlite*" };
    case "opencode":
      return { base: join(env.XDG_DATA_HOME || join(home, ".local", "share"), "opencode"), pattern: "opencode.db*" };
  }
}

const running = (pid: number) => {
  try {
    process.kill(pid, 0);
    return true;
  } catch (err: any) {
    return err?.code === "EPERM";
  }
};

/** Whether a running Claude Code process has this session open (its `sessions/<pid>.json` names it). Unreadable records count as not open. */
export async function claudeSessionOpenElsewhere(sessionId: string, env: NodeJS.ProcessEnv = process.env, home = homedir(), alive = running): Promise<boolean> {
  const dir = join(env.CLAUDE_CONFIG_DIR || join(home, ".claude"), "sessions");
  let names: string[];
  try {
    names = (await readdir(dir)).filter((n) => /^\d+\.json$/.test(n));
  } catch {
    return false;
  }
  for (const name of names) {
    try {
      const record = JSON.parse(await readFile(join(dir, name), "utf8"));
      if (record?.sessionId === sessionId && typeof record.pid === "number" && alive(record.pid)) return true;
    } catch {
      // A record being written, or not one of Claude Code's: skip it.
    }
  }
  return false;
}
