# Releases, semantic versions, and a changelog

- Date: 2026-10-19 11:00
- Status: done
- Repos: kernl   Folders: repo root, `scripts/`, `docs/development/`
- Files: new `CHANGELOG.md`, new `scripts/release.mjs`, `package.json` (version, `release` script), `package-lock.json` (version), new `docs/development/releasing.md`, `docs/README.md`, `README.md` (one link)
- Subagents: none

## Context and problem

kernl has no releases: `package.json` says 0.1.0 since the first commit, there are no git tags, and no changelog [verified: `package.json:10`; `git tag -l` is empty; no `CHANGELOG*` file]. Twelve commits have shipped since, and the installed VSIX can't be told apart from any other build. M asked for releases with semantic versions and a maintained changelog.

## Goals / Non-goals

**Goals**

- Every release has a version (MAJOR.MINOR.PATCH), a git tag `vX.Y.Z`, a changelog section, and a VSIX named for it, attached to a GitHub release.
- The changelog is kept as work lands (an "Unreleased" section), not reconstructed at release time.
- One command does the local steps the same way every time; publishing (push, GitHub release) stays a separate, explicit step.

**Non-goals**

- The VS Code Marketplace (kernl is a team VSIX; `publisher` is `local`).
- CI that builds releases on GitHub (one more moving part; the local command is enough for now).
- Conventional-commit tooling that writes the changelog from commit messages (the changelog is written for readers, by hand).

## What is true today

- Version 0.1.0, private package, packaged with `vsce` to `kernl.vsix` [verified: `package.json:10,424`].
- No tags; 12 commits from `6ea9b17` (2026-10-18, first commit) to `2665546` (2026-10-19) [verified: `git log`].
- Commit and push are M's; the agent runs them only when asked (M's protocol).

## Options considered

| Aspect | A: local release script + GitHub release (recommended) | B: `npm version` only | C: CI release on tag push |
| --- | --- | --- | --- |
| How it works | `npm run release -- minor` checks the tree, runs tests, bumps the version, moves "Unreleased" to the new version with a date, packages `kernl-X.Y.Z.vsix`, commits, and tags. Then `git push` and `gh release create` publish | `npm version minor` bumps, commits, tags; changelog and VSIX by hand | A tag push makes GitHub Actions build and attach the VSIX |
| Changelog kept | Enforced: refuses to release with an empty "Unreleased" | By hand, easy to forget | Needs the same check |
| Cost | One small script, one doc | None | A workflow, secrets, and runner minutes on a private repo |
| When it fails | Someone releases without the script (the doc says how) | Changelog and VSIX drift | Breaks when the runner differs from a Mac |
| Completeness | 9/10 | 5/10 | 8/10 |

RECOMMENDATION: A, because it makes every release the same with one command and keeps publishing an explicit, separate step.

## Decision

Option A. Semantic Versioning 2.0.0 and Keep a Changelog 1.1.0. Before 1.0.0, a breaking change bumps MINOR and anything else PATCH or MINOR as usual.

## Design

### Versions

- **0.1.0** is the first commit (`6ea9b17`): tagged after the fact, so history has a start.
- **0.2.0** is everything since, including this round's fixes: the first real release.
- After that: features → MINOR, fixes → PATCH, breaking changes → MINOR until 1.0.0, then MAJOR.

### `CHANGELOG.md`

Keep a Changelog layout: `## [Unreleased]`, then `## [0.2.0] - 2026-10-19` and `## [0.1.0] - 2026-10-18`, each with Added / Changed / Fixed / Removed / Security as needed, written for users (what changed, not file names), with compare links at the bottom.

### `scripts/release.mjs` (`npm run release -- <major|minor|patch>`)

1. Refuse unless: on `main`, the working tree clean, and "Unreleased" has entries.
2. Run the unit tests.
3. Bump `package.json` and `package-lock.json` (`npm version <level> --no-git-tag-version`).
4. Move "Unreleased" into `## [X.Y.Z] - <today>`, leave a fresh empty "Unreleased", update the compare links.
5. Package `kernl-X.Y.Z.vsix`.
6. Commit "Release vX.Y.Z" (only `package.json`, `package-lock.json`, `CHANGELOG.md`) and create an annotated tag `vX.Y.Z`.
7. Print the two publish commands, which it does not run: `git push origin main vX.Y.Z` and `gh release create vX.Y.Z kernl-X.Y.Z.vsix --notes-file <that version's changelog section>`.

