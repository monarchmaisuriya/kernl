import { existsSync } from "node:fs";
import { readdir, readFile } from "node:fs/promises";
import { join } from "node:path";
import type { AnyBackendProtocol } from "deepagents";
import { ReadOnlyBackend } from "../backend/gatedBackend";
import type { ApprovalGate } from "../gate/approvalGate";
import type { SkillView } from "../ui/protocol";
import { splitFrontmatter } from "./instructions";

/**
 * Agent Skills (`<folder>/<skill>/SKILL.md`, the format Claude Code and Deep Agents share) from
 * the user's `~/.claude/skills` and `~/.yourstack/skills`, then the project's `.claude/skills` and
 * `.yourstack/skills` (trusted workspaces only). Later sources win on the same skill name. The
 * user's folders are outside the workspace, so they're mounted read-only under /user-skills/.
 */
export interface SkillSources {
  sources: string[];
  routes: Record<string, AnyBackendProtocol>;
}

const USER_ROUTES = { claude: "/user-skills/claude/", yourstack: "/user-skills/yourstack/" };

export function skillSources(src: { userDir: string; claudeDir: string; projectRoot: string; trusted: boolean; gate: ApprovalGate }): SkillSources {
  const sources: string[] = [];
  const routes: Record<string, AnyBackendProtocol> = {};
  const userFolders: [keyof typeof USER_ROUTES, string][] = [["claude", join(src.claudeDir, "skills")], ["yourstack", join(src.userDir, "skills")]];
  for (const [kind, dir] of userFolders) {
    if (!existsSync(dir)) continue;
    routes[USER_ROUTES[kind]] = new ReadOnlyBackend(dir, src.gate, "Your skill folders are read-only to the agent.");
    sources.push(USER_ROUTES[kind]);
  }
  if (src.trusted) for (const dir of [".claude/skills", ".yourstack/skills"]) if (existsSync(join(src.projectRoot, dir))) sources.push(`/${dir}/`);
  return { sources, routes };
}

/** Skills by name for "/" in the composer: the same folders and precedence as skillSources, read from disk. */
export async function listSkills(src: { userDir: string; claudeDir: string; projectRoot: string; trusted: boolean }): Promise<SkillView[]> {
  const dirs = [join(src.claudeDir, "skills"), join(src.userDir, "skills"), ...(src.trusted ? [join(src.projectRoot, ".claude/skills"), join(src.projectRoot, ".yourstack/skills")] : [])];
  const byName = new Map<string, SkillView>();
  for (const dir of dirs) {
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
