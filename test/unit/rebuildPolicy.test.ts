import { strict as assert } from "node:assert";
import { test } from "node:test";
import { type InputChange, needsRebuild } from "../../src/agent/rebuildPolicy";

const settings = (keys: string[], mainHarness = "deepagents"): InputChange => ({
  kind: "settings",
  affects: (section) => keys.some((k) => k === section || k.startsWith(`${section}.`) || section === "kernl"),
  mainHarness,
});
const main = (harness: string) => ({ harness, isMain: true });
const worktree = (harness: string) => ({ harness, isMain: false });

test("switching Main's agent rebuilds only Main, never the worktree workspaces", () => {
  const change = settings(["kernl.harness"], "opencode");
  assert.equal(needsRebuild(main("deepagents"), change), true);
  assert.equal(needsRebuild(worktree("deepagents"), change), false);
  assert.equal(needsRebuild(worktree("claude-code"), change), false);
});

test("Main's harness setting that already matches (set from the panel) is not a rebuild", () => {
  assert.equal(needsRebuild(main("opencode"), settings(["kernl.harness"], "opencode")), false);
});

test("model settings and API keys affect Deep Agents workspaces only", () => {
  for (const key of ["kernl.provider", "kernl.model", "kernl.baseUrl", "kernl.customProviders", "kernl.modelOptions", "kernl.mcpServers"]) {
    assert.equal(needsRebuild(worktree("deepagents"), settings([key])), true, key);
    assert.equal(needsRebuild(worktree("claude-code"), settings([key])), false, key);
  }
  assert.equal(needsRebuild(worktree("deepagents"), { kind: "keys", harnesses: ["deepagents"] }), true);
  assert.equal(needsRebuild(worktree("opencode"), { kind: "keys", harnesses: ["deepagents"] }), false);
});

test("an agent's stored credential rebuilds only workspaces running that agent", () => {
  const change: InputChange = { kind: "keys", harnesses: ["claude-code"] };
  assert.equal(needsRebuild(worktree("claude-code"), change), true);
  assert.equal(needsRebuild(main("claude-code"), change), true);
  for (const h of ["deepagents", "opencode", "codex"]) assert.equal(needsRebuild(worktree(h), change), false, h);
});

test("agent launch overrides affect CLI workspaces only; the allow-list affects nobody", () => {
  assert.equal(needsRebuild(worktree("claude-code"), settings(["kernl.agentCommands"])), true);
  assert.equal(needsRebuild(worktree("deepagents"), settings(["kernl.agentCommands"])), false);
  for (const ws of [main("deepagents"), worktree("codex")]) assert.equal(needsRebuild(ws, settings(["kernl.commandAllowList"])), false);
});

test("becoming trusted rebuilds everyone (Restricted Mode agents were read-only)", () => {
  assert.equal(needsRebuild(worktree("opencode"), { kind: "trust" }), true);
  assert.equal(needsRebuild(main("deepagents"), { kind: "trust" }), true);
});

test("an instruction or agent file change rebuilds Deep Agents workspaces only", () => {
  assert.equal(needsRebuild(worktree("deepagents"), { kind: "customisation" }), true);
  assert.equal(needsRebuild(main("claude-code"), { kind: "customisation" }), false);
});

test("the Terminal and Browser settings for CLI agents rebuild CLI workspaces; Sources and MCP settings rebuild Deep Agents ones", () => {
  for (const key of ["kernl.terminal.cliAgents", "kernl.browser.cliAgents"]) {
    assert.equal(needsRebuild(worktree("claude-code"), settings([key])), true, key);
    assert.equal(needsRebuild(worktree("deepagents"), settings([key])), false, key);
  }
  for (const key of ["kernl.sources.claudeCode.skills", "kernl.mcp.toolTimeoutSeconds"]) {
    assert.equal(needsRebuild(worktree("deepagents"), settings([key])), true, key);
    assert.equal(needsRebuild(worktree("codex"), settings([key])), false, key);
  }
});
