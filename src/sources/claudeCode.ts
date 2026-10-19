// Claude Code's setup, for kernl's own agent: skills (yours, synced, the project's), slash commands,
// subagents, CLAUDE.md and .claude/rules, MCP servers (~/.claude.json, the project's .mcp.json),
// and enabled plugins (their skills, commands, agents, MCP servers). Workflows and hooks need Claude
// Code's own runtime: workflows are listed, hooks are reported as skipped.
import { existsSync } from "node:fs";
import { readdir, readFile } from "node:fs/promises";
import { basename, join } from "node:path";
import { type Imports, emptyImports, expandEnv, type ImportedMcpServer, type McpConnection, type SourceSettings, shown } from "./types";

export interface ClaudeCodeSource {
  /** `~/.claude`, or CLAUDE_CONFIG_DIR. */
  claudeDir: string;
  /** `~/.claude.json` (user and per-project MCP servers), or `$CLAUDE_CONFIG_DIR/.claude.json`. */
  claudeJson: string;
  projectRoot: string;
  trusted: boolean;
  settings: SourceSettings["claudeCode"];
  env: Record<string, string | undefined>;
  home: string;
}

const LABEL = "Claude Code";

async function readJson(path: string): Promise<any | undefined> {
  try {
    return JSON.parse(await readFile(path, "utf8"));
  } catch (err: any) {
    if (err?.code === "ENOENT" || err?.code === "ENOTDIR") return undefined;
    throw new Error(`${path} isn't valid JSON (${err?.message ?? err})`);
  }
}

async function entries(dir: string): Promise<string[]> {
  try {
    return await readdir(dir);
  } catch {
    return [];
  }
}

/** `<name>.md` files in a commands folder (and one level of subfolders, named `folder:name`, as Claude Code does). */
async function commandFiles(dir: string, prefix = ""): Promise<{ name: string; file: string }[]> {
  const out: { name: string; file: string }[] = [];
  for (const entry of await entries(dir)) {
    const path = join(dir, entry);
    if (entry.endsWith(".md")) out.push({ name: `${prefix}${entry.slice(0, -3)}`, file: path });
    else if (!prefix && !entry.startsWith(".") && existsSync(path) && (await entries(path)).length) out.push(...(await commandFiles(path, `${entry}:`)));
  }
  return out;
}

/** One configured server, in Claude Code's `.mcp.json` / `~/.claude.json` shape. */
export function claudeServer(name: string, raw: any, origin: string, project: boolean, expand: (value: string) => string): ImportedMcpServer | { skipped: string } {
  if (raw === null || typeof raw !== "object") return { skipped: "isn't an object" };
  if (raw.oauth) return { skipped: "signs in with OAuth: use it in Claude Code" };
  if (raw.headersHelper) return { skipped: "gets its headers by running a program" };
  const values = (record: unknown) =>
    record && typeof record === "object" ? Object.fromEntries(Object.entries(record as Record<string, unknown>).map(([k, v]) => [k, expand(String(v))])) : undefined;
  let connection: McpConnection;
  if (typeof raw.command === "string") {
    connection = { command: expand(raw.command), args: Array.isArray(raw.args) ? raw.args.map((a: unknown) => expand(String(a))) : [], env: values(raw.env) };
  } else if (typeof raw.url === "string") {
    connection = { url: expand(raw.url), transport: raw.type === "sse" ? "sse" : "http", headers: values(raw.headers) };
  } else return { skipped: "has neither a command nor a url" };
  return { name, origin, project, connection };
}

function addServers(out: Imports, servers: unknown, origin: string, project: boolean, expand: (value: string) => string) {
  if (!servers || typeof servers !== "object") return;
  for (const [name, raw] of Object.entries(servers as Record<string, unknown>)) {
    const server = claudeServer(name, raw, origin, project, expand);
    if ("skipped" in server) out.skipped.push({ item: `MCP server ${name}`, origin, reason: server.skipped });
    else out.mcpServers.push(server);
  }
}

/** The enabled plugins' install folders (installed_plugins.json, enabledPlugins in settings.json). */
async function enabledPlugins(claudeDir: string): Promise<{ id: string; name: string; root: string }[]> {
  const installed = await readJson(join(claudeDir, "plugins", "installed_plugins.json"));
  const settings = await readJson(join(claudeDir, "settings.json"));
  const enabled = (settings?.enabledPlugins ?? {}) as Record<string, unknown>;
  const out: { id: string; name: string; root: string }[] = [];
  for (const [id, installs] of Object.entries((installed?.plugins ?? {}) as Record<string, unknown>)) {
    if (enabled[id] !== true) continue;
    const list = Array.isArray(installs) ? installs : [installs];
    const install = list.find((i: any) => i?.scope === "user") ?? list[0];
    if (typeof (install as any)?.installPath === "string") out.push({ id, name: id.split("@")[0], root: (install as any).installPath });
  }
  return out;
}

