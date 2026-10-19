// Reusing Claude Code's, Codex's, and OpenCode's setup in kernl's own agent: what each importer reads
// from fixture folders, what it skips and why, the switches, trust, the merge, and that the Sources
// report never shows a configured value.
import { strict as assert } from "node:assert";
import { mkdirSync, mkdtempSync, readdirSync, readFileSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { dirname, join } from "node:path";
import { test } from "node:test";
import { assembleInstructions } from "../../src/agent/instructions";
import { listSkills } from "../../src/agent/skills";
import { collectImports, loadSources, type SourceRoots, type SourceSettings, sourceSettings, sourcesReport } from "../../src/sources";
import { skillName, writeCommandSkills } from "../../src/sources/commands";

/** A fake header value; the report and the skipped list must never contain it. */
const SECRET = "fake-token-123";

const ALL_ON: SourceSettings = {
  claudeCode: { skills: true, commands: true, agents: true, instructions: true, mcpServers: true, plugins: true },
  codex: { skills: true, mcpServers: true },
  opencode: { skills: true, mcpServers: true, instructions: true },
};

function put(path: string, text: string) {
  mkdirSync(dirname(path), { recursive: true });
  writeFileSync(path, text);
}

const skill = (name: string, marker: string) => `---\nname: ${name}\ndescription: ${marker}\n---\nSteps.\n`;

/** A home folder with all three agents set up, and a project with its own setup. */
function fixture() {
  const home = mkdtempSync(join(tmpdir(), "kernl-sources-home-"));
  const project = mkdtempSync(join(tmpdir(), "kernl-sources-project-"));
  const claudeDir = join(home, ".claude");
  const claudeJson = join(home, ".claude.json");
  const codexDir = join(home, ".codex");
  const opencodeDir = join(home, ".config", "opencode");

  // Claude Code: user skills, a synced skill, commands (one in a subfolder), agents, CLAUDE.md, MCP servers.
  put(join(claudeDir, "skills/release-notes/SKILL.md"), skill("release-notes", "USER-SKILL"));
  put(join(claudeDir, "skills/synced/abc123/team-style/SKILL.md"), skill("team-style", "SYNCED-SKILL"));
  put(join(claudeDir, "commands/review.md"), "---\ndescription: Review the diff\n---\nReview $ARGUMENTS carefully.\n");
  put(join(claudeDir, "commands/git/commit.md"), "Write a commit message.\n");
  put(join(claudeDir, "agents/helper.md"), "---\nname: helper\ndescription: Helps\n---\nHelp.\n");
  put(join(claudeDir, "CLAUDE.md"), "USER-CLAUDE-MD\n");
  put(join(claudeDir, "workflows/nightly.js"), "export default {}\n");
  put(
    claudeJson,
    JSON.stringify({
      mcpServers: {
        docs: { type: "http", url: "https://docs.example.com/mcp", headers: { Authorization: `Bearer ${SECRET}` } },
        local: { command: "node", args: ["${HOME}/server.js"], env: { TOKEN: SECRET } },
        notion: { type: "http", url: "https://mcp.example.com/mcp", oauth: { clientId: "x" } },
        helper: { type: "http", url: "https://h.example.com", headersHelper: "./get-headers.sh" },
      },
      projects: { [project]: { mcpServers: { "project-local": { command: "uvx", args: ["tool"] } } } },
    }),
  );
  // An enabled plugin with skills, a command, an agent, MCP servers in a file named by plugin.json, hooks, and a workflow; and a disabled one.
  const plugin = join(claudeDir, "plugins/cache/market/deployer/1.0.0");
  put(join(claudeDir, "plugins/installed_plugins.json"), JSON.stringify({ version: 2, plugins: { "deployer@market": [{ scope: "user", installPath: plugin }], "off@market": [{ scope: "user", installPath: join(claudeDir, "plugins/cache/market/off/1.0.0") }] } }));
  put(join(claudeDir, "settings.json"), JSON.stringify({ enabledPlugins: { "deployer@market": true, "off@market": false } }));
  put(join(plugin, "skills/ship/SKILL.md"), skill("ship", "PLUGIN-SKILL"));
  put(join(plugin, "commands/deploy.md"), "Deploy it.\n");
  put(join(plugin, "agents/watcher.md"), "---\nname: watcher\ndescription: Watches\n---\nWatch.\n");
  put(join(plugin, ".claude-plugin/plugin.json"), JSON.stringify({ name: "deployer", mcpServers: "./servers.json" }));
  put(join(plugin, "servers.json"), JSON.stringify({ deployer: { command: "${CLAUDE_PLUGIN_ROOT}/bin/server", args: [] } }));
  put(join(plugin, "hooks/hooks.json"), "{}");
  put(join(plugin, "workflows/rollout.js"), "export default {}\n");

  // Codex: a command server, a URL server with headers from env vars, one turned off, one missing its token variable.
  put(
    join(codexDir, "config.toml"),
    [
      "[mcp_servers.search]",
      'command = "npx"',
      'args = ["-y", "search-server"]',
      "[mcp_servers.tracker]",
      'url = "https://tracker.example.com/mcp"',
      'env_http_headers = { "X-Key" = "TRACKER_KEY" }',
      "[mcp_servers.off]",
      'command = "x"',
      "enabled = false",
      "[mcp_servers.needs-token]",
      'url = "https://t.example.com/mcp"',
      'bearer_token_env_var = "UNSET_TOKEN_VAR"',
    ].join("\n"),
  );
  put(join(home, ".agents/skills/codex-skill/SKILL.md"), skill("codex-skill", "CODEX-SKILL"));

  // OpenCode: JSONC with comments, a local and a remote server, an OAuth one, a duplicate name, instruction files and a glob.
  put(
    join(opencodeDir, "opencode.jsonc"),
    `{
      // comments are allowed
      "mcp": {
        "files": { "type": "local", "command": ["bunx", "files-server"], "environment": { "KEY": "{env:FILES_KEY}" } },
        "web": { "type": "remote", "url": "https://web.example.com/mcp", "headers": { "Authorization": "Bearer {env:WEB_TOKEN}" } },
        "signin": { "type": "remote", "url": "https://s.example.com", "oauth": {} },
        "search": { "type": "local", "command": ["other"] },
      },
      "instructions": ["rules.md", "docs/*.md"],
    }`,
  );
  put(join(opencodeDir, "rules.md"), "OPENCODE-RULES\n");

  // The project: Claude Code skills, commands, agents, CLAUDE.md, rules, .mcp.json; Codex and OpenCode skills.
  put(join(project, ".claude/skills/db-migrate/SKILL.md"), skill("db-migrate", "PROJECT-SKILL"));
  put(join(project, ".claude/commands/test.md"), "Run the tests.\n");
  put(join(project, ".claude/agents/tester.md"), "---\nname: tester\ndescription: Tests\n---\nTest.\n");
  put(join(project, "CLAUDE.md"), "PROJECT-CLAUDE-MD\n");
  put(join(project, ".claude/rules/always.md"), "ALWAYS-RULE\n");
  put(join(project, ".claude/rules/api.md"), "---\npaths:\n  - src/api/**\n---\nAPI-RULE\n");
  put(join(project, ".mcp.json"), JSON.stringify({ mcpServers: { "project-db": { command: "./db-server" } } }));
  put(join(project, ".agents/skills/p-codex/SKILL.md"), skill("p-codex", "PROJECT-CODEX-SKILL"));
  put(join(project, ".opencode/skills/p-oc/SKILL.md"), skill("p-oc", "PROJECT-OC-SKILL"));

  const roots: SourceRoots = { claudeDir, claudeJson, codexDir, opencodeDir, home, env: { HOME: home, TRACKER_KEY: SECRET, FILES_KEY: SECRET, WEB_TOKEN: SECRET } };
  return { home, project, roots, plugin };
}

test("everything each agent has is imported in a trusted workspace, with where it came from", async () => {
  const { project, roots, plugin, home } = fixture();
  const imports = await collectImports(roots, { root: project, trusted: true }, ALL_ON);
  assert.deepEqual(imports.skillFolders.map((f) => [f.origin, f.project]), [
    ["Claude Code: ~/.claude/skills", false],
    ["Claude Code: ~/.claude/skills/synced/abc123", false],
    ["Claude Code: project .claude/skills", true],
    ["Claude Code plugin deployer", false],
    ["Codex: ~/.agents/skills", false],
    ["Codex: project .agents/skills", true],
    ["OpenCode: project .opencode/skills", true],
  ]);
  assert.deepEqual(imports.commands.map((c) => c.name).sort(), ["deployer:deploy", "git:commit", "review", "test"]);
  assert.deepEqual(imports.agentFolders.map((f) => f.origin), ["Claude Code: ~/.claude/agents", "Claude Code: project .claude/agents", "Claude Code plugin deployer"]);
  assert.deepEqual(imports.instructions.map((i) => [i.origin, i.kind]), [
    ["Claude Code: ~/.claude/CLAUDE.md", "always"],
    ["Claude Code: project CLAUDE.md", "always"],
    ["Claude Code: project .claude/rules/always.md", "rule"],
    ["Claude Code: project .claude/rules/api.md", "rule"],
    ["OpenCode: ~/.config/opencode/opencode.jsonc", "always"],
  ]);
  const byName = Object.fromEntries(imports.mcpServers.map((s) => [s.name, s]));
  assert.deepEqual(Object.keys(byName).sort(), ["deployer", "docs", "files", "local", "project-db", "project-local", "search", "tracker", "web"]);
  assert.deepEqual(byName.docs.connection, { url: "https://docs.example.com/mcp", transport: "http", headers: { Authorization: `Bearer ${SECRET}` } });
  assert.deepEqual(byName.local.connection, { command: "node", args: [`${home}/server.js`], env: { TOKEN: SECRET } });
  assert.deepEqual(byName.deployer.connection, { command: `${plugin}/bin/server`, args: [], env: undefined });
  assert.deepEqual(byName.tracker.connection, { url: "https://tracker.example.com/mcp", transport: "http", headers: { "X-Key": SECRET } });
  assert.deepEqual(byName.files.connection, { command: "bunx", args: ["files-server"], env: { KEY: SECRET } });
  assert.deepEqual(byName.web.connection, { url: "https://web.example.com/mcp", transport: "http", headers: { Authorization: `Bearer ${SECRET}` } });
  assert.equal(byName["project-db"].project, true, "a project server asks before it first starts");
  assert.equal(byName["project-local"].project, false, "your own server for this project (in ~/.claude.json) doesn't ask");
  assert.deepEqual(imports.workflows.map((w) => w.name).sort(), ["deployer:rollout", "nightly"]);
});

test("what isn't used is reported with the reason: OAuth, header programs, turned off, missing token, globs, hooks, same names", async () => {
  const { project, roots } = fixture();
  const imports = await collectImports(roots, { root: project, trusted: true }, ALL_ON);
  const reasons = Object.fromEntries(imports.skipped.map((s) => [s.item, s.reason]));
  assert.match(reasons["MCP server notion"], /OAuth/);
  assert.match(reasons["MCP server helper"], /running a program/);
  assert.match(reasons["MCP server off"], /turned off/);
  assert.match(reasons["MCP server needs-token"], /UNSET_TOKEN_VAR isn't set/);
  assert.match(reasons["MCP server signin"], /OAuth/);
  assert.match(reasons["MCP server search"], /same name as the one from Codex/);
  assert.match(reasons["instructions docs/*.md"], /glob/);
  assert.match(reasons["plugin deployer hooks"], /only in Claude Code/);
  assert.ok(!imports.skipped.some((s) => s.item.includes("off@market") || s.origin.includes("plugin off")), "a disabled plugin isn't read at all");
});

test("Restricted Mode imports only your own setup, never the project's", async () => {
  const { project, roots } = fixture();
  const imports = await collectImports(roots, { root: project, trusted: false }, ALL_ON);
  assert.ok(!imports.skillFolders.some((f) => f.project));
  assert.ok(!imports.agentFolders.some((f) => f.project));
  assert.ok(!imports.commands.some((c) => c.project));
  assert.ok(!imports.instructions.some((i) => i.project));
  assert.ok(!imports.mcpServers.some((s) => s.project));
  assert.doesNotMatch(JSON.stringify(imports), /project-db/);
});

test("each switch turns its kind off", async () => {
  const { project, roots } = fixture();
  const off: SourceSettings = {
    claudeCode: { skills: false, commands: false, agents: false, instructions: false, mcpServers: false, plugins: false },
    codex: { skills: false, mcpServers: false },
    opencode: { skills: false, mcpServers: false, instructions: false },
  };
  const imports = await collectImports(roots, { root: project, trusted: true }, off);
  assert.deepEqual([imports.skillFolders, imports.commands, imports.agentFolders, imports.instructions, imports.mcpServers], [[], [], [], [], []]);
  const pluginsOnly = await collectImports(roots, { root: project, trusted: true }, { ...off, claudeCode: { ...off.claudeCode, plugins: true } });
  assert.deepEqual(pluginsOnly.mcpServers.map((s) => s.name), ["deployer"]);
});

test("a config file that can't be parsed is reported, and the other agents' setup still loads", async () => {
  const { project, roots } = fixture();
  writeFileSync(join(roots.codexDir, "config.toml"), "[mcp_servers.broken\ncommand = ");
  const imports = await collectImports(roots, { root: project, trusted: true }, ALL_ON);
  const broken = imports.skipped.find((s) => s.item === "Codex setup");
  assert.match(broken?.reason ?? "", /isn't valid TOML/);
  assert.ok(imports.mcpServers.some((s) => s.name === "docs") && imports.mcpServers.some((s) => s.name === "files"));
});

test("the Sources report lists names and places, never a configured value", async () => {
  const { project, roots } = fixture();
  const imports = await collectImports(roots, { root: project, trusted: true }, ALL_ON);
  const report = sourcesReport(imports, { mcpServers: ["mine"] });
  assert.doesNotMatch(report, new RegExp(SECRET));
  assert.doesNotMatch(JSON.stringify(imports.skipped), new RegExp(SECRET));
  assert.match(report, /- mine \(kernl\.mcpServers\)/);
  assert.match(report, /- project-db \(Claude Code: project \.mcp\.json, local program, asks before it first starts\)/);
  assert.match(report, /- \/nightly \(Claude Code: ~\/\.claude\/workflows\)/);
  assert.match(report, /## Skipped/);
});

test("commands become valid skills: names fit Deep Agents' rule, same content reuses the folder, clashes are reported", async () => {
  assert.equal(skillName("deployer:Deploy Now"), "deployer-deploy-now");
  assert.equal(skillName("git:commit"), "git-commit");
  assert.equal(skillName("x".repeat(80)).length, 64);
  assert.equal(skillName("::"), "command");
  const { project, roots } = fixture();
  const base = mkdtempSync(join(tmpdir(), "kernl-command-skills-"));
  const first = await loadSources(roots, { root: project, trusted: true }, ALL_ON, base);
  assert.ok(first.commandsDir);
  assert.deepEqual(readdirSync(first.commandsDir!).sort(), ["deployer-deploy", "git-commit", "review", "test"]);
  const review = readFileSync(join(first.commandsDir!, "review", "SKILL.md"), "utf8");
  assert.match(review, /^---\nname: review\ndescription: "Claude Code command \/review: Review the diff"\n---/);
  assert.match(review, /Review \$ARGUMENTS carefully\./);
  const again = await loadSources(roots, { root: project, trusted: true }, ALL_ON, base);
  assert.equal(again.commandsDir, first.commandsDir, "the same commands reuse the same folder");
  const clash = await writeCommandSkills(
    [
      { name: "a:b", file: join(roots.claudeDir, "commands/review.md"), origin: "one", project: false },
      { name: "a-b", file: join(roots.claudeDir, "commands/review.md"), origin: "two", project: false },
    ],
    base,
  );
  assert.deepEqual(clash.skipped.map((s) => [s.item, s.origin]), [["command /a-b", "two"]]);
});

test("the composer's skill list includes imported skills and commands; ~/.kernl and the project's .kernl win on the same name", async () => {
  const { project, roots } = fixture();
  const userDir = mkdtempSync(join(tmpdir(), "kernl-user-"));
  put(join(userDir, "skills/release-notes/SKILL.md"), skill("release-notes", "KERNL-WINS"));
  const { imports, commandsDir } = await loadSources(roots, { root: project, trusted: true }, ALL_ON, mkdtempSync(join(tmpdir(), "kernl-command-skills-")));
  const skills = await listSkills({ userDir, imported: imports.skillFolders, commandsDir, projectRoot: project, trusted: true });
  const names = skills.map((s) => s.name);
  for (const n of ["release-notes", "team-style", "ship", "codex-skill", "db-migrate", "p-codex", "p-oc", "review", "git-commit", "deployer-deploy", "test"]) assert.ok(names.includes(n), `${n} in ${names}`);
  assert.equal(skills.find((s) => s.name === "release-notes")?.description, "KERNL-WINS");
});

test("imported CLAUDE.md files are in the prompt; a Claude Code rule with paths is listed, one without is inlined", async () => {
  const { project, roots } = fixture();
  const { imports } = await loadSources(roots, { root: project, trusted: true }, ALL_ON, mkdtempSync(join(tmpdir(), "kernl-command-skills-")));
  const userDir = mkdtempSync(join(tmpdir(), "kernl-user-"));
  const trusted = await assembleInstructions({ userDir, projectRoot: project, trusted: true, imported: imports.instructions });
  assert.deepEqual(trusted.problems, []);
  for (const marker of ["USER-CLAUDE-MD", "PROJECT-CLAUDE-MD", "ALWAYS-RULE", "OPENCODE-RULES"]) assert.match(trusted.prompt, new RegExp(marker));
  assert.doesNotMatch(trusted.prompt, /API-RULE/);
  assert.match(trusted.prompt, /- \/\.claude\/rules\/api\.md: applies to files matching src\/api\/\*\*/);
  const restricted = await assembleInstructions({ userDir, projectRoot: project, trusted: false, imported: imports.instructions });
  assert.match(restricted.prompt, /USER-CLAUDE-MD/);
  assert.doesNotMatch(restricted.prompt, /PROJECT-CLAUDE-MD|ALWAYS-RULE/);
});

test("every Sources switch is on by default, and a false setting turns just that one off", () => {
  const defaults = sourceSettings({ get: (_key, fallback) => fallback });
  assert.deepEqual(defaults, ALL_ON);
  const one = sourceSettings({ get: <T>(key: string, fallback: T) => (key === "sources.codex.mcpServers" ? (false as T) : fallback) });
  assert.deepEqual(one, { ...ALL_ON, codex: { skills: true, mcpServers: false } });
});
