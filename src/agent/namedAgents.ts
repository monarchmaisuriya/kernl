import { readdir, readFile } from "node:fs/promises";
import { basename, join } from "node:path";
import { ToolMessage } from "@langchain/core/messages";
import { createMiddleware } from "langchain";
import { splitFrontmatter } from "./instructions";

/**
 * Named agents: Markdown files in `~/.yourstack/agents/` (the user's) and `.yourstack/agents/`
 * (the project's, trusted workspaces only; a project agent replaces a user agent of the same name).
 * Frontmatter: `name`, `description`, optional `tools`, optional `model`. The body is the prompt.
 * Claude Code subagents (`~/.claude/agents/`, `.claude/agents/`) load too, translated by
 * `fromClaudeAgent`; on the same name, `.yourstack/` wins over `.claude/`.
 * An agent can only have fewer tools than Deep Agents, never more, and every action it takes
 * still goes through the approval gate.
 */
export const TOOL_GROUPS = ["edit", "run", "browser", "mcp"] as const;
export type ToolGroup = (typeof TOOL_GROUPS)[number];

export interface NamedAgent {
  name: string;
  description: string;
  prompt: string;
  tools: ReadonlySet<ToolGroup>;
  /** A model id on the current Deep Agents provider; undefined uses the configured model. */
  model?: string;
  file: string;
}

export const AGENTS_DIR = ".yourstack/agents";
export const CLAUDE_AGENTS_DIR = ".claude/agents";
const NAME = /^[a-z0-9-]+$/;

/** Claude Code tool names (without a `(specifier)`) and the YourStack tool group each one needs. Reading is always allowed. */
const CLAUDE_TOOL_GROUPS: Record<string, ToolGroup | "read"> = {
  Read: "read", Grep: "read", Glob: "read", LS: "read",
  Edit: "edit", MultiEdit: "edit", Write: "edit", NotebookEdit: "edit",
  Bash: "run", PowerShell: "run",
  WebFetch: "browser", WebSearch: "browser",
};

function claudeTools(value: unknown): string[] | undefined {
  if (value === undefined) return undefined;
  const list = typeof value === "string" ? value.split(",") : Array.isArray(value) ? value : [];
  return list.map((t) => String(t).trim().replace(/\(.*\)$/, "")).filter(Boolean);
}

/**
 * A Claude Code subagent file as a YourStack agent. `tools`/`disallowedTools` map to tool groups
 * (unknown tools such as Agent or TodoWrite are ignored); `mcp__*` tools mean the mcp group.
 * `model` is ignored (Claude aliases mean nothing on other providers): the current model is used.
 * `permissionMode`, `hooks`, and the like are ignored: YourStack's own approvals always apply.
 */
function fromClaudeAgent(file: string, text: string): NamedAgent | string {
  let parsed: { data: unknown; body: string };
  try {
    parsed = splitFrontmatter(text);
  } catch (err: any) {
    return `${file}: frontmatter is not valid YAML (${err?.message ?? err})`;
  }
  const d = parsed.data as Record<string, unknown>;
  if (typeof d !== "object" || d === null || Array.isArray(d)) return `${file}: expected frontmatter to be key: value pairs`;
  const name = d.name ?? basename(file, ".md");
  if (typeof name !== "string" || !NAME.test(name)) return `${file}: expected name to be lowercase letters, digits, or dashes, got ${JSON.stringify(name)}`;
  if (typeof d.description !== "string" || !d.description.trim()) return `${file}: expected a description saying when to use this agent`;
  if (!parsed.body.trim()) return `${file}: expected the agent's instructions after the frontmatter`;
  const groupOf = (tool: string) => (tool.startsWith("mcp__") ? "mcp" : CLAUDE_TOOL_GROUPS[tool]);
  const allowed = claudeTools(d.tools);
  const tools = new Set<ToolGroup>(allowed === undefined ? TOOL_GROUPS : (allowed.map(groupOf).filter((g) => g && g !== "read") as ToolGroup[]));
  for (const t of claudeTools(d.disallowedTools) ?? []) {
    const g = groupOf(t);
    if (g && g !== "read") tools.delete(g);
  }
  return { name, description: d.description.trim(), prompt: parsed.body.trim(), tools, file };
}

