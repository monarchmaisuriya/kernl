# Customisation files (Deep Agents)

| File | Who | Loads |
| --- | --- | --- |
| `~/.kernl/AGENTS.md` | You | Always, in every workspace (also Restricted Mode) |
| `AGENTS.md` (project root) | The project | Trusted workspaces |
| `.kernl/rules/*.md` | The project | Trusted workspaces; see frontmatter below |
| `~/.kernl/agents/*.md`, `.kernl/agents/*.md` | You, the project | Named agents; project agents load in trusted workspaces only, and win on the same name |
| `~/.kernl/skills/`, `.kernl/skills/` | You, the project | Agent Skills (`<name>/SKILL.md`); your folders are read-only to the agent |

Claude Code's, Codex's, and OpenCode's own files load too: see [Reusing your other agents' setup](#reusing-your-other-agents-setup).

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

## Reusing your other agents' setup

kernl's own agent also uses what you set up for Claude Code, Codex, and OpenCode. Turn each kind on or off in **Settings > kernl > Sources** (all on by default). The CLI agents load their own setup themselves; this is for the kernl agent only.

| From | Read | Used as |
| --- | --- | --- |
| Claude Code | `~/.claude/skills/` (and claude.ai synced skills), `.claude/skills/` | Skills |
| Claude Code | `~/.claude/commands/`, `.claude/commands/` (`folder/name.md` is `/folder:name`) | Skills named after the command (`/git:commit` is `git-commit`) |
| Claude Code | `~/.claude/agents/`, `.claude/agents/` | Named agents, translated (`Bash` = run, `Edit`/`Write` = edit, `WebFetch` = browser, `mcp__*` = mcp; `model` and `permissionMode` are ignored); `.kernl/` wins on the same name |
| Claude Code | `~/.claude/CLAUDE.md`, `CLAUDE.md`, `.claude/CLAUDE.md`, `.claude/rules/*.md` | Instructions; a rule with `paths:` is listed like a kernl rule with globs, one without is in the prompt |
| Claude Code | `~/.claude.json` (yours, and yours for this project), `.mcp.json` | MCP servers |
| Claude Code | Enabled plugins | Their skills, commands, agents, and MCP servers |
| Codex | `~/.agents/skills/`, `.agents/skills/` | Skills |
| Codex | `~/.codex/config.toml`, `.codex/config.toml` (`[mcp_servers.*]`) | MCP servers |
| OpenCode | `~/.config/opencode/skills/`, `.opencode/skills/` | Skills |
| OpenCode | `opencode.json` / `opencode.jsonc` (`mcp`, `instructions`) | MCP servers, instructions |

- **Project files load only in trusted workspaces.** A project's MCP server (`.mcp.json`, `.codex/config.toml`, a project `opencode.json`) also asks once before it first starts; the answer is kept for that exact command or URL.
- **On the same name,** `kernl.mcpServers` wins, then Claude Code, then Codex, then OpenCode. Your `~/.kernl` and `.kernl` skills and agents win over the other agents'.
- **Not used, and listed with the reason:** MCP servers that sign in with OAuth (use them in their own agent), servers whose headers come from a program, servers turned off in their agent, plugin hooks, and OpenCode instruction globs.
- **Claude Code workflows** (`.claude/workflows/*.js`, plugins' `workflows/`) need Claude Code's runtime: they're listed as "run in Claude Code". Pick Claude Code in the panel and run them as `/name`.
- **kernl: Show loaded sources** (also in the panel's `...` menu) shows what loaded from where, and what didn't and why. It shows names and places only, never a header or environment value.

## MCP servers

`kernl.mcpServers` adds servers of your own: `{ "name": { "command": "...", "args": [], "env": {} } }` for a local program, or `{ "name": { "url": "https://...", "headers": {} } }` for a remote one. Each server connects on its own: one that fails or doesn't answer within `kernl.mcp.toolTimeoutSeconds` (60 s by default; also the limit for one tool call) is a notice in the panel, and the others still load. Every MCP tool call asks unless an approval rule says otherwise.
