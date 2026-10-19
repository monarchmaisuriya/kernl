// The connection monitor and the CLI agents' checks: only allowlisted commands run, with the agent's
// own binary and launch environment; not usable only when definitely so; a check already running is
// joined; and a failure a real run reported holds until something that could fix it happens.
import { strict as assert } from "node:assert";
import { test } from "node:test";
import type { CliAgentId, Launch } from "../../src/acp/agents";
import { type AgentCheckDeps, checkAgent } from "../../src/connections/agentChecks";
import { ConnectionMonitor } from "../../src/connections/monitor";
import { type CommandResult, type Exec, runStatusCommand, STATUS_COMMANDS, type StatusCommand } from "../../src/connections/statusCommands";
import type { ConnectionStatus } from "../../src/connections/types";

const launches: Record<CliAgentId, Launch> = {
  "claude-code": { command: "/usr/bin/npx", args: ["-y", "adapter"], env: { PATH: "/opt/node/bin:/usr/bin", CLAUDE_CODE_EXECUTABLE: "/opt/claude/bin/claude" } },
  codex: { command: "/usr/bin/npx", args: ["-y", "codex-acp"], env: { PATH: "/opt/node/bin:/usr/bin" } },
  opencode: { command: "/opt/oc/bin/opencode", args: ["acp"], env: { OPENCODE_CONFIG_CONTENT: "{}" } },
};

function deps(outputs: Partial<Record<StatusCommand, CommandResult>>, over: Partial<AgentCheckDeps> = {}) {
  const ran: { name: StatusCommand; path: string; env: Record<string, string | undefined> }[] = [];
  const d: AgentCheckDeps = {
    launch: async (id) => launches[id],
    hasStoredKey: async () => false,
    launchOverride: () => undefined,
    find: (c) => `/usr/local/bin/${c}`,
    run: async (name, target) => {
      ran.push({ name, path: target.path, env: target.env });
      return outputs[name] ?? { exitCode: null, output: "", timedOut: true };
    },
    now: () => 1000,
    ...over,
  };
  return { d, ran };
}
const ok = (output: string, exitCode = 0): CommandResult => ({ output, exitCode, timedOut: false });

test("the runner only runs commands from the allowlist, each one a status read", async () => {
  const calls: string[] = [];
  const exec: Exec = async (path, args) => (calls.push(`${path} ${args.join(" ")}`), ok(""));
  await runStatusCommand("claudeAuthJson", { path: "/bin/claude", env: {} }, exec);
  assert.deepEqual(calls, ["/bin/claude auth status --json"]);
  await assert.rejects(runStatusCommand("claude -p hi" as StatusCommand, { path: "/bin/claude", env: {} }, exec), /Expected one of/);
  for (const { args } of Object.values(STATUS_COMMANDS) as { args: readonly string[] }[]) {
    // `codex login status` and `claude auth status` end in "status": the read form of each subcommand.
    const flagAt = args.findIndex((a) => a.startsWith("-"));
    const words = flagAt < 0 ? args : args.slice(0, flagAt);
    assert.ok(["status", "list"].includes(words.at(-1)!), `${args.join(" ")} ends in a status or list read`);
    assert.ok(!args.some((a) => a === "-p" || a === "--print"), `${args.join(" ")} sends no prompt`);
  }
});

test("a check runs the binary and environment the agent is launched with", async () => {
  const { d, ran } = deps({ claudeAuthJson: ok(JSON.stringify({ loggedIn: true, authMethod: "api_key" })), claudeAuthText: ok("") });
  await checkAgent("claude-code", d);
  assert.deepEqual(ran.map((r) => [r.name, r.path]), [["claudeAuthJson", "/opt/claude/bin/claude"], ["claudeAuthText", "/opt/claude/bin/claude"]]);
  assert.equal(ran[0].env.PATH, "/opt/node/bin:/usr/bin", "the launch's PATH, so npx-started MCP servers resolve the same way");
  const oc = deps({ opencodeAuthList: ok("[]") });
  await checkAgent("opencode", oc.d);
  assert.equal(oc.ran[0].path, "/opt/oc/bin/opencode");
  assert.equal(oc.ran[0].env.OPENCODE_CONFIG_CONTENT, "{}");
});

