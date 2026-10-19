// The release script's changelog step: "Unreleased" becomes the new version with its date, a fresh
// "Unreleased" stays on top, the compare links follow, and an empty "Unreleased" refuses a release.
import { strict as assert } from "node:assert";
import { test } from "node:test";
import { releaseChangelog, unreleasedEntries, versionNotes } from "../../scripts/changelog.mjs";

const REPO = "https://github.com/pushowl/kernl";
const BEFORE = `# Changelog

Intro.

## [Unreleased]

### Added

- New thing.

### Fixed

- A bug.

## [0.1.0] - 2026-10-18

### Added

- First.

[Unreleased]: ${REPO}/compare/v0.1.0...HEAD
[0.1.0]: ${REPO}/releases/tag/v0.1.0
`;

test("releasing moves Unreleased under the new version and date, and updates the compare links", () => {
  const after = releaseChangelog(BEFORE, "0.2.0", "2026-10-19", REPO);
  assert.match(after, /## \[Unreleased\]\n\n## \[0\.2\.0\] - 2026-10-19\n\n### Added\n\n- New thing\.\n\n### Fixed\n\n- A bug\.\n\n## \[0\.1\.0\] - 2026-10-18/);
  assert.match(after, new RegExp(`\\[Unreleased\\]: ${REPO}/compare/v0\\.2\\.0\\.\\.\\.HEAD\\n\\[0\\.2\\.0\\]: ${REPO}/compare/v0\\.1\\.0\\.\\.\\.v0\\.2\\.0\\n\\[0\\.1\\.0\\]: ${REPO}/releases/tag/v0\\.1\\.0`));
  assert.equal(unreleasedEntries(after), "", "a fresh, empty Unreleased");
  assert.equal(versionNotes(after, "0.2.0"), "### Added\n\n- New thing.\n\n### Fixed\n\n- A bug.");
  assert.equal(versionNotes(after, "0.1.0"), "### Added\n\n- First.");
});

test("an Unreleased with no entries (only headings) refuses a release", () => {
  const empty = BEFORE.replace("- New thing.", "").replace("- A bug.", "");
  assert.equal(unreleasedEntries(empty), "");
  assert.throws(() => releaseChangelog(empty, "0.2.0", "2026-10-19", REPO), /has no entries/);
  assert.throws(() => unreleasedEntries("# Changelog\n"), /no "## \[Unreleased\]" section/);
});
