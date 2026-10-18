// Approval rules: deny beats ask beats allow, no match asks, an allow never matches a command with
// shell operators, path globs are workspace-relative, and malformed rules are skipped and reported.
import { strict as assert } from "node:assert";
import { test } from "node:test";
import { ApprovalGate, type GateRequest } from "../../src/gate/approvalGate";
import { decide, parseRules, type RuleLists } from "../../src/gate/rules";

const run = (command: string): GateRequest => ({ kind: "execute", command });
const edit = (path: string): GateRequest => ({ kind: "edit", path, before: "", after: "x" });
const verdict = (lists: RuleLists, request: GateRequest, legacy: string[] = []) => decide(request, parseRules(lists, legacy).rules).verdict;

test("an allow rule runs matching commands without a card, but never a command with shell operators", () => {
  const lists = { allow: ["run(npm test *)", "run(git status)"] };
  assert.equal(verdict(lists, run("npm test -- --watch")), "allow");
  assert.equal(verdict(lists, run("  git status ")), "allow");
  assert.equal(verdict(lists, run("git status --short")), "ask", "no wildcard means the whole command");
  assert.equal(verdict(lists, run("npm test")), "allow", "a trailing * also covers no arguments");
  assert.equal(verdict(lists, run("npm testing")), "ask", "but only as a whole word");
  for (const cmd of ["npm test; rm x", "npm test && rm x", "npm test || x", "npm test | sh", "npm test > f", "npm test < f", "npm test `x`", "npm test $(x)", "npm test\nrm x"]) {
    assert.equal(verdict(lists, run(cmd)), "ask", cmd);
  }
});

test("deny beats ask beats allow, whatever the order they were written in", () => {
  const lists = { allow: ["run(*)", "edit(**)"], ask: ["edit(src/**)"], deny: ["run(rm *)"] };
  assert.equal(verdict(lists, run("rm -rf build")), "deny");
  assert.equal(verdict(lists, run("ls")), "allow");
  assert.equal(verdict(lists, edit("/src/app.ts")), "ask");
  assert.equal(verdict(lists, edit("/README.md")), "allow");
  assert.equal(verdict({}, run("ls")), "ask", "no rules: everything asks, as before");
});

test("path rules are workspace-relative globs: ** spans folders, * stays within one", () => {
  const lists = { allow: ["edit(src/*.ts)", "delete(tmp/**)", "read(.env.example)"] };
  assert.equal(verdict(lists, edit("/src/a.ts")), "allow");
  assert.equal(verdict(lists, edit("/src/deep/a.ts")), "ask");
  assert.equal(verdict(lists, { kind: "write", path: "/src/new.ts", before: null, after: "" }), "allow", "edit rules cover new files");
  assert.equal(verdict(lists, { kind: "delete", path: "/tmp/a/b/c.log" }), "allow");
  assert.equal(verdict(lists, { kind: "read", path: "/.env.example" }), "allow");
  assert.equal(verdict(lists, { kind: "read", path: "/.env" }), "ask");
  assert.equal(verdict({ allow: ["edit(./docs/**)"] }, edit("/docs/x/y.md")), "allow", "a leading ./ is accepted");
});

test("tool rules match tool names; CLI agent requests are never decided by rules", () => {
  const lists = { allow: ["tool(browser_*)"], deny: ["tool(mcp__github__delete_*)"] };
  assert.equal(verdict(lists, { kind: "tool", tool: "browser_navigate", args: {} }), "allow");
  assert.equal(verdict(lists, { kind: "tool", tool: "mcp__github__delete_repo", args: {} }), "deny");
  assert.equal(verdict({ allow: ["run(*)"] }, { kind: "agent", agent: "Claude Code", title: "Run ls", toolKind: "execute", detail: "ls" }), "ask");
});

test("the old exact-match command list still works, exactly as before", () => {
  assert.equal(verdict({}, run("npm test"), ["npm test"]), "allow");
  assert.equal(verdict({}, run("npm test --watch"), ["npm test"]), "ask");
  assert.equal(verdict({}, run("npm test*"), ["npm test*"]), "allow", "a * in the old list is literal");
  assert.equal(verdict({}, run("npm test-anything"), ["npm test*"]), "ask");
  assert.equal(verdict({ deny: ["run(npm *)"] }, run("npm test"), ["npm test"]), "deny");
});

test("malformed rules are skipped and named; skipping never lets anything run", () => {
  const { rules, problems } = parseRules({ allow: ["npm test", "run()", 42, "shell(ls)"], deny: "run(rm *)" as any });
  assert.equal(rules.length, 0);
  assert.equal(problems.length, 5);
  assert.match(problems[0], /yourstack.approvals.deny to be a list/);
  assert.match(problems[1], /got "npm test"/);
});

test("the gate refuses a denied action without a card and reports the rule; an allowed one runs without a card", async () => {
  const asked: GateRequest[] = [];
  const denied: string[] = [];
  const rules = parseRules({ allow: ["run(npm test *)"], deny: ["run(rm *)"] }).rules;
  const gate = new ApprovalGate({ ask: async (_id, r) => (asked.push(r), true) }, { rules: () => rules, denied: (_r, rule) => denied.push(rule) });
  assert.equal(await gate.request(run("rm -rf /")), false);
  assert.equal(await gate.request(run("npm test")), true);
  assert.equal(await gate.request(run("ls")), true);
  assert.deepEqual(asked.map((r) => (r as any).command), ["ls"]);
  assert.deepEqual(denied, ["run(rm *)"]);
});
