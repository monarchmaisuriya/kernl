// OpenCode's setup, for kernl's own agent: skills (`~/.config/opencode/skills`, the project's
// `.opencode/skills`), MCP servers (`mcp` in opencode.json / opencode.jsonc, yours and, in trusted
// workspaces, the project's), and instruction files (`instructions`).
import { existsSync } from "node:fs";
import { readFile } from "node:fs/promises";
import { dirname, isAbsolute, join } from "node:path";
// The ES module build: the default (UMD) build loads its parts at run time, which the bundle can't follow.
import { type ParseError, parse } from "jsonc-parser/lib/esm/main.js";
import { type Imports, emptyImports, type McpConnection, type SourceSettings, shown } from "./types";

export interface OpenCodeSource {
  /** `~/.config/opencode` (or `$XDG_CONFIG_HOME/opencode`). */
  configDir: string;
  home: string;
  projectRoot: string;
  trusted: boolean;
  settings: SourceSettings["opencode"];
  env: Record<string, string | undefined>;
}

const LABEL = "OpenCode";

/** The first of opencode.json / opencode.jsonc in a folder, parsed (comments and trailing commas allowed). */
async function readConfig(dir: string): Promise<{ file: string; config: any } | undefined> {
  for (const name of ["opencode.json", "opencode.jsonc"]) {
    const file = join(dir, name);
    let text: string;
    try {
      text = await readFile(file, "utf8");
    } catch (err: any) {
      if (err?.code === "ENOENT" || err?.code === "ENOTDIR") continue;
      throw err;
    }
    const errors: ParseError[] = [];
    const config = parse(text, errors, { allowTrailingComma: true });
    if (errors.length) throw new Error(`${file} isn't valid JSON (${errors.length} error(s), the first at offset ${errors[0].offset})`);
    return { file, config };
  }
  return undefined;
}

/** OpenCode's `{env:NAME}` in a configured string. */
const expand = (value: string, env: Record<string, string | undefined>) => value.replace(/\{env:([A-Za-z_][A-Za-z0-9_]*)\}/g, (whole, name: string) => env[name] ?? whole);

/** One `mcp` entry: `{ type: "local", command: [...], environment }` or `{ type: "remote", url, headers }`. */
export function opencodeServer(raw: any, env: Record<string, string | undefined>): McpConnection | { skipped: string } {
  if (raw === null || typeof raw !== "object") return { skipped: "isn't an object" };
  if (raw.enabled === false) return { skipped: "turned off in OpenCode (enabled: false)" };
  const values = (record: unknown) => (record && typeof record === "object" ? Object.fromEntries(Object.entries(record as Record<string, unknown>).map(([k, v]) => [k, expand(String(v), env)])) : undefined);
  if (raw.type === "local" && Array.isArray(raw.command) && raw.command.length) {
    const [command, ...args] = raw.command.map((c: unknown) => expand(String(c), env));
    return { command, args, env: values(raw.environment) };
  }
  if (raw.type === "remote" && typeof raw.url === "string") {
    if (raw.oauth && typeof raw.oauth === "object") return { skipped: "signs in with OAuth: use it in OpenCode" };
    return { url: expand(raw.url, env), transport: "http", headers: values(raw.headers) };
  }
  return { skipped: `its type ${JSON.stringify(raw.type)} isn't "local" or "remote"` };
}

export async function importOpenCode(src: OpenCodeSource): Promise<Imports> {
  const out = emptyImports();
  const userOrigin = (path: string) => `${LABEL}: ${shown(path, src.home)}`;
  if (src.settings.skills) {
    const user = join(src.configDir, "skills");
    if (existsSync(user)) out.skillFolders.push({ dir: user, origin: userOrigin(user), project: false });
    if (src.trusted && existsSync(join(src.projectRoot, ".opencode/skills"))) out.skillFolders.push({ dir: join(src.projectRoot, ".opencode/skills"), origin: `${LABEL}: project .opencode/skills`, project: true });
  }
  if (!src.settings.mcpServers && !src.settings.instructions) return out;
  const configs: { dir: string; project: boolean }[] = [{ dir: src.configDir, project: false }, ...(src.trusted ? [{ dir: src.projectRoot, project: true }] : [])];
  for (const { dir, project } of configs) {
    const found = await readConfig(dir);
    if (!found) continue;
    const origin = project ? `${LABEL}: project ${found.file.slice(src.projectRoot.length + 1)}` : userOrigin(found.file);
    if (src.settings.mcpServers) {
      for (const [name, raw] of Object.entries((found.config?.mcp ?? {}) as Record<string, unknown>)) {
        const connection = opencodeServer(raw, src.env);
        if ("skipped" in connection) out.skipped.push({ item: `MCP server ${name}`, origin, reason: connection.skipped });
        else out.mcpServers.push({ name, origin, project, connection });
      }
    }
    if (src.settings.instructions) {
      for (const entry of Array.isArray(found.config?.instructions) ? found.config.instructions : []) {
        const path = String(entry);
        if (/[*?[]/.test(path)) {
          out.skipped.push({ item: `instructions ${path}`, origin, reason: "a glob pattern; kernl reads listed files only" });
          continue;
        }
        const file = isAbsolute(path) ? path : join(project ? src.projectRoot : dirname(found.file), path);
        if (existsSync(file)) out.instructions.push({ file, kind: "always", origin, project });
        else out.skipped.push({ item: `instructions ${path}`, origin, reason: "the file doesn't exist" });
      }
    }
  }
  return out;
}
