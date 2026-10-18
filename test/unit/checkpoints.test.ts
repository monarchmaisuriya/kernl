// Snapshots before each message, and restoring them: changed files go back, files created since
// are deleted, deleted ones come back; .gitignore'd and dependency folders are left alone; the
// user's own git repository is never touched.
import { strict as assert } from "node:assert";
import { execFileSync } from "node:child_process";
import { existsSync, mkdirSync, mkdtempSync, readFileSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { test } from "node:test";
import { Checkpoints } from "../../src/checkpoints";

function repo() {
  const root = mkdtempSync(join(tmpdir(), "yourstack-ckpt-"));
  const git = (...a: string[]) => execFileSync("git", a, { cwd: root, encoding: "utf8" });
  git("init", "-q", "-b", "main");
  git("config", "user.email", "t@example.com");
  git("config", "user.name", "T");
  writeFileSync(join(root, ".gitignore"), "secret.log\n");
  writeFileSync(join(root, "a.txt"), "original a\n");
  writeFileSync(join(root, "b.txt"), "original b\n");
  git("add", "-A");
  git("commit", "-q", "-m", "init");
  return { root, git, store: new Checkpoints(mkdtempSync(join(tmpdir(), "yourstack-ckpt-store-"))) };
}

test("restore puts changed files back, deletes files created since, and re-creates deleted ones", async () => {
  const { root, store } = repo();
  const before = await store.snapshot(root, "before message");
  writeFileSync(join(root, "a.txt"), "agent changed a\n");
  rmSync(join(root, "b.txt"));
  mkdirSync(join(root, "new"), { recursive: true });
  writeFileSync(join(root, "new", "c.txt"), "created by the agent\n");
  const changes = await store.changes(root, before);
  assert.deepEqual(changes.sort((x, y) => x.path.localeCompare(y.path)), [
    { status: "M", path: "a.txt" },
    { status: "A", path: "b.txt" },
    { status: "D", path: "new/c.txt" },
  ]);
  await store.restore(root, before);
  assert.equal(readFileSync(join(root, "a.txt"), "utf8"), "original a\n");
  assert.equal(readFileSync(join(root, "b.txt"), "utf8"), "original b\n");
  assert.equal(existsSync(join(root, "new", "c.txt")), false);
  assert.deepEqual(await store.changes(root, before), []);
});

test("ignored files and dependency folders are neither copied nor touched by a restore", async () => {
  const { root, store } = repo();
  const before = await store.snapshot(root, "before");
  writeFileSync(join(root, "secret.log"), "ignored\n");
  mkdirSync(join(root, "node_modules", "x"), { recursive: true });
  writeFileSync(join(root, "node_modules", "x", "i.js"), "dep\n");
  assert.deepEqual(await store.changes(root, before), []);
  await store.restore(root, before);
  assert.ok(existsSync(join(root, "secret.log")) && existsSync(join(root, "node_modules", "x", "i.js")));
});

test("the user's own repository is untouched: no new refs, no staged changes, same HEAD", async () => {
  const { root, git, store } = repo();
  const head = git("rev-parse", "HEAD");
  const refs = git("for-each-ref");
  writeFileSync(join(root, "a.txt"), "edited\n");
  const status = git("status", "--porcelain");
  const cp = await store.snapshot(root, "x");
  await store.restore(root, cp);
  assert.equal(git("rev-parse", "HEAD"), head);
  assert.equal(git("for-each-ref"), refs);
  assert.equal(git("status", "--porcelain"), status, "the user's index and working state are as they were");
});

test("snapshots on one workspace run one at a time (no git lock clashes)", async () => {
  const { root, store } = repo();
  const ids = await Promise.all([store.snapshot(root, "1"), store.snapshot(root, "2"), store.changes(root, "HEAD").catch(() => []), store.snapshot(root, "3")]);
  assert.equal(new Set([ids[0], ids[1], ids[3]].map((x) => typeof x)).size, 1);
});

test("a folder holding git repositories (like ~/Develop): files inside each nested repository are snapshotted, listed, and restored", async () => {
  const root = mkdtempSync(join(tmpdir(), "yourstack-ckpt-folder-"));
  writeFileSync(join(root, "notes.txt"), "top\n");
  const nestedRepo = (name: string) => {
    const dir = join(root, name);
    mkdirSync(dir);
    const git = (...a: string[]) => execFileSync("git", a, { cwd: dir, encoding: "utf8" });
    git("init", "-q", "-b", "main");
    writeFileSync(join(dir, ".gitignore"), "build/\n");
    writeFileSync(join(dir, "app.ts"), `${name} original\n`);
    writeFileSync(join(dir, "old.ts"), "to delete\n");
    git("add", "-A");
    git("-c", "user.email=t@t", "-c", "user.name=t", "commit", "-q", "-m", "init");
    return { dir, git };
  };
  const api = nestedRepo("api");
  nestedRepo("web");
  const store = new Checkpoints(mkdtempSync(join(tmpdir(), "yourstack-ckpt-store-")));
  const before = await store.snapshot(root, "before message");
  writeFileSync(join(api.dir, "app.ts"), "agent changed\n");
  writeFileSync(join(api.dir, "new.ts"), "agent created\n");
  rmSync(join(api.dir, "old.ts"));
  mkdirSync(join(api.dir, "build"));
  writeFileSync(join(api.dir, "build", "out.js"), "ignored\n");
  const changes = await store.changes(root, before);
  assert.deepEqual(changes.map((c) => `${c.status} ${c.path}`).sort(), ["A api/old.ts", "D api/new.ts", "M api/app.ts"]);
  await store.restore(root, before);
  assert.equal(readFileSync(join(api.dir, "app.ts"), "utf8"), "api original\n");
  assert.equal(readFileSync(join(api.dir, "old.ts"), "utf8"), "to delete\n");
  assert.equal(existsSync(join(api.dir, "new.ts")), false);
  assert.equal(readFileSync(join(api.dir, "build", "out.js"), "utf8"), "ignored\n", "ignored files are left alone");
  assert.equal(api.git("status", "--porcelain").trim(), "", "the nested repository's own index and working tree match its HEAD again");
  assert.equal(api.git("rev-list", "--count", "HEAD").trim(), "1");
});
