// Readiness of the CLI agents: not ready only when definitely so (not installed, or the CLI says
// it's logged out); a stored key or a launch override makes it ready; unreadable checks don't block.
import { strict as assert } from "node:assert";
import { test } from "node:test";
import { cliReadiness, type ReadinessDeps } from "../../src/harnesses";

function deps(over: Partial<ReadinessDeps> & { outputs?: Record<string, string | undefined> } = {}): ReadinessDeps {
  return {
    find: (c) => `/usr/local/bin/${c}`,
    run: async (c, args) => over.outputs?.[`${c} ${args.join(" ")}`],
    hasStoredKey: async () => false,
    hasLaunchOverride: () => false,
    ...over,
  };
}

test("an agent that isn't installed, or lacks npx for its connector, isn't ready and says how to fix it", async () => {
  const missing = await cliReadiness("codex", deps({ find: () => undefined }));
  assert.deepEqual(missing, { ready: false, problem: "Codex isn't installed (no 'codex' command found)." });
  const noNpx = await cliReadiness("claude-code", deps({ find: (c) => (c === "npx" ? undefined : `/bin/${c}`) }));
  assert.match(noNpx.problem!, /needs Node\.js \(npx\)/);
  assert.equal((await cliReadiness("opencode", deps({ find: (c) => (c === "npx" ? undefined : `/bin/${c}`) }))).ready, true, "OpenCode needs no npx");
});

test("logged-out Claude Code and Codex aren't ready; logged in, a stored key, or an override is", async () => {
  const claudeOut = deps({ outputs: { "claude auth status": JSON.stringify({ loggedIn: false, authMethod: "none" }) } });
  assert.match((await cliReadiness("claude-code", claudeOut)).problem!, /isn't logged in: run `claude`/);
  assert.equal((await cliReadiness("claude-code", deps({ outputs: { "claude auth status": JSON.stringify({ loggedIn: true }) } }))).ready, true);
  const codexOut = deps({ outputs: { "codex login status": "Not logged in\n" } });
  assert.match((await cliReadiness("codex", codexOut)).problem!, /run `codex login`/);
  assert.equal((await cliReadiness("codex", deps({ outputs: { "codex login status": "Logged in using ChatGPT\n" } }))).ready, true);
  // `codex login status` writes to stderr; the real runner returns both streams.
  assert.equal((await cliReadiness("codex", { ...codexOut, hasStoredKey: async () => true })).ready, true, "a stored key replaces the login");
  assert.equal((await cliReadiness("claude-code", { ...claudeOut, hasLaunchOverride: () => true })).ready, true, "a custom launch is the user's own setup");
});

test("a status check that fails or can't be read never blocks the agent", async () => {
  assert.equal((await cliReadiness("claude-code", deps({ outputs: { "claude auth status": undefined } }))).ready, true);
  assert.equal((await cliReadiness("claude-code", deps({ outputs: { "claude auth status": "Unknown command: auth" } }))).ready, true);
  assert.equal((await cliReadiness("opencode", deps())).ready, true, "OpenCode runs on free models without a login");
});