export async function importClaudeCode(src: ClaudeCodeSource): Promise<Imports> {
  const out = emptyImports();
  const { claudeDir, projectRoot, trusted, settings: on } = src;
  const user = (path: string) => `${LABEL}: ${shown(path, src.home)}`;
  const projectOrigin = (rel: string) => `${LABEL}: project ${rel}`;
  const expand = (value: string) => expandEnv(value, src.env);

  if (on.skills) {
    const skills = join(claudeDir, "skills");
    if (existsSync(skills)) out.skillFolders.push({ dir: skills, origin: user(skills), project: false });
    // Skills synced from claude.ai sit one level deeper: skills/synced/<id>/<name>/SKILL.md. Hidden
    // folders there (.bucket-<id>) are Claude Code's staging copies of the same skills.
    for (const id of (await entries(join(skills, "synced"))).filter((n) => !n.startsWith("."))) out.skillFolders.push({ dir: join(skills, "synced", id), origin: user(join(skills, "synced", id)), project: false });
    if (trusted && existsSync(join(projectRoot, ".claude/skills"))) out.skillFolders.push({ dir: join(projectRoot, ".claude/skills"), origin: projectOrigin(".claude/skills"), project: true });
  }
  if (on.commands) {
    for (const c of await commandFiles(join(claudeDir, "commands"))) out.commands.push({ ...c, origin: user(join(claudeDir, "commands")), project: false });
    if (trusted) for (const c of await commandFiles(join(projectRoot, ".claude/commands"))) out.commands.push({ ...c, origin: projectOrigin(".claude/commands"), project: true });
  }
  if (on.agents) {
    if (existsSync(join(claudeDir, "agents"))) out.agentFolders.push({ dir: join(claudeDir, "agents"), origin: user(join(claudeDir, "agents")), project: false });
    if (trusted && existsSync(join(projectRoot, ".claude/agents"))) out.agentFolders.push({ dir: join(projectRoot, ".claude/agents"), origin: projectOrigin(".claude/agents"), project: true });
  }
  if (on.instructions) {
    if (existsSync(join(claudeDir, "CLAUDE.md"))) out.instructions.push({ file: join(claudeDir, "CLAUDE.md"), kind: "always", origin: user(join(claudeDir, "CLAUDE.md")), project: false });
    if (trusted) {
      for (const rel of ["CLAUDE.md", ".claude/CLAUDE.md"]) if (existsSync(join(projectRoot, rel))) out.instructions.push({ file: join(projectRoot, rel), kind: "always", origin: projectOrigin(rel), project: true });
      for (const name of (await entries(join(projectRoot, ".claude/rules"))).filter((n) => n.endsWith(".md")).sort()) {
        out.instructions.push({ file: join(projectRoot, ".claude/rules", name), kind: "rule", origin: projectOrigin(`.claude/rules/${name}`), project: true });
      }
    }
  }
  if (on.mcpServers) {
    const config = await readJson(src.claudeJson);
    addServers(out, config?.mcpServers, user(src.claudeJson), false, expand);
    // Your own servers for this project ("local" scope), kept in ~/.claude.json too.
    addServers(out, config?.projects?.[projectRoot]?.mcpServers, `${user(src.claudeJson)} (this project)`, false, expand);
    if (trusted) {
      const mcpJson = await readJson(join(projectRoot, ".mcp.json"));
      addServers(out, mcpJson?.mcpServers, projectOrigin(".mcp.json"), true, expand);
    }
  }
  if (on.plugins) {
    for (const plugin of await enabledPlugins(claudeDir)) {
      const origin = `${LABEL} plugin ${plugin.name}`;
      const root = plugin.root;
      if (!existsSync(root)) {
        out.skipped.push({ item: `plugin ${plugin.name}`, origin, reason: `its folder is missing (${shown(root, src.home)})` });
        continue;
      }
      if (existsSync(join(root, "skills"))) out.skillFolders.push({ dir: join(root, "skills"), origin, project: false });
      for (const c of await commandFiles(join(root, "commands"))) out.commands.push({ name: `${plugin.name}:${c.name}`, file: c.file, origin, project: false });
      if (existsSync(join(root, "agents"))) out.agentFolders.push({ dir: join(root, "agents"), origin, project: false });
      // Plugin paths use ${CLAUDE_PLUGIN_ROOT} (and ${CLAUDE_PLUGIN_DATA}).
      const pluginExpand = (value: string) => expandEnv(value, src.env, { CLAUDE_PLUGIN_ROOT: root, CLAUDE_PLUGIN_DATA: join(claudeDir, "plugins", "data", plugin.id) });
      const manifest = await readJson(join(root, ".claude-plugin", "plugin.json"));
      const declared = manifest?.mcpServers;
      if (typeof declared === "string") {
        // A file of servers: either { mcpServers: {...} } or the servers themselves.
        const file = await readJson(join(root, declared));
        addServers(out, file?.mcpServers ?? file, origin, false, pluginExpand);
      }
      else if (declared && typeof declared === "object") addServers(out, declared, origin, false, pluginExpand);
      else {
        const file = await readJson(join(root, ".mcp.json"));
        addServers(out, file?.mcpServers ?? file, origin, false, pluginExpand);
      }
      if (existsSync(join(root, "hooks"))) out.skipped.push({ item: `plugin ${plugin.name} hooks`, origin, reason: "hooks run only in Claude Code" });
      for (const name of (await entries(join(root, "workflows"))).filter((n) => n.endsWith(".js"))) out.workflows.push({ name: `${plugin.name}:${basename(name, ".js")}`, origin, project: false });
    }
  }
  // Workflows run only in Claude Code (its runtime); listed so you can see them.
  for (const [dir, origin, project] of [[join(claudeDir, "workflows"), user(join(claudeDir, "workflows")), false], ...(trusted ? [[join(projectRoot, ".claude/workflows"), projectOrigin(".claude/workflows"), true]] : [])] as [string, string, boolean][]) {
    for (const name of (await entries(dir)).filter((n) => n.endsWith(".js"))) out.workflows.push({ name: basename(name, ".js"), origin, project });
  }
  return out;
}
