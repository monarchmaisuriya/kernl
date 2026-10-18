// Background jobs: starting asks like a command; a job runs, keeps its output, can be checked and
// stopped (with what it started); a rejected start runs nothing; dispose stops everything.
import { strict as assert } from "node:assert";
import { mkdtempSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { test } from "node:test";
import { AIMessage } from "@langchain/core/messages";
import { BackgroundJobs, type JobDisplay, jobTools } from "../../src/agent/backgroundJobs";
import { parseRules } from "../../src/gate/rules";
import { ApprovalGate, type GateRequest } from "../../src/gate/approvalGate";
import { runScript, toolCall, workspace } from "../support/harness";

const tick = (ms: number) => new Promise((r) => setTimeout(r, ms));

function jobs() {
  const shown: string[] = [];
  const display = (): JobDisplay => ({ write: (t) => shown.push(t), exited: (c) => shown.push(`[exit ${c}]`), dispose() {} });
  return { jobs: new BackgroundJobs(mkdtempSync(join(tmpdir(), "kernl-jobs-")), display), shown };
}

test("a job runs in the background, keeps its output for checking, and shows it in its terminal", async () => {
  const { jobs: j, shown } = jobs();
  const job = j.start("echo first; sleep 0.2; echo second", "two lines");
  assert.equal(job.status, "running");
  await tick(600);
  const checked = j.check(job.id)!;
  assert.equal(checked.status, "exited");
  assert.equal(checked.exitCode, 0);
  assert.equal(checked.output, "first\nsecond\n");
  assert.ok(shown.join("").includes("second") && shown.includes("[exit 0]"));
  assert.equal(j.check(job.id, 7)!.output, "second\n", "tail returns the end");
});

test("stop ends the job and the processes it started", async () => {
  const { jobs: j } = jobs();
  const job = j.start("sleep 30 & sleep 30; wait");
  await tick(200);
  assert.equal(j.running, 1);
  assert.equal(j.stop(job.id), true);
  await tick(400);
  assert.equal(j.check(job.id)!.status, "stopped");
  assert.equal(j.running, 0);
  assert.equal(j.stop(job.id), false, "stopping twice is a no-op");
  j.dispose();
});

test("starting a job asks like a command (rules apply); a rejected start runs nothing", async () => {
  const w = workspace(false);
  const { jobs: j } = jobs();
  const results = await runScript(w.backend, [toolCall("start_background_job", { command: "npm run dev", name: "dev server" }), toolCall("list_background_jobs", {}), new AIMessage("ok")], jobTools(j, w.gate));
  assert.deepEqual(w.asked.map((r) => [r.kind, (r as any).command]), [["execute", "npm run dev"]]);
  assert.equal(results[0], "rejected by user");
  assert.equal(results[1], "No background jobs.");
  const asked: GateRequest[] = [];
  const allowing = new ApprovalGate({ ask: async (_id, r) => (asked.push(r), false) }, { rules: () => parseRules({ allow: ["run(echo *)"] }).rules });
  const started = await runScript(w.backend, [toolCall("start_background_job", { command: "echo hi" }), new AIMessage("ok")], jobTools(j, allowing));
  assert.match(started[0], /^job-1 "echo hi": running/);
  assert.deepEqual(asked, [], "an allow rule lets it start without a card");
  j.dispose();
});
