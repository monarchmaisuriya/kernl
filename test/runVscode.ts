// Launches VS Code on a temp workspace with an isolated profile and runs the integration suite.
// VSCODE_PATH overrides the VS Code executable (default: the installed macOS app). YOURSTACK_SUITE
// picks the suite (default suite.cjs; the live suite is liveSuite.cjs).
import { execFileSync } from "node:child_process";
import { mkdtempSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join, resolve } from "node:path";
import { runTests } from "@vscode/test-electron";

const profile = mkdtempSync(join(tmpdir(), "yourstack-vscode-profile-"));
const extensionsDir = mkdtempSync(join(tmpdir(), "yourstack-vscode-ext-"));
const workspace = mkdtempSync(join(tmpdir(), "yourstack-vscode-ws-"));
// The user's ~/.yourstack, redirected so tests never touch the real one (inherited by VS Code).
process.env.YOURSTACK_USER_DIR = mkdtempSync(join(tmpdir(), "yourstack-vscode-userdir-"));
// Claude Code's config folder too (agents/ and skills/ are read from it).
process.env.CLAUDE_CONFIG_DIR = mkdtempSync(join(tmpdir(), "yourstack-vscode-claudedir-"));

// The workspace is a git repo with one commit, so the panel tests can create worktree workspaces from Main.
const git = (...args: string[]) => execFileSync("git", args, { cwd: workspace, stdio: "ignore" });
git("init", "-q", "-b", "main");
git("config", "user.email", "test@example.com");
git("config", "user.name", "YourStack Test");
writeFileSync(join(workspace, "README.md"), "test workspace\n");
git("add", "-A");
git("commit", "-q", "-m", "init");

// YOURSTACK_WORKSPACE=multi: a multi-root window with two git repos (alpha and beta) instead of one folder.
function multiRootWorkspace(): string {
  const parent = mkdtempSync(join(tmpdir(), "yourstack-vscode-multi-"));
  for (const name of ["alpha", "beta"]) {
    const dir = join(parent, name);
    execFileSync("git", ["init", "-q", "-b", "main", dir]);
    const g = (...args: string[]) => execFileSync("git", args, { cwd: dir, stdio: "ignore" });
    g("config", "user.email", "test@example.com");
    g("config", "user.name", "YourStack Test");
    writeFileSync(join(dir, "README.md"), `${name}\n`);
    g("add", "-A");
    g("commit", "-q", "-m", "init");
  }
  const file = join(parent, "Test.code-workspace");
  writeFileSync(file, JSON.stringify({ folders: [{ path: "alpha" }, { path: "beta" }] }));
  return file;
}

async function launch() {
  const opened = process.env.YOURSTACK_WORKSPACE === "multi" ? multiRootWorkspace() : workspace;
  await runTests({
    vscodeExecutablePath: process.env.VSCODE_PATH ?? "/Applications/Visual Studio Code.app/Contents/MacOS/Code",
    extensionDevelopmentPath: resolve(__dirname, "../.."),
    extensionTestsPath: resolve(__dirname, process.env.YOURSTACK_SUITE ?? "suite.cjs"),
    // Empty extensions dir keeps built-ins (js-debug provides editor-browser) but no user extensions.
    launchArgs: [opened, "--extensions-dir", extensionsDir, "--user-data-dir", profile, "--disable-workspace-trust"],
  });
}

launch().catch((e) => {
  console.error(`VS Code integration run failed: ${e?.message ?? e}`);
  process.exit(1);
});
