// npm run release -- <major|minor|patch> [--dry-run] [--trailer "<git trailer>"]
// Releases the current main: checks, unit tests, version bump, changelog, kernl-X.Y.Z.vsix, a
// "Release vX.Y.Z" commit, and an annotated tag. It never pushes: it prints the publish commands.
// --dry-run runs the checks and prints what it would do, changing nothing (tests aren't run).
import { execFileSync } from "node:child_process";
import { mkdirSync, readFileSync, writeFileSync } from "node:fs";
import { join } from "node:path";
import { releaseChangelog, unreleasedEntries, versionNotes } from "./changelog.mjs";

const args = process.argv.slice(2);
const level = args.find((a) => ["major", "minor", "patch"].includes(a));
const dryRun = args.includes("--dry-run");
const trailerAt = args.indexOf("--trailer");
const trailer = trailerAt >= 0 ? args[trailerAt + 1] : undefined;

const run = (cmd, cmdArgs, opts = {}) => execFileSync(cmd, cmdArgs, { encoding: "utf8", ...opts }).trim();
const refuse = (why) => {
  console.error(`Not releasing: ${why}`);
  process.exit(1);
};

if (!level) refuse("say which part of the version to raise: npm run release -- <major|minor|patch> [--dry-run]");
const branch = run("git", ["branch", "--show-current"]);
if (branch !== "main") refuse(`releases are made from main; this is ${branch || "a detached HEAD"}`);
const dirty = run("git", ["status", "--porcelain"]);
if (dirty) refuse(`the working tree has uncommitted changes:\n${dirty}`);
const changelog = readFileSync("CHANGELOG.md", "utf8");
if (!unreleasedEntries(changelog)) refuse('"Unreleased" in CHANGELOG.md has no entries: add a line for each change first');

const pkg = JSON.parse(readFileSync("package.json", "utf8"));
const [major, minor, patch] = pkg.version.split(".").map(Number);
const version = level === "major" ? `${major + 1}.0.0` : level === "minor" ? `${major}.${minor + 1}.0` : `${major}.${minor}.${patch + 1}`;
const tag = `v${version}`;
if (run("git", ["tag", "-l", tag])) refuse(`the tag ${tag} already exists`);
const date = new Date().toISOString().slice(0, 10);
const repo = String(pkg.repository?.url ?? "").replace(/^git\+/, "").replace(/\.git$/, "");
if (!repo.startsWith("https://github.com/")) refuse(`package.json's repository.url isn't a GitHub URL (${repo || "missing"})`);
const vsix = `kernl-${version}.vsix`;

console.log(`Release ${pkg.version} -> ${version} (${level}) on ${date}: tests, version, CHANGELOG.md, ${vsix}, commit "Release ${tag}", tag ${tag}.`);
if (dryRun) {
  console.log("Dry run: checks passed; nothing was changed and the tests weren't run.");
  process.exit(0);
}

execFileSync("npm", ["run", "-s", "test:unit"], { stdio: "inherit" });
run("npm", ["version", level, "--no-git-tag-version"]);
const released = releaseChangelog(changelog, version, date, repo);
writeFileSync("CHANGELOG.md", released);
execFileSync("node", ["scripts/build.mjs", "--production"], { stdio: "inherit" });
execFileSync("npx", ["vsce", "package", "--no-dependencies", "--skip-license", "-o", vsix], { stdio: "inherit" });
run("git", ["add", "package.json", "package-lock.json", "CHANGELOG.md"]);
run("git", ["commit", "-m", `Release ${tag}`, ...(trailer ? ["--trailer", trailer] : [])]);
run("git", ["tag", "-a", tag, "-m", `kernl ${version}`]);
mkdirSync("out", { recursive: true });
const notes = join("out", `release-notes-${version}.md`);
writeFileSync(notes, `${versionNotes(released, version)}\n`);

console.log(`\nReleased ${tag} locally (${vsix}). Nothing was pushed. To publish:\n`);
console.log(`  git push origin main ${tag}`);
console.log(`  gh release create ${tag} ${vsix} --title "kernl ${version}" --notes-file ${notes}`);
