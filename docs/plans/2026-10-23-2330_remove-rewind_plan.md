# Remove the rewind (Restore checkpoint) feature

- Date: 2026-10-23 23:30
- Status: in progress (part 3 of 3)
- Repos: kernl   Files: `src/checkpoints.ts` (delete), `test/unit/checkpoints.test.ts` (delete), `src/workspaceRuntime.ts`, `src/controller.ts`, `src/ui/protocol.ts`, `src/webview/main.ts`, `src/webview/messageActions.ts`, `src/chatRequest.ts` (comment), `package.json` (command title), `test/unit/webview.test.ts`, `test/vscode/suite.ts`, `docs/guides/panel.md`, `docs/guides/help.md`, `docs/guides/providers.md`, `docs/known-issues/README.md`, `CHANGELOG.md`
- Subagents: none
- Sign-off: M (2026-10-23): "remove the rewind feature completely, commit, push merge pr and build and release". Then "Approved with A: remove the rewind feature, delete the old checkpoints folder once on startup, then branch, commit, push, open a PR, merge it, release 0.13.0, and install."

## Context and problem

kernl snapshots the workspace's files (a private git repository in extension storage) before every message, so **Restore checkpoint** under a message can put the files back and, for kernl's own agent, cut the conversation there ("rewind"). M wants the feature gone entirely.

## What is true today

- Snapshots: a "baseline" when a workspace opens and one before each message, in `<globalStorage>/checkpoints` [verified: `src/workspaceRuntime.ts:219`, `:528-544`; `src/controller.ts:228`]. On M's machine that folder is 372 MB [verified: `du -sh`].
- Restore: the panel's Restore button sends `restore`; the host offers "files and conversation" or "files only", lists the files, restores, and offers Undo [verified: `src/webview/main.ts:522-526`, `src/controller.ts:1085-1112`, `src/workspaceRuntime.ts:900-930`].
- Protocol: `userMessage.checkpoint`, the `checkpoint` message, the `restore` message, the `restore:<id>` menu anchor [verified: `src/ui/protocol.ts:190-217`, `:284`].
- **Delete conversations and checkpoints** also clears the snapshots [verified: `src/controller.ts:1224-1226`, `package.json:158`].
- Kept, because something else uses them: `cutHistory` and each message's `turn` (Fork from here) [verified: `src/workspaceRuntime.ts:878`]; `setInput` (a failed fork puts the message back) [verified: `src/controller.ts:1740`]; the "starting" phase and Stop-before-start (tagged threads are read before the agent starts) [verified: `src/workspaceRuntime.ts:535-539`].
- Not this feature (kept): LangGraph's `MemorySaver` checkpointer and `@langchain/langgraph-checkpoint` [verified: `src/agent/createAgent.ts:40`, `package.json:952`]; the browser's focus "restore" [verified: `src/browser/integratedBrowser.ts:319`].

## Decision for M: the stored snapshots

| | A: delete the folder once on startup (recommended) | B: leave it |
| --- | --- | --- |
| How | On activation, kernl removes `<globalStorage>/checkpoints` if it exists (its own storage, used only by this feature) | Nothing touches it |
| Effect | Frees the space (372 MB here); nothing can use it any more | The space stays used; delete it by hand if wanted |
| Risk | Irreversible, but the data is only readable by the removed feature | None |
| Completeness | 9/10 | 5/10 |

RECOMMENDATION: A, because the data serves nothing once the feature is gone.

## Design

```
send ─> show message ─> [snapshot]          ─> read tagged threads ─> agent        before
send ─> show message ─────────────────────────> read tagged threads ─> agent        after   <-- snapshot removed
```

- Delete `src/checkpoints.ts` and its unit test; remove `checkpoints` from the runtime host, the baseline snapshot, the per-message snapshot, `checkpointOf`, `restore`, the controller's restore flow and Undo, the `restore` panel message, the `checkpoint` message, `userMessage.checkpoint`, and the `restore:` anchor.
- Panel: no Restore button; message actions are Copy and Fork (`MessageActionId` "copy" | "fork").
- Clear history: **Delete conversations** (title and prompt drop "and checkpoints"); same command id.
- Saved conversations keep any old `checkpoint` field in their files; nothing reads it.
- (A) A one-time removal of the old folder at activation, idempotent.
- Docs and changelog say Restore is removed.

