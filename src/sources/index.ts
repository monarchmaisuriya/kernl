// Every source kernl's own agent can reuse, collected in one pass (Claude Code, then Codex, then
// OpenCode), plus the report the "kernl: Show loaded sources" command shows. A source that can't be
// read (a broken config file) is reported in `skipped` with the reason, and the others still load.
import { homedir } from "node:os";
import { join } from "node:path";
import { importClaudeCode } from "./claudeCode";
import { writeCommandSkills } from "./commands";
import { importCodex } from "./codex";
import { importOpenCode } from "./opencode";
import { emptyImports, type Imports, type SourceSettings } from "./types";

export * from "./types";

export interface SourceRoots {
  claudeDir: string;
  claudeJson: string;
  codexDir: string;
  opencodeDir: string;
  home: string;
  env: Record<string, string | undefined>;
}

/** Where each agent keeps its setup on this machine (honoring CLAUDE_CONFIG_DIR, CODEX_HOME, XDG_CONFIG_HOME). */
export function sourceRoots(env: Record<string, string | undefined> = process.env, home = homedir()): SourceRoots {
  const claudeDir = env.CLAUDE_CONFIG_DIR || join(home, ".claude");
  return {
    claudeDir,
    claudeJson: env.CLAUDE_CONFIG_DIR ? join(env.CLAUDE_CONFIG_DIR, ".claude.json") : join(home, ".claude.json"),
    codexDir: env.CODEX_HOME || join(home, ".codex"),
    opencodeDir: join(env.XDG_CONFIG_HOME || join(home, ".config"), "opencode"),
    home,
    env,
  };
}

export async function collectImports(roots: SourceRoots, project: { root: string; trusted: boolean }, settings: SourceSettings): Promise<Imports> {
  const common = { projectRoot: project.root, trusted: project.trusted, env: roots.env, home: roots.home };
  const runs: [string, () => Promise<Imports>][] = [
    ["Claude Code", () => importClaudeCode({ ...common, claudeDir: roots.claudeDir, claudeJson: roots.claudeJson, settings: settings.claudeCode })],
    ["Codex", () => importCodex({ ...common, codexDir: roots.codexDir, settings: settings.codex })],
    ["OpenCode", () => importOpenCode({ ...common, configDir: roots.opencodeDir, settings: settings.opencode })],
  ];
  const merged = emptyImports();
  for (const [label, run] of runs) {
    let part: Imports;
    try {
      part = await run();
    } catch (err: any) {
      merged.skipped.push({ item: `${label} setup`, origin: label, reason: err?.message ?? String(err) });
      continue;
    }
    for (const key of Object.keys(merged) as (keyof Imports)[]) (merged[key] as unknown[]).push(...(part[key] as unknown[]));
  }
  // On the same name, the first source wins (Claude Code, Codex, OpenCode); the rest are reported.
  const firstByName = <T extends { name: string; origin: string }>(items: T[], kind: string): T[] => {
    const seen = new Map<string, T>();
    for (const item of items) {
      const first = seen.get(item.name);
      if (first) merged.skipped.push({ item: `${kind} ${item.name}`, origin: item.origin, reason: `same name as the one from ${first.origin}` });
      else seen.set(item.name, item);
    }
    return [...seen.values()];
  };
  merged.mcpServers = firstByName(merged.mcpServers, "MCP server");
  merged.commands = firstByName(merged.commands, "command");
  return merged;
}

/** Everything kernl's own agent reuses for one workspace: the imports, plus the commands written as skills. */
export interface LoadedSources {
  imports: Imports;
  /** The folder of Claude Code commands as skills, when there are any. */
  commandsDir?: string;
}

/** collectImports, then the commands written as skills under `commandsBase` (kernl's storage). */
export async function loadSources(roots: SourceRoots, project: { root: string; trusted: boolean }, settings: SourceSettings, commandsBase: string): Promise<LoadedSources> {
  const imports = await collectImports(roots, project, settings);
  const { dir, skipped } = await writeCommandSkills(imports.commands, commandsBase);
  imports.skipped.push(...skipped);
  return { imports, commandsDir: dir };
}

/**
 * The Sources view: what kernl's own agent uses from each source, and what it doesn't and why.
 * Names and places only: no configured value (headers, env, commands' arguments) is shown.
 */
export function sourcesReport(imports: Imports, own: { mcpServers: string[] }): string {
  const lines = ["# kernl: loaded sources", "", "What kernl's own agent uses from Claude Code, Codex, and OpenCode (switch each kind in Settings > kernl > Sources). The CLI agents load their own setup themselves.", ""];
  const section = (title: string, rows: string[]) => {
    lines.push(`## ${title}`, "");
    lines.push(...(rows.length ? rows : ["None."]), "");
  };
  section("Skills folders", imports.skillFolders.map((f) => `- ${f.origin}`));
  section("Commands (as skills)", imports.commands.map((c) => `- /${c.name} (${c.origin})`));
  section("Agent folders", imports.agentFolders.map((f) => `- ${f.origin}`));
  section("Instructions", imports.instructions.map((i) => `- ${i.origin}${i.kind === "rule" ? " (rule)" : ""}`));
  section(
    "MCP servers",
    [
      ...own.mcpServers.map((n) => `- ${n} (kernl.mcpServers)`),
      ...imports.mcpServers.map((s) => `- ${s.name} (${s.origin}${"url" in s.connection ? `, ${s.connection.transport}` : ", local program"}${s.project ? ", asks before it first starts" : ""})`),
    ],
  );
  section("Workflows (run in Claude Code)", imports.workflows.map((w) => `- /${w.name} (${w.origin})`));
  section("Skipped", imports.skipped.map((s) => `- ${s.item} (${s.origin}): ${s.reason}`));
  return lines.join("\n");
}
