// Codex's setup, for kernl's own agent: skills (`~/.agents/skills`, the project's `.agents/skills`)
// and MCP servers (`~/.codex/config.toml`, and in trusted workspaces the project's `.codex/config.toml`).
import { existsSync } from "node:fs";
import { readFile } from "node:fs/promises";
import { join } from "node:path";
import { parse } from "smol-toml";
import { type Imports, emptyImports, type McpConnection, type SourceSettings, shown } from "./types";

export interface CodexSource {
  /** `~/.codex`, or CODEX_HOME. */
  codexDir: string;
  home: string;
  projectRoot: string;
  trusted: boolean;
  settings: SourceSettings["codex"];
  env: Record<string, string | undefined>;
}

const LABEL = "Codex";

async function readToml(path: string): Promise<any | undefined> {
  let text: string;
  try {
    text = await readFile(path, "utf8");
  } catch (err: any) {
    if (err?.code === "ENOENT" || err?.code === "ENOTDIR") return undefined;
    throw err;
  }
  try {
    return parse(text);
  } catch (err: any) {
    throw new Error(`${path} isn't valid TOML (${err?.message ?? err})`);
  }
}

/** One `[mcp_servers.<name>]` table: a command, or a url with headers (literal, from env vars, or a bearer token env var). */
export function codexServer(raw: any, env: Record<string, string | undefined>): McpConnection | { skipped: string } {
  if (raw === null || typeof raw !== "object") return { skipped: "isn't a table" };
  if (raw.enabled === false) return { skipped: "turned off in Codex (enabled = false)" };
  const strings = (record: unknown) => (record && typeof record === "object" ? Object.fromEntries(Object.entries(record as Record<string, unknown>).map(([k, v]) => [k, String(v)])) : undefined);
  if (typeof raw.command === "string") return { command: raw.command, args: Array.isArray(raw.args) ? raw.args.map(String) : [], env: strings(raw.env) };
  if (typeof raw.url === "string") {
    const headers: Record<string, string> = { ...(strings(raw.http_headers) ?? {}) };
    for (const [header, variable] of Object.entries((raw.env_http_headers ?? {}) as Record<string, unknown>)) {
      const value = env[String(variable)];
      if (value !== undefined) headers[header] = value;
    }
    if (typeof raw.bearer_token_env_var === "string") {
      const token = env[raw.bearer_token_env_var];
      if (token === undefined) return { skipped: `its token variable ${raw.bearer_token_env_var} isn't set` };
      headers.Authorization = `Bearer ${token}`;
    }
    return { url: raw.url, transport: "http", headers: Object.keys(headers).length ? headers : undefined };
  }
  return { skipped: "has neither a command nor a url" };
}

export async function importCodex(src: CodexSource): Promise<Imports> {
  const out = emptyImports();
  if (src.settings.skills) {
    const user = join(src.home, ".agents/skills");
    if (existsSync(user)) out.skillFolders.push({ dir: user, origin: `${LABEL}: ${shown(user, src.home)}`, project: false });
    if (src.trusted && existsSync(join(src.projectRoot, ".agents/skills"))) out.skillFolders.push({ dir: join(src.projectRoot, ".agents/skills"), origin: `${LABEL}: project .agents/skills`, project: true });
  }
  if (src.settings.mcpServers) {
    const configs: [string, string, boolean][] = [[join(src.codexDir, "config.toml"), `${LABEL}: ${shown(join(src.codexDir, "config.toml"), src.home)}`, false]];
    if (src.trusted) configs.push([join(src.projectRoot, ".codex/config.toml"), `${LABEL}: project .codex/config.toml`, true]);
    for (const [file, origin, project] of configs) {
      const config = await readToml(file);
      for (const [name, raw] of Object.entries((config?.mcp_servers ?? {}) as Record<string, unknown>)) {
        const connection = codexServer(raw, src.env);
        if ("skipped" in connection) out.skipped.push({ item: `MCP server ${name}`, origin, reason: connection.skipped });
        else out.mcpServers.push({ name, origin, project, connection });
      }
    }
  }
  return out;
}
