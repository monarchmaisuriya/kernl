// Claude Code slash commands as Agent Skills for kernl's own agent. A command is one Markdown file;
// a skill is a folder with SKILL.md whose name is lowercase letters, digits, and single hyphens, and
// equals the folder's name (Deep Agents checks both). The skills are written into kernl's storage in a
// folder named by a hash of their content: a folder is never changed after it is written, so an agent
// still reading the last set is never disturbed, and the same commands reuse the same folder.
import { createHash, randomUUID } from "node:crypto";
import { existsSync } from "node:fs";
import { mkdir, readdir, readFile, rename, rm, stat, writeFile } from "node:fs/promises";
import { join } from "node:path";
import { splitFrontmatter } from "../agent/instructions";
import type { CommandFile, Skipped } from "./types";

/** Folders of earlier command sets are removed once they are this old. */
const KEEP_OLD_SETS_MS = 7 * 24 * 60 * 60 * 1000;

/** "render:deploy" -> "render-deploy": a valid skill name (and folder name), at most 64 characters. */
export function skillName(command: string): string {
  return command.toLowerCase().replace(/[^a-z0-9]+/g, "-").replace(/^-+|-+$/g, "").slice(0, 64).replace(/-+$/, "") || "command";
}

/** The SKILL.md for a command: its description, and its body as instructions for when it's used. */
export function commandSkill(command: string, text: string): string {
  let description = "";
  let body = text;
  try {
    const parsed = splitFrontmatter(text);
    const d = parsed.data as Record<string, unknown> | undefined;
    if (typeof d?.description === "string") description = d.description;
    body = parsed.body;
  } catch {
    // Frontmatter that isn't YAML: the whole file is the body.
  }
  const summary = (description || body.trim().split("\n")[0] || "").replace(/\s+/g, " ").slice(0, 200);
  return [
    "---",
    `name: ${skillName(command)}`,
    `description: ${JSON.stringify(`Claude Code command /${command}${summary ? `: ${summary}` : ""}`)}`,
    "---",
    "",
    `The user's /${command} command. When the user asks for it (or for what it does), follow these steps. $ARGUMENTS stands for what the user wrote after the command.`,
    "",
    body.trim(),
    "",
  ].join("\n");
}

/**
 * Writes the commands as skill folders under `base/<hash>`; returns that folder (undefined when there
 * are no commands) and the commands left out (two commands with the same skill name: the first wins).
 */
export async function writeCommandSkills(commands: readonly CommandFile[], base: string): Promise<{ dir?: string; skipped: Skipped[] }> {
  const skipped: Skipped[] = [];
  const skills = new Map<string, { command: string; text: string }>();
  for (const c of commands) {
    const name = skillName(c.name);
    const first = skills.get(name);
    if (first) {
      skipped.push({ item: `command /${c.name}`, origin: c.origin, reason: `its skill name ${name} is taken by /${first.command}` });
      continue;
    }
    let text: string;
    try {
      text = await readFile(c.file, "utf8");
    } catch (err: any) {
      skipped.push({ item: `command /${c.name}`, origin: c.origin, reason: `can't be read (${err?.code ?? err?.message ?? err})` });
      continue;
    }
    skills.set(name, { command: c.name, text: commandSkill(c.name, text) });
  }
  if (!skills.size) return { skipped };
  const hash = createHash("sha256");
  for (const [name, s] of [...skills].sort(([a], [b]) => a.localeCompare(b))) hash.update(`${name}\0${s.text}\0`);
  const dir = join(base, hash.digest("hex").slice(0, 16));
  if (!existsSync(dir)) {
    const temp = `${dir}.${randomUUID()}.tmp`;
    for (const [name, s] of skills) {
      await mkdir(join(temp, name), { recursive: true });
      await writeFile(join(temp, name, "SKILL.md"), s.text);
    }
    try {
      await rename(temp, dir);
    } catch (err: any) {
      // Another build wrote the same set first: same content, so use it.
      await rm(temp, { recursive: true, force: true });
      if (!existsSync(dir)) throw err;
    }
  }
  await removeOldSets(base, dir);
  return { dir, skipped };
}

async function removeOldSets(base: string, keep: string): Promise<void> {
  const now = Date.now();
  for (const name of await readdir(base)) {
    const path = join(base, name);
    if (path === keep) continue;
    const { mtimeMs } = await stat(path);
    if (now - mtimeMs > KEEP_OLD_SETS_MS) await rm(path, { recursive: true, force: true });
  }
}
