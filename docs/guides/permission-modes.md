# Permission modes

The mode chip opens the modes the workspace's agent supports; each says what it means for that agent. The choice is kept per folder or worktree.

| Mode | kernl | Claude Code | Codex | OpenCode |
| --- | --- | --- | --- | --- |
| Ask before edits (default) | every edit, command, browser action, and MCP call asks | Manual | Read-only | edits, commands, fetches ask |
| Edit automatically | edits and new files in the folder don't ask (not `.env`-style files); commands and deletes ask | Accept edits | Workspace access | edits allowed (restarts OpenCode, reloading the conversation) |
| Plan mode | reads only and answers with a plan; every change is refused | Plan | Read-only + Plan | Plan agent |
| Auto mode | not offered | Auto | Auto review | not offered |
| Bypass permissions | not offered | Bypass permissions | Full access | not offered |

- **Applied at once:** CLI agents switch their live session, and the agent must confirm the new mode, or nothing runs.
- **Bypass asks first:** picking it asks for confirmation, and the chip turns amber while it's on.
- **kernl's own tools (terminal, browser, jobs) used by a CLI agent:** in Ask before edits, Edit automatically, and Plan mode they ask through kernl's card. In Auto mode the agent decides for them as for its own tools: kernl adds no card, and when the agent asks, its question is the card. In Bypass they don't ask. The change applies to the very next call, even mid-run.
- **Deny rules still win:** your approval rules' deny list applies in every kernl mode.
- **Restricted Mode:** the chip shows Read-only.
