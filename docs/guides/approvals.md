# What asks for approval

| Action | Rule |
| --- | --- |
| Edit, create, overwrite, delete a file | Asks unless your approval rules say otherwise; edits and writes open a diff. Deletes go to the trash. Files with unsaved changes are refused. |
| Run a command | Asks unless an allow rule matches and the command has no shell operators (`; && \|\| \| \` $( > <`). Runs in the visible "kernl" terminal. |
| Browser: navigate, click, type | Asks unless a rule says otherwise. Reading the page and screenshots do not. Page text is marked untrusted. |
| MCP tools (`kernl.mcpServers`) | Every call asks unless a rule says otherwise. |
| Reading `.env*`, `*.pem`, `*.key`, `id_*` | Asks (contents would go to your model provider); grep never shows their lines. |
| Restricted Mode (untrusted workspace) | Read-only: no edits, commands, browser, MCP, or project AGENTS.md, rules, or agents. |

## Approval rules (Deep Agents)

Set these in your **user** settings: `kernl.approvals.allow`, `kernl.approvals.ask`, and `kernl.approvals.deny`.

```json
"kernl.approvals.allow": ["run(npm test *)", "run(git status)", "edit(docs/**)", "tool(browser_read_page)"],
"kernl.approvals.ask": ["edit(src/migrations/**)"],
"kernl.approvals.deny": ["run(rm *)", "delete(**)"]
```

- **Rule kinds:**
  - `run(command)`: `*` is any text, and a trailing ` *` also matches the bare command;
  - `edit(glob)`: edits and new files;
  - `delete(glob)`;
  - `read(glob)`: only sensitive files ask to be read;
  - `tool(name)`: browser and MCP tools.
- **Globs** are relative to the workspace: `**` spans folders, `*` stays within one.
- **Order:** deny, then ask, then allow; the first match wins, and no match asks.
- **Shell operators:** an allow rule never matches a command with shell operators, so `npm test && rm x` still asks.
- **Deny is not a security boundary:** it matches the command as written, so the same program run another way (inside a script, behind `env`) isn't caught. Such a command still asks, because only an allow rule can skip a card.
- **Bad rules:** a malformed rule is skipped with a warning naming it. Skipping can only lead to a card.
- **CLI agents:** rules don't apply to Claude Code, OpenCode, or Codex; they ask through their own permission systems.

## Settings a workspace can't change

These settings only take effect from your user settings, and are ignored in untrusted workspaces:

- `kernl.approvals.*`
- `kernl.commandAllowList` (deprecated; still honored as exact matches)
- `kernl.customProviders` and `kernl.baseUrl`
- `kernl.mcpServers` and `kernl.agentCommands`

A repository's `.vscode/settings.json` can't make kernl run something without asking, launch a program, or send your keys elsewhere. If you had any of these in a workspace's settings, move them to your user settings; the workspace values are ignored, not deleted.
