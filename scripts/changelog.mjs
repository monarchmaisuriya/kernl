// CHANGELOG.md (Keep a Changelog) changes for a release: the "Unreleased" entries become the new
// version's section, a fresh empty "Unreleased" is left on top, and the compare links follow.

const UNRELEASED = /^## \[Unreleased\][^\n]*\n([\s\S]*?)(?=^## \[|^\[Unreleased\]:)/m;

/** The text under "Unreleased", or "" when it has no entries (headings alone don't count). */
export function unreleasedEntries(text) {
  const m = UNRELEASED.exec(text);
  if (!m) throw new Error('CHANGELOG.md has no "## [Unreleased]" section');
  const body = m[1].trim();
  return /^- /m.test(body) ? body : "";
}

/** One version's section body (for the GitHub release notes). */
export function versionNotes(text, version) {
  const m = new RegExp(`^## \\[${version.replace(/\./g, "\\.")}\\][^\\n]*\\n([\\s\\S]*?)(?=^## \\[|^\\[Unreleased\\]:)`, "m").exec(text);
  if (!m) throw new Error(`CHANGELOG.md has no section for ${version}`);
  return m[1].trim();
}

/** The changelog after releasing `version` on `date` (YYYY-MM-DD); `repo` is the GitHub URL for compare links. */
export function releaseChangelog(text, version, date, repo) {
  const entries = unreleasedEntries(text);
  if (!entries) throw new Error('"Unreleased" in CHANGELOG.md has no entries: add a line for each change before releasing');
  const released = text.replace(UNRELEASED, `## [Unreleased]\n\n## [${version}] - ${date}\n\n${entries}\n\n`);
  const previous = /^\[Unreleased\]: .*\/compare\/(v[^.]+\.[^.]+\.[^.]+)\.\.\.HEAD$/m.exec(released)?.[1];
  const links = [`[Unreleased]: ${repo}/compare/v${version}...HEAD`, previous ? `[${version}]: ${repo}/compare/${previous}...v${version}` : `[${version}]: ${repo}/releases/tag/v${version}`];
  return released.replace(/^\[Unreleased\]: .*$/m, links.join("\n"));
}
