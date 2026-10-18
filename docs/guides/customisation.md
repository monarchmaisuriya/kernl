# Customisation files (Deep Agents)

| File | Who | Loads |
| --- | --- | --- |
| `~/.kernl/AGENTS.md` | You | Always, in every workspace (also Restricted Mode) |
| `AGENTS.md` (project root) | The project | Trusted workspaces |
| `.kernl/rules/*.md` | The project | Trusted workspaces; see frontmatter below |
| `~/.kernl/agents/*.md`, `.kernl/agents/*.md` | You, the project | Named agents; project agents load in trusted workspaces only, and win on the same name |
| `~/.claude/agents/*.md`, `.claude/agents/*.md` | You, the project | Claude Code subagents, translated (`Bash` = run, `Edit`/`Write` = edit, `WebFetch` = browser, `mcp__*` = mcp; `model` and `permissionMode` are ignored); `.kernl/` wins on the same name |
| `~/.claude/skills/`, `~/.kernl/skills/`, `.claude/skills/`, `.kernl/skills/` | You, the project | Agent Skills (`<name>/SKILL.md`); your folders are read-only to the agent |

**Rule frontmatter:**

- `alwaysApply: true`: the rule is put in the prompt.
- `description:` and/or `globs:` (`src/api/**` or a list): the rule is listed, and the agent reads it before working on what it describes.
- No frontmatter: listed as "read when the user mentions it".

```markdown
---
description: How we write database migrations
globs: [db/**, migrations/*.sql]
---
Never drop a column in the same release that stops writing it.
```

**Named agents** appear in the agent picker as "kernl: <name>", and the main kernl agent can delegate to them.

- `tools` limits what the agent may call: any of `edit`, `run`, `browser`, `mcp`; default all; reading is always allowed. A missing tool is refused before anything is asked.
- `model` is a model id on your current provider.
- Every action still goes through approvals.

```markdown
---
description: Reviews the current changes and reports problems; never edits
tools: [run]
---
Review the diff (git diff), run the tests, and list concrete problems with file and line.
```

Files only add knowledge; they can't grant permissions. Editing them applies at the next message (the panel shows a notice).

## Built into the kernl agent

- **Sequential thinking:** for complex tasks the agent can think in numbered steps it may revise or branch; each step shows as a thought row. The logic is adapted from the Model Context Protocol reference server "sequentialthinking" (MIT); no MCP server runs. Turn it off with `kernl.sequentialThinking`.
- **Background jobs:** the agent can start long-running commands (dev servers, watchers) and keep working: `start_background_job` asks like any command (approval rules apply), and each job gets its own terminal ("kernl job: <name>"). The agent can read a job's output and stop it; the footer's jobs chip shows and stops them; closing a job's terminal stops it. Jobs end when the workspace closes.
- **Subagents:** besides the general-purpose one, the agent can delegate to **explorer** (finds code; read-only) and **reviewer** (reads and runs checks; never edits), plus your named agents (a named agent replaces a built-in of the same name). A subagent's work shows in its own row; every action still asks.
