# Docs folders and a shorter README

- Date: 2026-10-19 07:00
- Status: done
- Repos: kernl   Folders: `docs/`, repo root   Files: `README.md`, `package.json`, new files under `docs/`, the 17 existing dated `docs/*.md` (moved)
- Subagents: none

## Context and problem

The README is 285 lines and holds everything: install, a full panel tour, permission modes, providers, approval rules, customisation files, CLI agents, workspaces, architecture, tests, and upgrade steps. A new reader can't find the quick start, and a contributor can't find the architecture without scrolling past the user guide. `docs/` is a flat list of 17 dated plan and research files with no index.

M asked for folders in the docs directory (architecture, known issues, development, and others) and a trimmed README.

## Goals / Non-goals

**Goals**

- `docs/` has topic folders, each with a clear purpose, plus an index.
- The README fits on about one screen: what kernl is, install, first run, the safety promise, and links into `docs/`.
- No content is lost: every README section lands in exactly one doc.
- `npm run package` still works, and the README links work where people read them.

**Non-goals**

- Rewriting or fact-checking every moved sentence. Content moves as is, except the two stale spots named under Design.
- New architecture diagrams or design write-ups beyond what the README has today.
- Changing M's global plan and research playbooks.

## What is true today

- **The README is packaged into the extension.** `.vscodeignore` keeps `README.md` [verified: `.vscodeignore`, line `!README.md`], so it is the extension's Details page inside VS Code. `docs/` is not packaged [verified: same file, everything else is excluded by `**`].
- **A relative link in the README breaks packaging.** `vsce` throws "Couldn't detect the repository where this extension is published. The link '…' will be broken" for any relative link when no repository is known [verified: `node_modules/@vscode/vsce/out/package.js:590`]. `package.json` has no `repository` field, and packaging passes `--allow-missing-repository` [verified: `package.json:424`; grep for `"repository"` finds nothing].
- **Nothing in code points at `docs/` files.** The only `docs/` strings in `src/` and `test/` are sample paths in tests and a comment [verified: grep of `src`, `test`, `scripts`, `package.json`].
- **Two README spots are stale.** "CLI agents" says each agent runs in one forced mode ("Manual: every edit and command asks"), and "How it is built" says the agent catalog holds a "forced ask mode" [verified: `README.md:201-203`, `README.md:259`]. Since the permission modes work, the mode chip picks the mode per agent [verified: `src/acp/agents.ts` `modes` per agent; README "Permission modes" table].
- **Plan and research files live in the root of `docs/`.** M's playbooks write new ones to `docs/` [verified: `~/.claude/skills/plan/SKILL.md`, "Location: `docs/` inside the touched repo"].

## Options considered

| Aspect | A: topic folders, history kept in `plans/` and `research/` | B: topic folders, history left in the root of `docs/` | C: one file per README section, no folders |
| --- | --- | --- | --- |
| How it works | `architecture/`, `development/`, `guides/`, `known-issues/`, `plans/`, `research/`, plus `docs/README.md` | Same topic folders; the 17 dated files stay where they are | `docs/panel.md`, `docs/providers.md`, … |
| Fits the ask | Yes | Yes | No (no folders) |
| Cost | 17 moves (plus this plan), by `git mv` so history follows | Fewer moves | Least |
| When it fails | New plans still land in the root (playbook says `docs/`) until they're moved | The root stays cluttered; topic docs mix with dated files | Doesn't scale; ignores the ask |
| Completeness | 9/10 | 7/10 | 4/10 |

RECOMMENDATION: A, because it separates living docs (kept current) from history (dated, never edited), which is the clutter M sees today.

## Decision

Option A, plus a `repository` field in `package.json` so the README's relative links become GitHub links in the packaged extension, instead of breaking `npm run package`.

## Design

```
README.md                      <-- trimmed: what, install, first run, safety, links
docs/
  README.md                    <-- new: index, and where new docs go
  guides/                      <-- user-facing reference, moved from the README
    panel.md                     The panel (title bar, composer, thinking, tools, plan, context, approvals, accessibility)
    permission-modes.md          Permission modes
    providers.md                 Model providers, keys, model options
    approvals.md                 What asks, approval rules, settings a workspace can't change
    customisation.md             AGENTS.md, rules, named agents, skills, built-in tools
    cli-agents.md                Claude Code, Codex, OpenCode (stale "forced mode" table corrected)
    workspaces.md                Multi-root folders, worktree workspaces
  architecture/
    overview.md                  "How it is built" (stale "forced ask mode" corrected)
  development/
    building.md                  Build, package, install the VSIX locally, check the install
    testing.md                   Every test command and what it covers
    upgrading.md                 Upgrading Deep Agents, LangChain, VS Code
  known-issues/
    README.md                    Open limits, each with what happens, why, and the workaround
  plans/                       <-- the 13 dated *_plan.md files and this one (git mv)
  research/                    <-- the 4 dated *_research.md files (git mv)
```

