// Named agents: parsing and validation, user vs project precedence, and the tool guard, which
// refuses an agent's missing tools before the gate is asked, while its allowed actions still ask.
import { strict as assert } from "node:assert";
import { mkdirSync, mkdtempSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { test } from "node:test";
import { buildAgent } from "../../src/agent/createAgent";
import { blockedTools, loadNamedAgents, type NamedAgent, toolGuard } from "../../src/agent/namedAgents";
import { messageText, runScript, toolCall, workspace } from "../support/harness";
import { ScriptedChatModel } from "../support/scriptedModel";

function dirs(user: Record<string, string>, project: Record<string, string>, claude: { user?: Record<string, string>; project?: Record<string, string> } = {}) {
  const userDir = mkdtempSync(join(tmpdir(), "yourstack-user-"));
  const claudeDir = mkdtempSync(join(tmpdir(), "yourstack-claude-"));
  const projectRoot = mkdtempSync(join(tmpdir(), "yourstack-project-"));
  const put = (dir: string, files: Record<string, string> = {}) => {
    mkdirSync(dir, { recursive: true });
    for (const [n, t] of Object.entries(files)) writeFileSync(join(dir, n), t);
  };
  put(join(userDir, "agents"), user);
  put(join(projectRoot, ".yourstack/agents"), project);
  put(join(claudeDir, "agents"), claude.user);
  put(join(projectRoot, ".claude/agents"), claude.project);
  return { userDir, claudeDir, projectRoot };
}

const REVIEWER = "---\ndescription: Reviews changes; never edits\ntools: [run]\nmodel: small-model\n---\nYou review diffs and report problems.\n";

test("agent files parse: name defaults to the file name, tools and model are optional, the body is the prompt", async () => {
  const { agents, problems } = await loadNamedAgents({ ...dirs({}, { "reviewer.md": REVIEWER, "writer.md": "---\nname: docs-writer\ndescription: Writes docs\ntools: edit, run\n---\nWrite docs.\n" }), trusted: true });
  assert.deepEqual(problems, []);
  assert.deepEqual(agents.map((a) => [a.name, [...a.tools].sort(), a.model, a.prompt]), [
    ["docs-writer", ["edit", "run"], undefined, "Write docs."],
    ["reviewer", ["run"], "small-model", "You review diffs and report problems."],
  ]);
});

test("a project agent replaces the user's agent of the same name; Restricted Mode loads only the user's", async () => {
  const d = dirs({ "reviewer.md": "---\ndescription: user version\n---\nUSER\n", "mine.md": "---\ndescription: only mine\n---\nMINE\n" }, { "reviewer.md": REVIEWER });
  const trusted = await loadNamedAgents({ ...d, trusted: true });
  assert.deepEqual(trusted.agents.map((a) => [a.name, a.description]), [["mine", "only mine"], ["reviewer", "Reviews changes; never edits"]]);
  const restricted = await loadNamedAgents({ ...d, trusted: false });
  assert.deepEqual(restricted.agents.map((a) => [a.name, a.description]), [["mine", "only mine"], ["reviewer", "user version"]]);
});

test("malformed agent files are skipped, naming the file and the field", async () => {
  const { agents, problems } = await loadNamedAgents({
    ...dirs({}, {
      "no-desc.md": "---\ntools: [run]\n---\nx\n",
      "bad-tool.md": "---\ndescription: d\ntools: [run, sudo]\n---\nx\n",
      "Bad Name.md": "---\ndescription: d\n---\nx\n",
      "empty.md": "---\ndescription: d\n---\n",
      "ok.md": "---\ndescription: fine\n---\nhi\n",
    }),
    trusted: true,
  });
  assert.deepEqual(agents.map((a) => a.name), ["ok"]);
  const text = problems.join("\n");
  assert.match(text, /Bad Name\.md: expected name to be lowercase/);
  assert.match(text, /bad-tool\.md: expected tools to be a list of edit, run, browser, mcp/);
  assert.match(text, /empty\.md: expected the agent's instructions/);
  assert.match(text, /no-desc\.md: expected a description/);
});

test("an agent's missing tool groups map to the tool names present in this build", () => {
  const agent = { tools: new Set(["run"]) } as unknown as NamedAgent;
  assert.deepEqual([...blockedTools(agent, { browser: ["browser_click"], mcp: ["mcp_db_query"] })].sort(), ["browser_click", "delete", "edit_file", "mcp_db_query", "write_file"]);
});

test("the tool guard refuses a missing tool without asking; the agent's allowed actions still ask", async () => {
  const w = workspace(false);
  const agent = buildAgent({
    model: new ScriptedChatModel([toolCall("write_file", { file_path: "/x.txt", content: "x" }), toolCall("execute", { command: "npm test" })]),
    workspaceBackend: w.workspaceBackend,
    tools: [],
    loadProjectRules: false,
    middleware: [toolGuard("reviewer", new Set(["write_file", "edit_file", "delete"]))],
  });
  const out = await agent.invoke({ messages: [{ role: "user", content: "go" }] }, { configurable: { thread_id: "t" } });
  const results = out.messages.filter((m: any) => m.getType?.() === "tool").map((m: any) => messageText(m.content));
  assert.match(results[0], /write_file is not available to the reviewer agent/);
  assert.deepEqual(w.asked.map((r) => r.kind), ["execute"], "only the allowed action reached the gate");
});

test("the main agent can delegate to a named agent, which runs with its own model and tool guard", async () => {
  const w = workspace(true);
  const reviewerModel = new ScriptedChatModel([toolCall("write_file", { file_path: "/x.txt", content: "x" }), toolCall("execute", { command: "git diff" })]);
  let reviewerRan = false;
  const original = reviewerModel._generate.bind(reviewerModel);
  reviewerModel._generate = async (m: any) => ((reviewerRan = true), original(m));
  const results = await runScript(w.backend, [toolCall("task", { description: "review the diff", subagent_type: "reviewer" })], [], {
    subagents: [{ name: "reviewer", description: "Reviews changes", systemPrompt: "Review.", model: reviewerModel, middleware: [toolGuard("reviewer", new Set(["write_file", "edit_file", "delete"]))] }],
  });
  assert.ok(reviewerRan, "the named agent's own model ran");
  assert.deepEqual(w.asked.map((r) => r.kind), ["execute"], "its blocked write never asked; its command did");
  assert.ok(results.length > 0);
});

test("Claude Code agent files load: tools map to groups, specifiers and unknown tools are ignored, model is ignored", async () => {
  const { agents, problems } = await loadNamedAgents({
    ...dirs({}, {}, {
      project: {
        "git-helper.md": "---\nname: git-helper\ndescription: Runs git\ntools: Read, Grep, Bash(git *), TodoWrite\nmodel: sonnet\npermissionMode: bypassPermissions\n---\nUse git.\n",
        "writer.md": "---\nname: writer\ndescription: Writes\ntools: [Read, Edit, Write, mcp__github__create_issue]\n---\nWrite.\n",
        "everything-but-shell.md": "---\nname: everything-but-shell\ndescription: No shell\ndisallowedTools: Bash\n---\nNo shell.\n",
      },
    }),
    trusted: true,
  });
  assert.deepEqual(problems, []);
  const byName = Object.fromEntries(agents.map((a) => [a.name, a]));
  assert.deepEqual([...byName["git-helper"].tools], ["run"]);
  assert.equal(byName["git-helper"].model, undefined, "Claude model aliases mean the current model");
  assert.deepEqual([...byName.writer.tools].sort(), ["edit", "mcp"]);
  assert.deepEqual([...byName["everything-but-shell"].tools].sort(), ["browser", "edit", "mcp"]);
});

test(".yourstack wins over .claude on the same name; the user's ~/.claude agents load even in Restricted Mode", async () => {
  const d = dirs({}, { "reviewer.md": "---\ndescription: yourstack version\n---\nYS\n" }, {
    user: { "mine.md": "---\nname: mine\ndescription: from ~/.claude\n---\nMINE\n" },
    project: { "reviewer.md": "---\nname: reviewer\ndescription: claude version\n---\nCC\n" },
  });
  const trusted = await loadNamedAgents({ ...d, trusted: true });
  assert.deepEqual(trusted.agents.map((a) => [a.name, a.description]), [["mine", "from ~/.claude"], ["reviewer", "yourstack version"]]);
  const restricted = await loadNamedAgents({ ...d, trusted: false });
  assert.deepEqual(restricted.agents.map((a) => a.name), ["mine"]);
});
