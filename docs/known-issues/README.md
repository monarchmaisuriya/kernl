# Known issues

Open limits, each with what happens, why, and what to do. Remove an entry when it's fixed.

## Not yet checked live

- **Claude's thinking in kernl's own agent.** kernl asks Anthropic for summarized thinking (`display: "summarized"`) when a reasoning effort is set. It's type-checked but hasn't run against a real Anthropic key, so the thinking block may stay empty. DeepSeek's reasoning and CLI agents' thinking are checked.
- **A stored Codex key.** Codex with its own login is checked against adapter 2.2.2. A stored `CODEX_API_KEY` isn't, and Codex may prefer its own login over it.
- **OpenCode and Codex calling kernl's tools.** Both get kernl's MCP server; the full path is checked with a test agent. OpenCode's `bash: deny` and Codex's MCP approval are taken from their documentation and source, not yet run live.

## Open in kernl

- **Tool image previews are kept until "Delete conversations".** Each image (up to 5 MB) is saved next to its conversation; cutting a conversation back or forking it doesn't remove its images, and there's no total size limit. Delete conversations clears them all.
- **A conversation reopened from history while one of its images is still being saved** could, in a window of milliseconds, be saved over by the older copy. Not seen in practice; noted from review.

## By design or upstream

- **Dragging from VS Code's Explorer into the panel does nothing (VS Code 1.140 and later).** VS Code's Electron upgrade in 1.140.0 broke Shift-drag from the Explorer into every extension webview, Claude Code's chat included ([microsoft/vscode#339036](https://github.com/microsoft/vscode/issues/339036), open). Before that, Shift was required (VS Code blocks plain drags into webviews). Until VS Code fixes it, use `@` in the composer, or right-click files in the Explorer and pick **Add to kernl chat**. Shift-drag from Finder still works.
- **Files dragged from Finder have no path in the panel.** Webviews can't see where a dropped file lives, so kernl attaches text files by their content, and names the rest (images, binary files, folders) in a message.

- **Codex keeps its own shell.** It has no setting to turn its shell off, so its commands run in its sandbox, not in the kernl terminal; kernl shows their output in a read-only terminal instead.
- **MCP servers that sign in with OAuth, or get headers from a program, aren't used by the kernl agent.** They're listed in **kernl: Show loaded sources** with the reason; use them in their own agent.
- **Claude Code plugin hooks and workflows don't run in the kernl agent.** They need Claude Code's runtime; workflows run when you pick Claude Code.

- **Codex is experimental.** It's listed as "Codex (experimental)"; only its Read-only mode with its own login has been checked end to end.
- **Deny rules aren't a security boundary.** They match the command as written, so the same program run another way (inside a script, behind `env`) isn't caught. Such a command still asks, because only an allow rule can skip a card.
- **OpenCode's "Edit automatically" restarts OpenCode.** The edit permission is set through its launch config, so switching to or from that mode relaunches it and reloads the conversation.
- **Claude Code forks only its whole conversation.** "Fork from here" and "Send in a forked session" fork from the last message.
- **Restoring a checkpoint can't undo terminal side effects.** It puts files back; anything a command did outside the files (installs, databases, network calls) stays.
- **Claude Code with a stored key skips your personal settings.** It runs on its own config folder so your login isn't sent instead of the key; your `~/.claude` MCP servers, hooks, permissions, and CLAUDE.md don't load.
- **The integrated browser relies on an undocumented mechanism** (js-debug's `requestCDPProxy`). `npm run test:vscode` guards it; check it after every VS Code upgrade.
- **README links in the packaged extension need repository access.** They point at the private GitHub repository.