function parseAgent(file: string, text: string): NamedAgent | string {
  let parsed: { data: unknown; body: string };
  try {
    parsed = splitFrontmatter(text);
  } catch (err: any) {
    return `${file}: frontmatter is not valid YAML (${err?.message ?? err})`;
  }
  const d = parsed.data as Record<string, unknown>;
  if (typeof d !== "object" || d === null || Array.isArray(d)) return `${file}: expected frontmatter to be key: value pairs`;
  const name = d.name ?? basename(file, ".md");
  if (typeof name !== "string" || !NAME.test(name)) return `${file}: expected name to be lowercase letters, digits, or dashes, got ${JSON.stringify(name)}`;
  if (typeof d.description !== "string" || !d.description.trim()) return `${file}: expected a description saying when to use this agent`;
  const tools = d.tools === undefined ? [...TOOL_GROUPS] : typeof d.tools === "string" ? d.tools.split(",").map((t) => t.trim()).filter(Boolean) : d.tools;
  if (!Array.isArray(tools) || tools.some((t) => !(TOOL_GROUPS as readonly unknown[]).includes(t))) {
    return `${file}: expected tools to be a list of ${TOOL_GROUPS.join(", ")}, got ${JSON.stringify(d.tools)}`;
  }
  if (d.model !== undefined && (typeof d.model !== "string" || !d.model.trim())) return `${file}: expected model to be a model id, got ${JSON.stringify(d.model)}`;
  if (!parsed.body.trim()) return `${file}: expected the agent's instructions after the frontmatter`;
  return { name, description: d.description.trim(), prompt: parsed.body.trim(), tools: new Set(tools as ToolGroup[]), model: (d.model as string | undefined)?.trim(), file };
}

async function loadDir(dir: string, label: string, parse = parseAgent): Promise<{ agents: NamedAgent[]; problems: string[] }> {
  let names: string[];
  try {
    names = (await readdir(dir)).filter((n) => n.endsWith(".md")).sort();
  } catch (err: any) {
    if (err?.code === "ENOENT" || err?.code === "ENOTDIR") return { agents: [], problems: [] };
    throw err;
  }
  const agents: NamedAgent[] = [];
  const problems: string[] = [];
  for (const n of names) {
    const parsed = parse(`${label}/${n}`, await readFile(join(dir, n), "utf8"));
    if (typeof parsed === "string") problems.push(parsed);
    else agents.push(parsed);
  }
  return { agents, problems };
}

/** Later sources win on the same name: ~/.claude, ~/.yourstack, then the project's .claude and .yourstack. */
export async function loadNamedAgents(src: { userDir: string; claudeDir: string; projectRoot: string; trusted: boolean }): Promise<{ agents: NamedAgent[]; problems: string[] }> {
  const none = { agents: [], problems: [] };
  const sources = [
    await loadDir(join(src.claudeDir, "agents"), "~/.claude/agents", fromClaudeAgent),
    await loadDir(join(src.userDir, "agents"), "~/.yourstack/agents"),
    src.trusted ? await loadDir(join(src.projectRoot, CLAUDE_AGENTS_DIR), `/${CLAUDE_AGENTS_DIR}`, fromClaudeAgent) : none,
    src.trusted ? await loadDir(join(src.projectRoot, AGENTS_DIR), `/${AGENTS_DIR}`) : none,
  ];
  const byName = new Map<string, NamedAgent>();
  for (const a of sources.flatMap((s) => s.agents)) byName.set(a.name, a);
  return { agents: [...byName.values()].sort((a, b) => a.name.localeCompare(b.name)), problems: sources.flatMap((s) => s.problems) };
}

/** The tool names an agent may not call, given the tools actually present in this build. */
export function blockedTools(agent: NamedAgent, present: { browser: string[]; mcp: string[] }): Set<string> {
  const blocked = new Set<string>();
  if (!agent.tools.has("edit")) for (const t of ["write_file", "edit_file", "delete"]) blocked.add(t);
  if (!agent.tools.has("run")) blocked.add("execute");
  if (!agent.tools.has("browser")) for (const t of present.browser) blocked.add(t);
  if (!agent.tools.has("mcp")) for (const t of present.mcp) blocked.add(t);
  return blocked;
}

/** Refuses the agent's blocked tools before they run (and before any approval card). */
export function toolGuard(agentName: string, blocked: ReadonlySet<string>) {
  return createMiddleware({
    name: `ToolGuard_${agentName.replace(/-/g, "_")}`,
    wrapToolCall: async (request, handler) => {
      if (!blocked.has(request.toolCall.name)) return handler(request);
      return new ToolMessage({ content: `${request.toolCall.name} is not available to the ${agentName} agent.`, tool_call_id: request.toolCall.id ?? "", name: request.toolCall.name });
    },
  });
}