### `docs/development/releasing.md`

Versioning rules, how to add a changelog line with each change, the release command, the publish commands, and how to install a released VSIX.

## Risks and mitigations

| Risk | Likelihood | Impact | Mitigation | How we'd notice |
| --- | --- | --- | --- | --- |
| A release is made with failing tests | Low | Medium | The script runs them first and stops on failure | Script exits non-zero |
| The changelog falls behind | Medium | Low | The script refuses an empty "Unreleased"; the doc asks for a line per user-facing change | Refusal at release time |
| A tag points at the wrong commit | Low | Medium | Annotated tag made by the script right after its own commit | `git show vX.Y.Z` |
| The VSIX attached isn't the tagged code | Low | Medium | Packaged by the script from the tagged tree | Its `package.json` version |

## Acceptance criteria

- Given the repo after this work, then `CHANGELOG.md` has "Unreleased", 0.2.0, and 0.1.0 sections, and `v0.1.0` tags `6ea9b17`.
- Given `npm run release -- minor` on a clean `main` with changelog entries, then the version, changelog, VSIX, commit, and tag are all X.Y.Z, and nothing is pushed.
- Given a dirty tree, another branch, or an empty "Unreleased", then the script refuses and says why.
- Given M's OK, then `v0.2.0` is pushed and a GitHub release has `kernl-0.2.0.vsix` and the 0.2.0 notes.

## Rollout and rollback

Local files first (changelog, script, doc), committed. The release itself (tags, push, GitHub release) only after M's OK. Rollback: delete the GitHub release and the remote tag (M's call), revert the release commit.

## Parts

### Part 1: changelog and versioning doc

- [x] `CHANGELOG.md` with 0.1.0 and 0.2.0 written from the history; `docs/development/releasing.md`; links from `docs/README.md` and `README.md`. Done: files exist and read correctly.

### Part 2: release script

- [x] `scripts/release.mjs` and `npm run release`. Done: a dry run (`--dry-run`: checks and prints the plan, changes nothing) on this repo; refusal cases checked.

### Part 3: release 0.2.0 (after M's OK)

- [x] Tag `v0.1.0` at `6ea9b17`; run the release for 0.2.0; push; create the GitHub release with the VSIX. Done: `gh release view v0.2.0` shows the VSIX and notes.

## Standardized review

- **Bottom line:** usable; one decision for M (the version numbers).
- **Criteria:** goal fidelity pass; current-system accuracy pass (version, tags, packaging tagged); scope pass (no Marketplace, no CI); sequencing pass (files, script, then the outward release); completeness pass; failure and recovery pass (refusals, rollback); verification pass; decision readiness: one question.
- **Findings:**
  1. **Note:** publishing (push, tag push, GitHub release) is outward-facing and stays a separate step that needs M's OK each time.

## Changes made

- Part 1: `CHANGELOG.md` (0.2.0 entries under "Unreleased", moved by the script at release), `docs/development/releasing.md`, links from `docs/README.md` and `README.md`; the VSIX includes the changelog.
- Part 2: `scripts/release.mjs` (`npm run release -- <level> [--dry-run] [--trailer]`) with the changelog step in `scripts/changelog.mjs` and its unit test; refusals checked for uncommitted changes and a missing level, and for an empty "Unreleased" in the unit test.
- Part 3: `v0.1.0` tags `6ea9b17`; 0.2.0 was released with the script (`v0.2.0` on `1119e47`), pushed with `main`, and published at https://github.com/pushowl/kernl/releases/tag/v0.2.0 with `kernl-0.2.0.vsix`. A first local 0.2.0 was undone (with M's OK) after the live check found two defects, which were fixed first.

Decided by M on 2026-10-19: option A, 0.1.0 is the first commit, this release is 0.2.0.

## Open questions

1. **Version numbers.** A (recommended): 0.1.0 = the first commit (tagged after the fact), 0.2.0 = this release, staying below 1.0.0 while the panel's behavior still changes week to week. B: release this as 1.0.0. RECOMMENDATION: A because 1.0.0 promises a stable surface, and the panel's protocol and settings are still moving. Completeness: A 9/10, B 7/10.