## Risks and mitigations

| Risk | Likelihood | Impact | Mitigation | How noticed |
| --- | --- | --- | --- | --- |
| Something else relied on the snapshot timing (the Stop-before-start check) | Low | A suite check breaks | That check is rewritten to hold the thread read instead of the snapshot | Suite |
| A leftover reference to `checkpoints` | Low | Build or type error | tsc and grep for `checkpoint`/`restore` before done | tsc, grep |
| Users who relied on Restore | Medium | They lose an undo for agent edits | Changelog says so; VS Code's own undo and git remain | M's call (asked for removal) |

## Acceptance criteria

- Given a message, then no snapshot is taken and no Restore button shows; Copy and Fork work as before.
- Given **Delete conversations**, then conversations are deleted and the prompt doesn't mention checkpoints.
- Given (A), when the new version starts, then `<globalStorage>/checkpoints` is gone.
- Given the codebase, then `grep -i checkpoint src` finds only LangGraph's checkpointer.

## Rollout and rollback

Branch `remove-rewind`, commit, push, pull request, merge (as M asked), then release 0.13.0 from `main` (a removed feature: minor) and install. Rollback: revert the merge; with (A) the old snapshots are gone either way.

## Parts

- [x] Remove the code, protocol, panel button, and tests; rewrite the Stop-before-start check without a snapshot; (A) the one-time cleanup. Done: tsc clean; grep clean; unit and both suites pass.
- [x] Docs, changelog, command title. Done: no "Restore checkpoint" left in the guides.
- [ ] Branch, commit, push, PR, merge, release 0.13.0, install. Done: release published; installed files match.

## Standardized review

**Bottom line:** plan, approve with notes. Every rewind-only piece is listed with evidence, and the three shared pieces (`cutHistory`, `turn`, `setInput`) and the unrelated LangGraph checkpointer are explicitly kept; the one irreversible step (deleting stored snapshots) is left to M.

| Criterion | Verdict | Evidence |
| --- | --- | --- |
| Goal fidelity | pass | "remove completely" covers code, protocol, UI, docs, and stored data |
| Current-system accuracy | pass | Each site cited |
| Scope and cohesion | pass | Only the feature and what exists solely for it |
| Architecture and dependency direction | pass | Shared pieces kept at their owners |
| Sequencing | pass | Code, then docs, then ship |
| Completeness | pass | Stored data, saved conversations' old fields, the clear command |
| Failure and recovery | pass | Revert path; the data decision stated as irreversible |
| Verification | pass | tsc, grep, unit, both suites |
| Feasibility | pass | Straight removals; one suite check rewritten |
| Decision readiness | pass | A or B surfaced |

Findings:
- **Note, Chesterton's fence:** `setInput`'s comment says it's for restore, but Fork uses it too; keep it and fix the comment.
- **Note, data:** option A deletes data; it's irreversible, so it needs M's explicit choice.

## Changes made

- Removed: `src/checkpoints.ts` and its unit test; the snapshots, Restore flow, `restore`/`checkpoint` messages, `restore:` anchor, Restore button and `undo` icon. Message actions are Copy and Fork. **Delete conversations** no longer mentions checkpoints. (A): activation removes `<globalStorage>/checkpoints` once (`src/controller.ts`).
- Suite finding: with the snapshot gone, "a message sent while the agent starts early" failed (two `initialize` and two `newSession` lines in the fake agent log). Cause: `prepareAgent` and `sendNow` each ran `this.runner ??= await this.creating`, which checks before waiting and assigns after; the build cleared `creating` before either stored the runner, so a send in that gap built a second runner and overwrote the first. The snapshot delay had hidden it. Fix (M approved): `runnerReady()` is the only place that builds and stores the runner, storing it before the build counts as finished; all four sites use it.
- Verified: tsc clean; unit 422/422; single-folder 103/103; multi-root 7/7; `grep -i checkpoint src` finds only the cleanup line and LangGraph. Real window (fresh profile with a seeded `checkpoints` folder): gone 2 s after start.

## Open questions

- None (M chose A).
