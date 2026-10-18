import { strict as assert } from "node:assert";
import { existsSync, mkdtempSync, readFileSync, realpathSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join, sep } from "node:path";
import { test } from "node:test";
import { git, isNotARepository } from "../../src/workspaces/git";
import { baseContent, changedFiles, rememberHarness, repoRoot, createWorkspace, discardWorkspace, listWorkspaces, mergeWorkspace, sanitizeName } from "../../src/workspaces/worktrees";

async function repo() {
  const root = realpathSync(mkdtempSync(join(tmpdir(), "kernl-repo-")));
  const storage = realpathSync(mkdtempSync(join(tmpdir(), "kernl-storage-")));
  await git(root, ["init", "-q", "-b", "main"]);
  await git(root, ["config", "user.email", "test@example.com"]);
  await git(root, ["config", "user.name", "Test"]);
  writeFileSync(join(root, "app.txt"), "one\n");
  await git(root, ["add", "-A"]);
  await git(root, ["commit", "-q", "-m", "init"]);
  return { root, storage };
}

test("workspace names are sanitized and must contain letters or digits", () => {
  assert.equal(sanitizeName("  Fix Login Bug! "), "fix-login-bug");
  assert.throws(() => sanitizeName("!!!"), /letters or digits/);
});

test("create puts a worktree on kernl/<name> outside the repo, remembers base and harness, and lists it", async () => {
  const { root, storage } = await repo();
  const ws = await createWorkspace(root, storage, "Feature A", "claude-code");
  assert.equal(ws.branch, "kernl/feature-a");
  assert.equal(ws.base, "main");
  assert.ok(ws.path.startsWith(storage + sep), ws.path);
  assert.ok(!ws.path.startsWith(root + sep));
  assert.equal(readFileSync(join(ws.path, "app.txt"), "utf8"), "one\n");
  const listed = await listWorkspaces(root, storage);
  assert.deepEqual(listed.map((w) => [w.name, w.harness, w.base]), [["feature-a", "claude-code", "main"]]);
  await assert.rejects(() => createWorkspace(root, storage, "feature a", "x"), /already exists/);
});

test("changes in a workspace never touch the main checkout until merged", async () => {
  const { root, storage } = await repo();
  const ws = await createWorkspace(root, storage, "a", "deepagents");
  writeFileSync(join(ws.path, "app.txt"), "two\n");
  writeFileSync(join(ws.path, "new.txt"), "new\n");
  assert.equal(readFileSync(join(root, "app.txt"), "utf8"), "one\n");
  assert.deepEqual(await changedFiles(ws), [{ status: "M", path: "app.txt" }, { status: "?", path: "new.txt" }]);
});

test("merge commits pending work and merges into the base branch", async () => {
  const { root, storage } = await repo();
  const ws = await createWorkspace(root, storage, "a", "deepagents");
  writeFileSync(join(ws.path, "app.txt"), "two\n");
  const out = await mergeWorkspace(root, ws);
  assert.deepEqual(out, { merged: true, committedPending: true });
  assert.equal(readFileSync(join(root, "app.txt"), "utf8"), "two\n");
});

test("merge refuses when the main checkout is dirty or on another branch", async () => {
  const { root, storage } = await repo();
  const ws = await createWorkspace(root, storage, "a", "deepagents");
  writeFileSync(join(root, "app.txt"), "local edit\n");
  const dirty = await mergeWorkspace(root, ws);
  assert.equal(dirty.merged, false);
  assert.match((dirty as any).reason, /uncommitted changes/);
  await git(root, ["checkout", "-q", "--", "app.txt"]);
  await git(root, ["checkout", "-q", "-b", "other"]);
  assert.match((await mergeWorkspace(root, ws) as any).reason, /on 'other'/);
});

test("a conflicting merge is aborted and leaves the main checkout unchanged", async () => {
  const { root, storage } = await repo();
  const ws = await createWorkspace(root, storage, "a", "deepagents");
  writeFileSync(join(ws.path, "app.txt"), "from workspace\n");
  writeFileSync(join(root, "app.txt"), "from main\n");
  await git(root, ["commit", "-q", "-am", "main change"]);
  const out = await mergeWorkspace(root, ws);
  assert.equal(out.merged, false);
  assert.match((out as any).reason, /Merge stopped and was undone/);
  assert.equal(readFileSync(join(root, "app.txt"), "utf8"), "from main\n");
  assert.equal((await git(root, ["status", "--porcelain"])).trim(), "");
});

test("discard removes the worktree, branch, and settings", async () => {
  const { root, storage } = await repo();
  const ws = await createWorkspace(root, storage, "a", "opencode");
  await discardWorkspace(root, ws);
  assert.equal(existsSync(ws.path), false);
  assert.equal((await git(root, ["branch", "--list", "kernl/a"])).trim(), "");
  assert.deepEqual(await listWorkspaces(root, storage), []);
});

test("review compares against where the workspace branched, even after the base branch moved", async () => {
  const { root, storage } = await repo();
  writeFileSync(join(root, "b.txt"), "line1\nline2\n");
  await git(root, ["add", "-A"]);
  await git(root, ["commit", "-q", "-m", "add b"]);
  const ws = await createWorkspace(root, storage, "a", "deepagents");
  writeFileSync(join(ws.path, "b.txt"), "line1\nline2\nworkspace line\n");
  writeFileSync(join(root, "b.txt"), "MAIN CHANGED line1\nline2\n");
  writeFileSync(join(root, "main-only.txt"), "x\n");
  await git(root, ["add", "-A"]);
  await git(root, ["commit", "-q", "-m", "main moved"]);
  assert.equal(await baseContent(ws, "b.txt"), "line1\nline2\n");
  assert.deepEqual(await changedFiles(ws), [{ status: "M", path: "b.txt" }], "main-only changes must not appear as workspace changes");
});

test("only 'not a git repository' counts as no repository; other git failures are real errors", async () => {
  const plain = realpathSync(mkdtempSync(join(tmpdir(), "kernl-plain-")));
  const notRepo = await repoRoot(plain).catch((e) => e);
  assert.equal(isNotARepository(notRepo), true, String(notRepo));
  const missingDir = await repoRoot(join(plain, "does-not-exist")).catch((e) => e);
  assert.equal(isNotARepository(missingDir), false, String(missingDir));
});

test("a workspace's agent choice is remembered where listing reads it", async () => {
  const { root, storage } = await repo();
  const ws = await createWorkspace(root, storage, "a", "deepagents");
  await rememberHarness(root, ws, "opencode");
  assert.deepEqual((await listWorkspaces(root, storage)).map((w) => w.harness), ["opencode"]);
});
