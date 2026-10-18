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

async function launch() {
  await runTests({
    vscodeExecutablePath: process.env.VSCODE_PATH ?? "/Applications/Visual Studio Code.app/Contents/MacOS/Code",
    extensionDevelopmentPath: resolve(__dirname, "../.."),
    extensionTestsPath: resolve(__dirname, process.env.YOURSTACK_SUITE ?? "suite.cjs"),
    // Empty extensions dir keeps built-ins (js-debug provides editor-browser) but no user extensions.
    launchArgs: [workspace, "--extensions-dir", extensionsDir, "--user-data-dir", profile, "--disable-workspace-trust"],
  });
}

launch().catch((e) => {
  console.error(`VS Code integration run failed: ${e?.message ?? e}`);
  process.exit(1);
});