test("not installed, or a launch that can't start, needs action; nothing is run for them", async () => {
  const missing = deps({}, { find: () => undefined });
  const codex = await checkAgent("codex", missing.d);
  assert.deepEqual([codex.state, codex.detail], ["needsAction", "Codex isn't installed (no 'codex' command found)"]);
  assert.deepEqual(missing.ran, []);
  const noNpx = await checkAgent("claude-code", deps({}, { launch: async () => ({ error: "npx was not found. Install Node.js (it provides npx), or set a command in kernl.agentCommands." }) }).d);
  assert.equal(noNpx.state, "needsAction");
  assert.match(noNpx.detail, /npx was not found/);
});

test("logged out or expired needs action with Log in; logged in, a stored key, or an override doesn't block", async () => {
  const expired = await checkAgent("claude-code", deps({ claudeAuthJson: ok(JSON.stringify({ loggedIn: false, authMethod: "none" }), 1), claudeAuthText: ok("Login: Expired — log in again\n", 1) }).d);
  assert.deepEqual([expired.state, expired.detail, expired.source, expired.fix?.action], ["needsAction", "Claude Code's login has expired: log in again", "claude auth status", "login"]);
  const codexOut = await checkAgent("codex", deps({ codexLoginStatus: ok("Not logged in\n", 1) }).d);
  assert.deepEqual([codexOut.state, codexOut.fix?.label], ["needsAction", "Log in"]);
  const codexIn = await checkAgent("codex", deps({ codexLoginStatus: ok("Logged in using ChatGPT\n") }).d);
  assert.deepEqual([codexIn.state, codexIn.fix], ["ready", undefined]);
  const keyed = deps({}, { hasStoredKey: async () => true });
  assert.deepEqual([(await checkAgent("codex", keyed.d)).state, keyed.ran.length], ["ready", 0], "a stored key replaces the login");
  const custom = await checkAgent("claude-code", deps({}, { launchOverride: () => ({ command: "/usr/bin/node" }) }).d);
  assert.equal(custom.state, "unknown", "the user's own launch command isn't checked, and doesn't block");
  const ownClaude = deps({ claudeAuthJson: ok(JSON.stringify({ loggedIn: true, authMethod: "claude.ai" })), claudeAuthText: ok("") }, { launchOverride: () => ({ command: "/home/me/bin/claude" }) });
  await checkAgent("claude-code", ownClaude.d);
  assert.equal(ownClaude.ran[0].path, "/home/me/bin/claude", "an override that is the CLI itself is checked");
});

test("a status command that times out or prints something new never blocks the agent", async () => {
  assert.equal((await checkAgent("claude-code", deps({}).d)).state, "unknown");
  assert.equal((await checkAgent("codex", deps({ codexLoginStatus: ok("Something new\n") }).d)).state, "unknown");
  assert.equal((await checkAgent("opencode", deps({ opencodeAuthList: ok("[]") }).d)).state, "ready", "OpenCode runs on its own models without a login");
});

const row = (id: string, state: ConnectionStatus["state"], source = "test"): ConnectionStatus => ({ id, kind: id.startsWith("mcp") ? "mcp" : "agent", owner: "x", label: id, state, detail: state, source, checkedAt: 1 });

test("a check already running for a group is joined, not started twice; meanwhile its rows are flagged checking and keep their last state", async () => {
  const m = new ConnectionMonitor(() => 5);
  m.report(row("agent:codex", "ready"));
  let release!: () => void;
  let runs = 0;
  const check = () => (runs++, new Promise<ConnectionStatus[]>((r) => (release = () => r([row("agent:codex", "needsAction")]))));
  const first = m.check("agent:codex", check);
  const second = m.check("agent:codex", check);
  assert.deepEqual([m.get("agent:codex")?.checking, m.get("agent:codex")?.state], [true, "ready"], "decisions keep the last known state");
  release();
  await Promise.all([first, second]);
  assert.equal(runs, 1);
  assert.deepEqual([!!m.get("agent:codex")?.checking, m.get("agent:codex")?.state], [false, "needsAction"]);
});

