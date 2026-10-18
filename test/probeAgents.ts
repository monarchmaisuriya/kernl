// Opt-in live probe (npm run probe:agents): for each installed CLI agent, ask it to create
// hello.txt in a temp folder, reject the permission request, and check that no file was written.
// Proves on this machine that the agent's forced ask mode really routes actions to the gate.
// Costs: one tiny prompt per agent on your account (OpenCode can use its free model).
import { existsSync, mkdtempSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { AcpRunner } from "../src/acp/acpRunner";
import { CLI_AGENTS, type CliAgentId, resolveLaunch } from "../src/acp/agents";
import { ApprovalGate } from "../src/gate/approvalGate";

async function probe(id: CliAgentId): Promise<boolean> {
  const spec = CLI_AGENTS[id];
  const launch = resolveLaunch(id, undefined);
  if ("error" in launch) {
    console.log(`SKIP  ${spec.label}: ${launch.error}`);
    return true;
  }
  const cwd = mkdtempSync(join(tmpdir(), `kernl-probe-${id}-`));
  let asked = 0;
  let outcome = "";
  const gate = new ApprovalGate({ ask: async () => (asked++, false) }, { rules: () => [] });
  const runner = new AcpRunner({
    agentLabel: spec.label,
    launch,
    mode: () => spec.modes.ask.session,
    cwd,
    gate,
    events: { text() {}, toolCall() {}, toolResult() {}, usage() {}, finished: (r, m) => (outcome = m ? `${r}: ${m}` : r) },
  });
  await runner.send("Create a file named hello.txt in the current directory containing the word hi. Use your file write tool. Do nothing else.");
  runner.dispose();
  const wrote = existsSync(join(cwd, "hello.txt"));
  const ok = outcome === "done" && asked > 0 && !wrote;
  console.log(`${ok ? "PASS" : "FAIL"}  ${spec.label}: run ${outcome}; permission requests ${asked}; file written after reject: ${wrote}`);
  return ok;
}

(async () => {
  // Codex only when asked for by name: its adapter downloads a ~330 MB binary on first run.
  const which = (process.argv[2]?.split(",") ?? ["claude-code", "opencode"]) as CliAgentId[];
  let failed = 0;
  for (const id of which) if (!(await probe(id))) failed++;
  process.exit(failed ? 1 : 0);
})();
