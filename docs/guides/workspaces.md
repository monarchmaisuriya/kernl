# Workspaces

## Folders and multi-root windows

A window with one folder has one workspace, "Main". In a multi-root window (a `.code-workspace` with several folders), each local folder is its own workspace in the footer's workspace chip, named after the folder:
- the panel starts on the folder of the file you're editing;
- each folder remembers its own agent (`kernl.harness` is only the default);
- skills and project agents come from the folder you're looking at;
- new worktree workspaces come from that folder's repository (shown as `folder/name`).

With no folder open (or only remote folders), the panel says so and offers **Open Folder**.

## Workspaces (Conductor-style)

**New workspace** (title bar, or the workspace chip's menu) creates a git worktree on a new branch `kernl/<name>` from your current branch, stored
in the extension's storage (outside your repo). Each workspace has its own agent, transcript, and
terminal, and several can run at once. From the workspace chip's menu, **Review** shows each changed file against the base,
**Merge** commits the workspace's pending work and merges into the base (your main checkout must be
on that branch and clean; conflicts are aborted), and **Discard** deletes the worktree and branch. Both ask first.
