import { strict as assert } from "node:assert";
import { test } from "node:test";
import { type InputChange, needsRebuild } from "../../src/agent/rebuildPolicy";

const settings = (keys: string[], mainHarness = "deepagents"): InputChange => ({
  kind: "settings",
  affects: (section) => keys.some((k) => k === section || k.startsWith(`${section}.`) || section === "yourstack"),
  mainHarness,
});
const main = (harness: string) => ({ harness, isMain: true });
const worktree = (harness: string) => ({ harness, isMain: false });

test("switching Main's agent rebuilds only Main, never the worktree workspaces", () => {
  const change = settings(["yourstack.harness"], "opencode");
  assert.equal(needsRebuild(main("deepagents"), change), true);
  assert.equal(needsRebuild(worktree("deepagents"), change), false);
  assert.equal(needsRebuild(worktree("claude-code"), change), false);
});

test("Main's harness setting that already matches (set from the panel) is not a rebuild", () => {
  assert.equal(needsRebuild(main("opencode"), settings(["yourstack.harness"], "opencode")), false);
});

test("model settings and API keys affect Deep Agents workspaces only", () => {
  for (const key of ["yourstack.provider", "yourstack.model", "yourstack.baseUrl", "yourstack.customProviders", "yourstack.modelOptions", "yourstack.mcpServers"]) {
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
  assert.equal(needsRebuild(worktree("claude-code"), settings(["yourstack.agentCommands"])), true);
  assert.equal(needsRebuild(worktree("deepagents"), settings(["yourstack.agentCommands"])), false);
  for (const ws of [main("deepagents"), worktree("codex")]) assert.equal(needsRebuild(ws, settings(["yourstack.commandAllowList"])), false);
});

test("becoming trusted rebuilds everyone (Restricted Mode agents were read-only)", () => {
  assert.equal(needsRebuild(worktree("opencode"), { kind: "trust" }), true);
  assert.equal(needsRebuild(main("deepagents"), { kind: "trust" }), true);
});

test("an instruction or agent file change rebuilds Deep Agents workspaces only", () => {
  assert.equal(needsRebuild(worktree("deepagents"), { kind: "customisation" }), true);
  assert.equal(needsRebuild(main("claude-code"), { kind: "customisation" }), false);
});