test("a check replaces its group's rows (a removed MCP server disappears); a check that throws leaves them unknown", async () => {
  const m = new ConnectionMonitor(() => 5);
  await m.check("mcp:claude-code", async () => [row("mcp:claude-code:a", "ready"), row("mcp:claude-code:b", "failed")]);
  await m.check("mcp:claude-code", async () => [row("mcp:claude-code:a", "ready")]);
  assert.deepEqual(m.list().map((s) => s.id), ["mcp:claude-code:a"]);
  await m.check("mcp:claude-code", async () => {
    throw new Error("boom");
  });
  assert.deepEqual([m.get("mcp:claude-code:a")?.state, m.get("mcp:claude-code:a")?.detail], ["unknown", "The check failed: boom"]);
});

test("a failure a real run reported holds over routine checks; a forced check or a successful run clears it", async () => {
  const m = new ConnectionMonitor(() => 5);
  let changes = 0;
  m.onDidChange(() => changes++);
  m.report(row("agent:claude-code", "needsAction", "last run"));
  await m.check("agent:claude-code", async () => [row("agent:claude-code", "ready")]);
  assert.equal(m.get("agent:claude-code")?.state, "needsAction", "the status command said ready, but the run failed");
  await m.check("agent:claude-code", async () => [row("agent:claude-code", "ready")], { force: true });
  assert.equal(m.get("agent:claude-code")?.state, "ready", "credentials changed: believe the check again");
  m.report(row("agent:claude-code", "needsAction", "last run"));
  m.clearRunFailure("agent:claude-code");
  assert.equal(m.get("agent:claude-code")?.state, "ready");
  assert.ok(changes >= 5);
});

test("when what a connection depends on changed, its last state no longer counts: unknown until the check answers", async () => {
  const m = new ConnectionMonitor(() => 5);
  m.report(row("agent:claude-code", "needsAction", "last run"));
  let release!: () => void;
  const done = m.check("agent:claude-code", () => new Promise<ConnectionStatus[]>((r) => (release = () => r([row("agent:claude-code", "ready")]))), { changed: true });
  assert.deepEqual([m.get("agent:claude-code")?.state, m.get("agent:claude-code")?.checking], ["unknown", true], "a stale 'needs you' would block a message that may now work");
  release();
  await done;
  assert.equal(m.get("agent:claude-code")?.state, "ready");
  await m.check("agent:claude-code", async () => [row("agent:claude-code", "needsAction")]);
  let releaseRoutine!: () => void;
  const routine = m.check("agent:claude-code", () => new Promise<ConnectionStatus[]>((r) => (releaseRoutine = () => r([row("agent:claude-code", "needsAction")]))));
  assert.equal(m.get("agent:claude-code")?.state, "needsAction", "a routine recheck keeps the last state");
  releaseRoutine();
  await routine;
});

test("a forced or changed request during a running check gets a fresh check after it; a changed one drops the running check's answer", async () => {
  const m = new ConnectionMonitor(() => 5);
  const releases: (() => void)[] = [];
  const answers: ConnectionStatus["state"][] = [];
  const check = (state: ConnectionStatus["state"]) => () => (answers.push(state), new Promise<ConnectionStatus[]>((r) => releases.push(() => r([row("agent:claude-code", state)]))));
  const first = m.check("agent:claude-code", check("needsAction"));
  const routine = m.check("agent:claude-code", check("failed"));
  const changed = m.check("agent:claude-code", check("unknown"), { changed: true });
  const alsoChanged = m.check("agent:claude-code", check("ready"), { changed: true });
  assert.equal(routine, first, "a routine request joins");
  assert.equal(alsoChanged, changed, "queued requests share one fresh run");
  assert.equal(m.get("agent:claude-code"), undefined);
  releases[0]();
  await first;
  assert.notEqual(m.get("agent:claude-code")?.state, "needsAction", "the check from before the change doesn't count");
  await new Promise((r) => setImmediate(r));
  assert.deepEqual(answers, ["needsAction", "ready"], "the fresh run uses the latest check");
  releases[1]();
  await changed;
  assert.equal(m.get("agent:claude-code")?.state, "ready");
});
