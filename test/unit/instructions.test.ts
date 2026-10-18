// The user's and the project's instructions: what loads where, how rule frontmatter is read, and
// that malformed files are skipped with the file and field named.
import { strict as assert } from "node:assert";
import { mkdirSync, mkdtempSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { test } from "node:test";
import { buildAgent } from "../../src/agent/createAgent";
import { assembleInstructions } from "../../src/agent/instructions";
import { workspace } from "../support/harness";
import { ScriptedChatModel } from "../support/scriptedModel";

function dirs(rules: Record<string, string> = {}, userAgentsMd?: string) {
  const userDir = mkdtempSync(join(tmpdir(), "yourstack-user-"));
  const projectRoot = mkdtempSync(join(tmpdir(), "yourstack-project-"));
  if (userAgentsMd !== undefined) writeFileSync(join(userDir, "AGENTS.md"), userAgentsMd);
  if (Object.keys(rules).length) mkdirSync(join(projectRoot, ".yourstack/rules"), { recursive: true });
  for (const [name, text] of Object.entries(rules)) writeFileSync(join(projectRoot, ".yourstack/rules", name), text);
  return { userDir, projectRoot };
}

const RULES = {
  "style.md": "---\nalwaysApply: true\n---\nUse tabs. ALWAYS-MARKER\n",
  "db.md": "---\ndescription: How we write migrations\nglobs: [\"db/**\", \"migrations/*.sql\"]\n---\nNever drop columns. LISTED-MARKER\n",
  "api.md": "---\nglobs: src/api/**, src/routes/**\n---\nREST only.\n",
  "manual.md": "No frontmatter here.\n",
  "notes.txt": "not a rule",
};

test("an alwaysApply rule is in the prompt; other rules are listed with their description and globs, not inlined", async () => {
  const { prompt, problems } = await assembleInstructions({ ...dirs(RULES), trusted: true });
  assert.deepEqual(problems, []);
  assert.match(prompt, /Use tabs\. ALWAYS-MARKER/);
  assert.doesNotMatch(prompt, /LISTED-MARKER/, "listed rules are read on demand, not inlined");
  assert.match(prompt, /- \/\.yourstack\/rules\/db\.md: How we write migrations; applies to files matching db\/\*\*, migrations\/\*\.sql/);
  assert.match(prompt, /- \/\.yourstack\/rules\/api\.md: applies to files matching src\/api\/\*\*, src\/routes\/\*\*/);
  assert.match(prompt, /- \/\.yourstack\/rules\/manual\.md: read when the user mentions it/);
  assert.doesNotMatch(prompt, /notes\.txt/);
});

test("the user's own AGENTS.md loads everywhere; project rules never load in Restricted Mode", async () => {
  const trusted = await assembleInstructions({ ...dirs(RULES, "Reply tersely. USER-MARKER"), trusted: true });
  const restricted = await assembleInstructions({ ...dirs(RULES, "Reply tersely. USER-MARKER"), trusted: false });
  assert.match(trusted.prompt, /USER-MARKER/);
  assert.match(restricted.prompt, /USER-MARKER/);
  assert.doesNotMatch(restricted.prompt, /ALWAYS-MARKER|rules\/db\.md/);
});

test("no files means no extra instructions", async () => {
  assert.deepEqual(await assembleInstructions({ ...dirs(), trusted: true }), { prompt: "", problems: [] });
});

test("malformed rule files are skipped, naming the file and the problem", async () => {
  const { prompt, problems } = await assembleInstructions({
    ...dirs({
      "bad-yaml.md": "---\nglobs: [unclosed\n---\nx\n",
      "bad-always.md": "---\nalwaysApply: yes please\n---\nx\n",
      "bad-globs.md": "---\nglobs: 42\n---\nx\n",
      "bad-shape.md": "---\n- a\n- b\n---\nx\n",
      "good.md": "---\nalwaysApply: true\n---\nGOOD-MARKER\n",
    }),
    trusted: true,
  });
  assert.match(prompt, /GOOD-MARKER/);
  assert.equal(problems.length, 4);
  assert.match(problems.join("\n"), /bad-always\.md: expected alwaysApply to be true or false/);
  assert.match(problems.join("\n"), /bad-globs\.md: expected globs to be a glob or a list of globs, got 42/);
  assert.match(problems.join("\n"), /bad-shape\.md: expected frontmatter to be key: value pairs/);
  assert.match(problems.join("\n"), /bad-yaml\.md: frontmatter is not valid YAML/);
});

test("the instructions reach the model's system prompt", async () => {
  const w = workspace(true);
  const model = new ScriptedChatModel([]);
  let seen = "";
  const original = model._generate.bind(model);
  model._generate = async (messages: any) => ((seen = JSON.stringify(messages.map((m: any) => m.content))), original(messages));
  await buildAgent({ model, workspaceBackend: w.workspaceBackend, tools: [], loadProjectRules: false, instructions: "INSTRUCTIONS-MARKER-42" }).invoke({ messages: [{ role: "user", content: "hi" }] }, { configurable: { thread_id: "t" } });
  assert.match(seen, /INSTRUCTIONS-MARKER-42/);
});
