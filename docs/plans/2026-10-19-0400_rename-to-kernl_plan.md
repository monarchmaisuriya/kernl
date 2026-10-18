# Rename the project to kernl

- Date: 2026-10-19 04:00
- Status: done (except uninstalling the old extension and committing: M's call)
- Repos: kernl (was yourstack)
- Files: every tracked source, test, script, and doc outside `docs/` that says YourStack (65 files, 560 occurrences); `package.json`, `package-lock.json` (name only), `media/icon.png`, `media/activity.svg`
- Subagents: none

## Context and decisions (M, 2026-10-19)

M asked to rename the project to kernl, and answered three questions:

| Question | M's answer |
| --- | --- |
| How deep | Full rename, fresh start: ids, settings, commands, folders, and branch prefix all become kernl; nothing is carried over from YourStack |
| Repo and folder | Rename both: GitHub `pushowl/yourstack` becomes `pushowl/kernl` (M already renamed the local folder to `~/Experiment/kernl`) |
| Casing | `kernl`, lowercase everywhere |

## What is true today

- **Where the name appears:** 560 occurrences in 65 files (`yourstack` 468, `YourStack` 245, `YOURSTACK_*` env names) [verified: grep]. They cover:
  - extension id `local.yourstack`;
  - 33 setting and command ids `yourstack.*`;
  - secret names `yourstack.apiKey.*` and `yourstack.agentKey.*`;
  - folders `~/.yourstack` and `.yourstack/`;
  - the `yourstack/` branch prefix;
  - env vars `YOURSTACK_USER_DIR`, `YOURSTACK_SUITE`, `YOURSTACK_WORKSPACE`.
- **New logo:** M added a kernl logo at `static/kernl.png` (500 px, black rounded square with a white K) [verified: file].

## Design

- **Mechanical rename** in `src/`, `test/`, `scripts/`, `media/`, `README.md`, `package.json`, and `package-lock.json`'s own name: `YOURSTACK_` becomes `KERNL_`, `YourStack` becomes `kernl`, `yourstack` becomes `kernl`.
- **Results:**
  - extension id `local.kernl`, settings and commands `kernl.*`;
  - `~/.kernl`, `.kernl/`, branch prefix `kernl/`;
  - the package `kernl.vsix`.
- **Not touched:** `docs/` keeps its history as written; `static/` is M's.
- **Icons:**
  - The new logo replaces `media/icon.png`, the extension icon.
  - `media/activity.svg` becomes a single-color K for the activity bar.
- **Fresh start, consequences named:**
  - YourStack's stored keys, conversations, restore points, and worktree workspaces stay with the old extension.
  - Existing `yourstack/*` branches and `.yourstack/` folders are no longer read.
  - The old extension should be uninstalled, or both panels show (M's call).
- **GitHub:** `gh repo rename kernl` on `pushowl/yourstack`, then point `origin` at `https://github.com/pushowl/kernl.git`. GitHub redirects the old URL.

## Acceptance criteria

- **No old name left:** `grep -ri yourstack` outside `docs/` and `node_modules` finds nothing.
- **Tests pass:** unit, VS Code single-folder, and multi-root suites all pass under the new ids.
- **It installs:** `kernl.vsix` installs as `local.kernl`, and the panel reads "kernl: Agent".
- **Remote updated:** `origin` points at `pushowl/kernl`.

## Parts

- [x] Rename text and ids; icons.
- [x] Tests, package, install.
- [x] GitHub rename and remote.

## Standardized review

- **Findings:**
  1. **Must-verify, fixed (failure):** the rename text must not touch `node_modules` or build output, and the lock file only by its own `name`. The scope above limits it.
  2. **Must-verify (completeness):** the user-facing old extension needs M's decision (uninstall); it's surfaced, not done silently.
  3. **Note:** lowercase "kernl" at the start of a sentence is intended (M's choice).
- **Overall:** 0 blocking, 2 must-verify (handled), 1 note.

## Changes made

- 65 files renamed (`YourStack` and `yourstack` to `kernl`, `YOURSTACK_` to `KERNL_`); the lock file's own name only; 0 occurrences left outside `docs/`.
- `media/icon.png` is M's kernl logo; `media/activity.svg` is a single-color K with its dot.
- Tests: unit 195, VS Code 51, multi-root 5, all passing on the packaged `kernl.vsix`; installed as `local.kernl`.
- GitHub: `pushowl/yourstack` is now `pushowl/kernl` (private); `origin` updated; `main` reachable at `4db6960`.

## Open questions

- Uninstall the old YourStack extension from M's VS Code? (Asked at the end.)
