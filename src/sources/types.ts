// What kernl's own agent can reuse from the other agents' setup (Claude Code, Codex, OpenCode), and
// the switches for it (kernl.sources.*). The CLI agents load their own setup themselves; these
// importers only feed kernl's own agent. Importers read files and return plain data: they never
// start programs, and never log or show a configured value (headers, env), only names and places.

export interface SourceSettings {
  claudeCode: { skills: boolean; commands: boolean; agents: boolean; instructions: boolean; mcpServers: boolean; plugins: boolean };
  codex: { skills: boolean; mcpServers: boolean };
  opencode: { skills: boolean; mcpServers: boolean; instructions: boolean };
}

/** The switches, from VS Code's settings (`get` is a WorkspaceConfiguration's). */
export function sourceSettings(c: { get<T>(key: string, fallback: T): T }): SourceSettings {
  const on = (key: string) => c.get<boolean>(`sources.${key}`, true) !== false;
  return {
    claudeCode: { skills: on("claudeCode.skills"), commands: on("claudeCode.commands"), agents: on("claudeCode.agents"), instructions: on("claudeCode.instructions"), mcpServers: on("claudeCode.mcpServers"), plugins: on("claudeCode.plugins") },
    codex: { skills: on("codex.skills"), mcpServers: on("codex.mcpServers") },
    opencode: { skills: on("opencode.skills"), mcpServers: on("opencode.mcpServers"), instructions: on("opencode.instructions") },
  };
}

/** Where an item came from, as shown in the Sources view ("Claude Code: ~/.claude/skills"). */
export interface Origin {
  origin: string;
  /** From a file in the project (trusted workspaces only; a project MCP server asks before it first starts). */
  project: boolean;
}

/** A folder of Agent Skills (`<skill>/SKILL.md`). */
export interface SkillFolder extends Origin {
  dir: string;
}

/** A single-file command (Claude Code's `commands/<name>.md`), offered to kernl's agent as a skill. */
export interface CommandFile extends Origin {
  name: string;
  file: string;
}

/** A folder of Claude Code-format subagents (`<name>.md`). */
export interface AgentFolder extends Origin {
  dir: string;
}

/** An instruction file: always followed (CLAUDE.md), or a rule with optional `paths` globs (`.claude/rules`). */
export interface InstructionFile extends Origin {
  file: string;
  kind: "always" | "rule";
}

/** How to reach an MCP server: a local program, or a URL with optional headers. */
export type McpConnection =
  | { command: string; args: string[]; env?: Record<string, string> }
  | { url: string; transport: "http" | "sse"; headers?: Record<string, string> };

export interface ImportedMcpServer extends Origin {
  name: string;
  connection: McpConnection;
}

/** A Claude Code workflow: listed, since only Claude Code's runtime can run it. */
export interface Workflow extends Origin {
  name: string;
}

/** Something a source has that kernl's agent doesn't use, and why. */
export interface Skipped {
  item: string;
  origin: string;
  reason: string;
}

export interface Imports {
  skillFolders: SkillFolder[];
  commands: CommandFile[];
  agentFolders: AgentFolder[];
  instructions: InstructionFile[];
  mcpServers: ImportedMcpServer[];
  workflows: Workflow[];
  skipped: Skipped[];
}

export const emptyImports = (): Imports => ({ skillFolders: [], commands: [], agentFolders: [], instructions: [], mcpServers: [], workflows: [], skipped: [] });

/**
 * `${VAR}` and `${VAR:-default}` in a configured string, the way Claude Code expands `.mcp.json`.
 * An unset variable without a default stays as written, so the server reports it rather than kernl
 * guessing.
 */
export function expandEnv(value: string, env: Record<string, string | undefined>, extra: Record<string, string> = {}): string {
  return value.replace(/\$\{([A-Za-z_][A-Za-z0-9_]*)(?::-([^}]*))?\}/g, (whole, name: string, fallback: string | undefined) => extra[name] ?? env[name] ?? fallback ?? whole);
}

/** A path shown in the Sources view with the home folder as `~`. */
export function shown(path: string, home: string): string {
  return home && path.startsWith(home) ? `~${path.slice(home.length)}` : path;
}
