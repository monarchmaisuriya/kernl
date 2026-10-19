import { readdir, readFile } from "node:fs/promises";
import { join, relative, sep } from "node:path";
import type { AnyBackendProtocol } from "deepagents";
import { ReadOnlyBackend } from "../backend/gatedBackend";
import type { ApprovalGate } from "../gate/approvalGate";
import type { SkillFolder } from "../sources/types";
import type { SkillView } from "../ui/protocol";
import { splitFrontmatter } from "./instructions";

/**
 * Agent Skills (`<folder>/<skill>/SKILL.md`, the format Claude Code, Codex, OpenCode, and Deep
 * Agents share). The folders, in order (a later folder wins on the same skill name):
 *  1. other agents' user-level folders (the Sources settings: ~/.claude/skills, synced, plugins, ~/.agents/skills, ...),
 *  2. Claude Code commands written as skills (kernl's storage),
 *  3. your ~/.kernl/skills,
 *  4. other agents' project folders (trusted workspaces only),
 *  5. the project's .kernl/skills (trusted workspaces only).
 * Folders outside the workspace are mounted read-only under /user-skills/.
 */
export interface SkillSources {
  sources: string[];
  routes: Record<string, AnyBackendProtocol>;
}

export interface SkillPlaces {
  userDir: string;
  projectRoot: string;
  trusted: boolean;
  /** Skill folders from the other agents' setup (src/sources). */
  imported: readonly SkillFolder[];
  /** Claude Code commands written as skills, if any. */
  commandsDir?: string;
}

/** Every skill folder, in precedence order, each with where the agent sees it. */
function skillFolders(src: SkillPlaces): { dir: string; inProject: boolean }[] {
  const folder = (dir: string) => ({ dir, inProject: isInside(src.projectRoot, dir) });
  return [
    ...src.imported.filter((f) => !f.project).map((f) => folder(f.dir)),
    ...(src.commandsDir ? [folder(src.commandsDir)] : []),
    folder(join(src.userDir, "skills")),
    ...(src.trusted ? src.imported.filter((f) => f.project).map((f) => folder(f.dir)) : []),
    ...(src.trusted ? [folder(join(src.projectRoot, ".kernl/skills"))] : []),
  ];
}

function isInside(root: string, path: string): boolean {
  const rel = relative(root, path);
  return !!root && !!rel && !rel.startsWith("..") && !rel.startsWith(sep);
}

export function skillSources(src: SkillPlaces & { gate: ApprovalGate }): SkillSources {
  const sources: string[] = [];
  const routes: Record<string, AnyBackendProtocol> = {};
  skillFolders(src).forEach(({ dir, inProject }, i) => {
    if (inProject) {
      sources.push(`/${relative(src.projectRoot, dir).split(sep).join("/")}/`);
      return;
    }
    const route = `/user-skills/${i}/`;
    routes[route] = new ReadOnlyBackend(dir, src.gate, "Skill folders outside the workspace are read-only to the agent.");
    sources.push(route);
  });
  return { sources, routes };
}

/** Skills by name for "/" in the composer: the same folders and precedence as skillSources, read from disk. */
export async function listSkills(src: SkillPlaces): Promise<SkillView[]> {
  const byName = new Map<string, SkillView>();
  for (const { dir } of skillFolders(src)) {
    let names: string[] = [];
    try {
      names = await readdir(dir);
    } catch {
      continue;
    }
    for (const n of names) {
      try {
        const { data } = splitFrontmatter(await readFile(join(dir, n, "SKILL.md"), "utf8"));
        const d = data as Record<string, unknown>;
        const name = typeof d?.name === "string" ? d.name : n;
        byName.set(name, { name, description: typeof d?.description === "string" ? d.description : "" });
      } catch {
        // Not a skill folder (no readable SKILL.md); Deep Agents skips it the same way.
      }
    }
  }
  return [...byName.values()].sort((a, b) => a.name.localeCompare(b.name));
}
