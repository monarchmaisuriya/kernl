// Agent Skills from ~/.claude/skills, ~/.kernl/skills, and the project's .claude/skills and
// .kernl/skills reach the agent; the user's folders are read-only; project skills need trust.
import { strict as assert } from "node:assert";
import { mkdirSync, mkdtempSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { test } from "node:test";
import { buildAgent } from "../../src/agent/createAgent";
import { skillSources } from "../../src/agent/skills";
import { toolCall, workspace } from "../support/harness";
import { ScriptedChatModel } from "../support/scriptedModel";
import { messageText } from "../support/harness";

function skill(dir: string, name: string, description: string) {
  mkdirSync(join(dir, name), { recursive: true });
  writeFileSync(join(dir, name, "SKILL.md"), `---\nname: ${name}\ndescription: ${description}\n---\nSteps for ${name}.\n`);
}

async function run(trusted: boolean, script: any[] = []) {
  const w = workspace(true);
  const userDir = mkdtempSync(join(tmpdir(), "kernl-user-"));
  const claudeDir = mkdtempSync(join(tmpdir(), "kernl-claude-"));
  skill(join(claudeDir, "skills"), "release-notes", "Write release notes USER-CLAUDE-SKILL");
  skill(join(w.root, ".claude/skills"), "db-migrate", "Run database migrations PROJECT-CLAUDE-SKILL");
  skill(join(w.root, ".kernl/skills"), "deploy", "Deploy the service PROJECT-KERNL-SKILL");
  const skills = skillSources({ userDir, claudeDir, projectRoot: w.root, trusted, gate: w.gate });
  const model = new ScriptedChatModel(script);
  let seen = "";
  const original = model._generate.bind(model);
  model._generate = async (messages: any) => ((seen ||= JSON.stringify(messages.map((m: any) => m.content))), original(messages));
  const out = await buildAgent({ model, workspaceBackend: w.workspaceBackend, tools: [], loadProjectRules: false, skills }).invoke({ messages: [{ role: "user", content: "hi" }] }, { configurable: { thread_id: "t" } });
  return { seen, out, skills, claudeDir };
}

test("skills from the user's and the project's folders are offered to the agent", async () => {
  const { seen, skills } = await run(true);
  assert.deepEqual(skills.sources, ["/user-skills/claude/", "/.claude/skills/", "/.kernl/skills/"]);
  for (const marker of ["USER-CLAUDE-SKILL", "PROJECT-CLAUDE-SKILL", "PROJECT-KERNL-SKILL"]) assert.match(seen, new RegExp(marker));
});

test("project skills don't load in Restricted Mode; the user's own still do", async () => {
  const { seen } = await run(false);
  assert.match(seen, /USER-CLAUDE-SKILL/);
  assert.doesNotMatch(seen, /PROJECT-CLAUDE-SKILL|PROJECT-KERNL-SKILL/);
});

test("the agent can read a user skill but can't write into the user's skill folder", async () => {
  const { out } = await run(true, [
    toolCall("read_file", { file_path: "/user-skills/claude/release-notes/SKILL.md" }),
    toolCall("write_file", { file_path: "/user-skills/claude/evil/SKILL.md", content: "x" }),
  ]);
  const results = out.messages.filter((m: any) => m.getType?.() === "tool").map((m: any) => messageText(m.content));
  assert.match(results[0], /Steps for release-notes/);
  assert.match(results[1], /read-only/);
});
