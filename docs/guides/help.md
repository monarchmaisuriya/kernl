# kernl help

kernl is a coding agent panel for VS Code. Use its own agent with your model key, or drive your installed Claude Code, Codex, or OpenCode. Every change waits for your click unless you pick a permission mode that allows it.

Each section below is a short tour with things to type. The links go to the full guides.

## Start

1. Open kernl: the kernl icon, `Ctrl+Alt+K`, or the kernl button at the top right of an editor.
2. Pick an agent with the agent chip under the message box: **kernl** (your model key) or **Claude Code**, **Codex**, **OpenCode** (your installed CLIs and their logins).
3. If the agent chip shows a warning, click it: [Connections](connections.md) says what's missing (a login, a key) and fixes it.
4. Type a request and press Enter.

```text
Add a --dry-run flag to scripts/release.mjs that prints the steps without running them
```

## Talking to the agent

- `@` finds files and folders in the workspace: type `@` and part of a name, then pick one from the list. Picked ones show highlighted in your message and go with it.
- `+` attaches files and folders, another conversation, a GitHub issue, or a pull request.
- In the Explorer, right-click files and pick **Add to kernl chat**.
- In an editor, **Ask kernl about this file or selection** (kernl menu) attaches the selected lines.
- `Ctrl+Alt+Shift+K` (**Ask kernl…**) takes a one-line request from anywhere and sends it to the workspace the panel shows.

For example, type `@app`, pick `src/app.ts`, and finish the message:

```text
@src/app.ts why does this throw when the config file is missing?
```

More: [the panel](panel.md#in-the-panel).

## kernl's commands

Type `/` to list them. They run at once, even while the agent works, and are never sent to the agent.

| Command | Does |
| --- | --- |
| `/new` (or `/clear`) | A new chat in this tab. While the agent works, kernl asks first. |
| `/tab` | A new tab: another session in the same folder. |
| `/close` | Close this tab (not the first). |
| `/conversations` (or `/resume`) | Open an earlier conversation. |
| `/agent` | Choose the agent. |
| `/model` | Choose the model. |
| `/mode` | Choose the permission mode. |
| `/connections` | Logins, keys, MCP servers, and plugins. |
| `/settings` | kernl's settings. |
| `/help` | This page. |

- The same `/` menu lists the agent's own commands (Claude Code's `/compact`, for example) or, for kernl's agent, your skills.
- When the agent has a command of the same name, `/<name>` goes to the agent and kernl's is `/kernl:<name>`.
- kernl's commands take nothing after them: `/new fix it` isn't sent, and a note says why.

More: [the panel](panel.md#in-the-panel).

## Sending

| Keys | What happens |
| --- | --- |
| Enter | Send. While the agent works, the message waits in a queue. |
| Shift+Enter | A new line. |
| Cmd+Enter (Ctrl+Enter) | Queue it for later. |
| Option+Cmd+Enter (Alt+Ctrl+Enter) | Send in a forked session: the conversation is copied and the message goes to the copy. |

- Resting the pointer on Send shows the same three choices.
- Click a queued message to edit it; it doesn't send while you edit.
- What you've typed but not sent comes back after a reload.

## Approvals and permission modes

- An approval card shows what the agent wants to do, with a diff for edits. Approve allows once.
- Shortcuts: Cmd/Ctrl+Y allows once, Cmd/Ctrl+Option/Alt+Y allows always (when the agent offers it), Cmd/Ctrl+Option/Alt+Z rejects.
- The mode chip (or `/mode`) switches between Ask before edits, Edit automatically, Plan mode, and the agent's other modes. For example, `/mode`, pick Plan mode, then ask how a large file could be split: the agent reads and answers with a plan, changing nothing.

More: [approvals](approvals.md), [permission modes](permission-modes.md).

## Undo and branches

- **Restore checkpoint** under your message puts the files back to before it, and lists them first, with Undo.
- **Fork from here** starts a new conversation with the history up to that turn.

## Tabs and workspaces

- **Tabs:** `+` above the conversation (or `/tab`) opens another session in the same folder. Each tab has its own conversation, agent, model, and queue, and keeps working while you look at another. `kernl.tabs.max` caps them (default 5).
- **Workspaces:** **New workspace** (the branch icon) makes a git worktree on its own branch, for work kept apart from your checkout. The workspace chip reviews, merges, or discards it.

Two tabs share a folder and can change the same files; use a workspace for separate work.

More: [the panel](panel.md#in-the-panel), [workspaces](workspaces.md).

## Earlier conversations

- `/conversations` (or the clock icon) lists this workspace's conversations, and each CLI agent's own sessions in this folder (for example ones started with `claude` in a terminal).
- `@` also finds conversations from every workspace and agent. A tagged one goes to the agent as text: an outline of every turn, the first request, and the newest turns. The agent can read any other turn with its `read_thread` tool.

For example, type `@` and part of a conversation's title, pick it (it becomes a chip), then ask:

```text
What did we decide about the release notes format?
```

More: [CLI agents](cli-agents.md#sessions-started-outside-kernl).

## Agents and models

- **kernl's own agent** works with Anthropic, OpenAI, Google, DeepSeek, an OpenAI-compatible server, or a custom provider. **Manage providers** in the `...` menu stores a key and tests it.
- **Claude Code, Codex, OpenCode** use your installed CLIs and their logins, or a key you store in kernl.
- The model and thinking chips (or `/model`) show the agent's own choices.

More: [model providers](providers.md), [CLI agents](cli-agents.md).

## Terminal and browser

- The agent can read your terminals (commands run since VS Code started, with their output) without asking.
- It runs commands in a visible "kernl" terminal, asking first.
- It uses VS Code's integrated browser: open a page, read it, click, and type, asking before each action.

```text
Why did my last command fail?
Open http://localhost:3000, sign in with the test account, and check the settings page loads
```

More: [terminal and browser](terminal-and-browser.md).

## Your setup

- `AGENTS.md` and `.kernl/rules/` give kernl's agent your project's instructions; `~/.kernl/AGENTS.md` gives your own.
- Skills (`.kernl/skills/`, `~/.kernl/skills/`) show in the `/` menu for kernl's agent.
- kernl's agent also uses Claude Code's, Codex's, and OpenCode's skills, commands, instructions, and MCP servers.
- **Show loaded sources** in the `...` menu lists what loaded, and what didn't and why.

More: [customisation files](customisation.md).

## When something needs you

- The `kernl` status bar item shows a warning and a count when a login, key, or MCP server needs you.
- **Show connections** (or `/connections`) lists each one, with a fix: Log in, Set key, Check now.

More: [connections](connections.md).
