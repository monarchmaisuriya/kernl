import { readdir, readFile } from "node:fs/promises";
import { join } from "node:path";
import { parse as parseYaml } from "yaml";

/**
 * Instructions Deep Agents gets on top of its built-in prompt:
 * - the user's own `<userDir>/AGENTS.md`, always (it's theirs, so also in Restricted Mode);
 * - (the project's `/AGENTS.md` is loaded as Deep Agents memory by buildAgent, trusted workspaces only);
 * - project rules `.kernl/rules/*.md`, in trusted workspaces only. A rule with
 *   `alwaysApply: true` is put in the prompt; any other rule is listed with its description and
 *   globs, and the agent reads the file when it is relevant (reading doesn't ask).
 * Files only add knowledge: nothing here can change what is allowed (that is the gate's rules).
 */
export interface InstructionSources {
  userDir: string;
  projectRoot: string;
  trusted: boolean;
}

export interface Instructions {
  /** Appended to the system prompt. */
  prompt: string;
  /** Files skipped, each naming the file and the problem. */
  problems: string[];
}

export const RULES_DIR = ".kernl/rules";

interface Rule {
  file: string;
  description?: string;
  globs: string[];
  alwaysApply: boolean;
  body: string;
}

const FRONTMATTER = /^---\r?\n([\s\S]*?)\r?\n---\r?\n?([\s\S]*)$/;

/** Splits `---` YAML frontmatter from the body. A file without frontmatter is all body. */
export function splitFrontmatter(text: string): { data: unknown; body: string } {
  const m = FRONTMATTER.exec(text);
  return m ? { data: parseYaml(m[1]) ?? {}, body: m[2] } : { data: {}, body: text };
}

function parseRule(file: string, text: string): Rule | string {
  let parsed: { data: unknown; body: string };
  try {
    parsed = splitFrontmatter(text);
  } catch (err: any) {
    return `${file}: frontmatter is not valid YAML (${err?.message ?? err})`;
  }
  const d = parsed.data as Record<string, unknown>;
  if (typeof d !== "object" || d === null || Array.isArray(d)) return `${file}: expected frontmatter to be key: value pairs`;
  if (d.description !== undefined && typeof d.description !== "string") return `${file}: expected description to be text, got ${JSON.stringify(d.description)}`;
  if (d.alwaysApply !== undefined && typeof d.alwaysApply !== "boolean") return `${file}: expected alwaysApply to be true or false, got ${JSON.stringify(d.alwaysApply)}`;
  const globs = d.globs === undefined ? [] : typeof d.globs === "string" ? d.globs.split(",").map((g) => g.trim()).filter(Boolean) : d.globs;
  if (!Array.isArray(globs) || globs.some((g) => typeof g !== "string")) return `${file}: expected globs to be a glob or a list of globs, got ${JSON.stringify(d.globs)}`;
  return { file, description: d.description as string | undefined, globs: globs as string[], alwaysApply: d.alwaysApply === true, body: parsed.body.trim() };
}

async function readIfPresent(path: string): Promise<string | undefined> {
  try {
    return await readFile(path, "utf8");
  } catch (err: any) {
    if (err?.code === "ENOENT" || err?.code === "ENOTDIR") return undefined;
    throw err;
  }
}

export async function assembleInstructions(src: InstructionSources): Promise<Instructions> {
  const sections: string[] = [];
  const problems: string[] = [];
  const user = (await readIfPresent(join(src.userDir, "AGENTS.md")))?.trim();
  if (user) sections.push(`## The user's own instructions (~/.kernl/AGENTS.md)\n\n${user}`);
  if (!src.trusted) return { prompt: sections.join("\n\n"), problems };

  let names: string[] = [];
  try {
    names = (await readdir(join(src.projectRoot, RULES_DIR))).filter((n) => n.endsWith(".md")).sort();
  } catch (err: any) {
    if (err?.code !== "ENOENT" && err?.code !== "ENOTDIR") throw err;
  }
  const rules: Rule[] = [];
  for (const name of names) {
    const file = `/${RULES_DIR}/${name}`;
    const parsed = parseRule(file, await readFile(join(src.projectRoot, RULES_DIR, name), "utf8"));
    if (typeof parsed === "string") problems.push(parsed);
    else rules.push(parsed);
  }
  for (const r of rules.filter((r) => r.alwaysApply)) sections.push(`## Project rule (${r.file})\n\n${r.body}`);
  const listed = rules.filter((r) => !r.alwaysApply);
  if (listed.length) {
    const lines = listed.map((r) => {
      const when = [r.description, r.globs.length ? `applies to files matching ${r.globs.join(", ")}` : undefined].filter(Boolean).join("; ");
      return `- ${r.file}${when ? `: ${when}` : ": read when the user mentions it"}`;
    });
    sections.push(`## Project rules to read when relevant\n\nRead a rule's file with read_file before working on what it describes.\n\n${lines.join("\n")}`);
  }
  return { prompt: sections.join("\n\n"), problems };
}
