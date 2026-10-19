// Launches VS Code on a temp workspace with an isolated profile and runs the integration suite.
// VSCODE_PATH overrides the VS Code executable (default: the installed macOS app). KERNL_SUITE
// picks the suite (default suite.cjs; the live suite is liveSuite.cjs).
import { execFileSync } from "node:child_process";
import { mkdtempSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join, resolve } from "node:path";
import { runTests } from "@vscode/test-electron";

const profile = mkdtempSync(join(tmpdir(), "kernl-vscode-profile-"));
const extensionsDir = mkdtempSync(join(tmpdir(), "kernl-vscode-ext-"));
const workspace = mkdtempSync(join(tmpdir(), "kernl-vscode-ws-"));
// The user's ~/.kernl, redirected so tests never touch the real one (inherited by VS Code).
process.env.KERNL_USER_DIR = mkdtempSync(join(tmpdir(), "kernl-vscode-userdir-"));
// Claude Code's config folder too (agents/ and skills/ are read from it).
process.env.CLAUDE_CONFIG_DIR = mkdtempSync(join(tmpdir(), "kernl-vscode-claudedir-"));
// Codex's and OpenCode's config folders (MCP servers, skills, instructions are imported from them).
process.env.CODEX_HOME = mkdtempSync(join(tmpdir(), "kernl-vscode-codexdir-"));
process.env.XDG_CONFIG_HOME = mkdtempSync(join(tmpdir(), "kernl-vscode-configdir-"));
// OpenCode's data (its sessions), so listing the agents' sessions never reaches the real one.
process.env.XDG_DATA_HOME = mkdtempSync(join(tmpdir(), "kernl-vscode-datadir-"));

// The workspace is a git repo with one commit, so the panel tests can create worktree workspaces from Main.
const git = (...args: string[]) => execFileSync("git", args, { cwd: workspace, stdio: "ignore" });
git("init", "-q", "-b", "main");
git("config", "user.email", "test@example.com");
git("config", "user.name", "kernl Test");
writeFileSync(join(workspace, "README.md"), "test workspace\n");
git("add", "-A");
git("commit", "-q", "-m", "init");

// KERNL_WORKSPACE=multi: a multi-root window with two git repos (alpha and beta) instead of one folder.
function multiRootWorkspace(): string {
  const parent = mkdtempSync(join(tmpdir(), "kernl-vscode-multi-"));
  for (const name of ["alpha", "beta"]) {
    const dir = join(parent, name);
    execFileSync("git", ["init", "-q", "-b", "main", dir]);
    const g = (...args: string[]) => execFileSync("git", args, { cwd: dir, stdio: "ignore" });
    g("config", "user.email", "test@example.com");
    g("config", "user.name", "kernl Test");
    writeFileSync(join(dir, "README.md"), `${name}\n`);
    g("add", "-A");
    g("commit", "-q", "-m", "init");
  }
  const file = join(parent, "Test.code-workspace");
  writeFileSync(file, JSON.stringify({ folders: [{ path: "alpha" }, { path: "beta" }] }));
  return file;
}

async function launch() {
  const opened = process.env.KERNL_WORKSPACE === "multi" ? multiRootWorkspace() : workspace;
  await runTests({
    vscodeExecutablePath: process.env.VSCODE_PATH ?? "/Applications/Visual Studio Code.app/Contents/MacOS/Code",
    extensionDevelopmentPath: resolve(__dirname, "../.."),
    extensionTestsPath: resolve(__dirname, process.env.KERNL_SUITE ?? "suite.cjs"),
    // Empty extensions dir keeps built-ins (js-debug provides editor-browser) but no user extensions.
    launchArgs: [opened, "--extensions-dir", extensionsDir, "--user-data-dir", profile, "--disable-workspace-trust"],
  });
}

launch().catch((e) => {
  console.error(`VS Code integration run failed: ${e?.message ?? e}`);
  process.exit(1);
});