**README keeps** (about 40 lines): one paragraph on what kernl is; install from VSIX; first run (open the panel, pick an agent, add a key or use a CLI login); the safety promise (every change asks, keys only in SecretStorage, tracing off); requirements (VS Code 1.140+); a "Docs" list linking each folder.

**Known issues, first entries** (from this session, each tagged in the file): Claude summarized thinking unverified without a key; a stored Codex key unverified; Codex is experimental; deny rules aren't a security boundary; OpenCode's "Edit automatically" restarts it; Claude Code forks only from the last message; restoring a checkpoint can't undo terminal side effects; the integrated browser relies on the undocumented `requestCDPProxy`.

**Contracts touched:** `package.json` gains `"repository": {"type": "git", "url": "https://github.com/pushowl/kernl"}`; `--allow-missing-repository` is removed from the `package` script since it's no longer needed. With the field set, `vsce` rewrites relative links to `https://github.com/pushowl/kernl/blob/HEAD/...`. The repo is private, so those links open only for people with access.

## Risks and mitigations

| Risk | Likelihood | Impact | Mitigation | How we'd notice |
| --- | --- | --- | --- | --- |
| The packaged README links 404 for people without repo access | High (repo is private) | Low (team-only extension today) | Accepted; the README itself keeps install and safety, so it stands alone | Clicking a link in the Details page |
| Content dropped in the move | Low | Medium | A check that every README H2/H3 heading of today appears in exactly one new doc | The heading check fails |
| New plans keep landing in the root of `docs/` | High | Low | `docs/README.md` says where they go; move them at commit time | `ls docs/*.md` shows dated files |
| Relative links inside moved plans break | Medium | Low | Grep moved files for `](` relative links and fix them | The grep |

## Acceptance criteria

- Given the new layout, when M opens `docs/`, then it shows `README.md` and six folders, and no dated files.
- Given today's README headings, when the check runs, then each lands in exactly one doc.
- Given the trimmed README, when `npm run package` runs, then it succeeds and the packaged README's links point at `github.com/pushowl/kernl`.
- Given the trimmed README, when read on its own, then it says what kernl is, how to install, how to start, and what it never does without asking.

## Rollout and rollback

Docs and one `package.json` field only; no runtime change. Rollback: revert the commit.

## Parts

### Part 1: folders and moves

- [x] Create the six folders and `docs/README.md`. Done: `ls docs` shows them.
- [x] `git mv` the dated plan and research files. Done: `git status` shows renames, no deletes.
- [x] Fix relative links inside moved files. Done: grep finds none broken.

### Part 2: README split

- [x] Move each README section into its doc, correcting the two stale spots. Done: the heading check passes.
- [x] Write `development/building.md` and `known-issues/README.md`. Done: files exist with the content above.
- [x] Trim the README. Done: about 40 lines, links to every folder.

### Part 3: packaging

- [x] Add `repository`, drop `--allow-missing-repository`. Done: `npm run package` succeeds; `unzip -p kernl.vsix extension/readme.md` shows GitHub links.

## Standardized review

- **Bottom line:** usable, pending M's choices on the folder name and where dated plans go.
- **Criteria:** goal fidelity pass; current-system accuracy pass (packaging and link facts verified in `vsce`'s source); scope pass (no rewrite, two named corrections); sequencing pass; completeness pass (packaging covered); failure and recovery pass (revert); verification pass (heading check, package check); decision readiness: two open questions below.
- **Findings:**
  1. **Must-verify:** the packaged README's GitHub links work only for repo members. Accepted as a risk; M confirms.
  2. **Note:** M's playbooks still write new plans to the root of `docs/`. Changing the playbook is out of scope; `docs/README.md` documents the convention.

## Changes made

- **Part 1:** six folders and `docs/README.md`; 13 plans and 4 research briefs moved with `git mv` (history follows); 4 plan-to-research path mentions updated. No relative links inside moved files needed fixing (the one match is example syntax).
- **Part 2:** README sections moved verbatim into 7 guides, the architecture overview, and testing and upgrading docs; a check confirmed all 15 headings land in exactly one doc and the only changed lines are the 4 stale-mode corrections. New `development/building.md` and `known-issues/README.md`. README is 39 lines (was 285).
- **Part 3:** `repository` added and `--allow-missing-repository` dropped; `npm run package` succeeds and the packaged README links to `https://github.com/pushowl/kernl/blob/HEAD/docs/...`. All 35 relative links in README and docs resolve.

## Open questions

None. Decided by M: keep `docs/`; move dated plans and research into `plans/` and `research/`; add the repository field.
