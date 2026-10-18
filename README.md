# YourStack

A VS Code desktop extension: a coding agent (Deep Agents) that uses **your own model key** and works in
**VS Code's integrated terminal and integrated browser**. Every change it can make waits for your click.

## Install (team, from VSIX)

```bash
npm ci && npm run package
code --install-extension yourstack.vsix
```

Then open the **YourStack** icon in the activity bar (or **Help > Welcome > Get started with YourStack**).
Pick an agent with the agent chip in the message box:

- **YourStack:** its own agent, with your model keys. **Manage providers** in the panel's `...` menu stores a key and tests it; the model chip picks the provider and model.
- **Claude Code, Codex, OpenCode:** your installed CLIs. **Agent logins** in the `...` menu shows whether each is ready; a ready agent can be used in the shown workspace right away, and any agent can log in in a terminal or use a stored key. For Ollama or another OpenAI-compatible server,
use provider `openai-compatible` and `yourstack.baseUrl` (e.g. `http://localhost:11434/v1`).

### The panel

- **Title bar:**
  - `+` starts a new chat in the workspace you're looking at;
  - the branch icon creates a workspace;
  - the clock icon lists the workspace's conversations, kept across restarts;
  - `...` holds Choose agent, Manage providers, Agent logins, and settings.
- **Composer:**
  - `+` attaches Files & Folders, another Conversation, a GitHub Issue, or a Pull Request;
  - `@` autocompletes workspace paths; picked files and folders appear as highlighted `@path` mentions in your message (Backspace removes a whole mention);
  - the file open in the editor is offered as a dashed "+ file" suggestion;
  - `/` lists skills (YourStack agent);
  - you can drop files on the panel, or use "Add to YourStack chat" in the Explorer;
  - the agent chip warns when an agent still needs setup;
  - the model chip (YourStack only) and one button that sends, or stops a running agent.

  Enter sends; Shift+Enter adds a line. The arrow next to Send opens three ways to send:
  - **Send** (Enter). While the agent is working, the message waits in a queue instead.
  - **Queue for later** (Cmd+Enter on macOS, Ctrl+Enter elsewhere). The message waits its turn.
  - **Send in a forked session** (Option+Cmd+Enter, or Alt+Ctrl+Enter). The conversation is forked at its last message and the message goes to the fork; the original stays in Conversations. This works when the agent is idle. Claude Code forks its whole conversation; an agent that can't fork says so, and your message and its attachments go back in the box.

  Queued messages show above the input, each with Remove. When a run finishes normally, the next one sends. After Stop, an error, or a change of conversation, the queue pauses: use **Send now** on a message to continue. Queued messages are kept with your conversations: after a window reload they come back paused, and Clear history removes them.
- **On your messages:**
  - **Restore checkpoint** puts the files back to before that message (YourStack can also rewind the conversation). It lists the files first and offers Undo; terminal side effects can't be undone.
  - **Fork from here** starts a new conversation with the history up to that point. Claude Code can fork only its whole conversation, from the last message.
- **Replies:** agent replies render as Markdown (code blocks with Copy, lists, tables, links). Only `http(s)` links are clickable and they open in your browser; images are never loaded; raw HTML in a reply shows as text. Your own messages, tool output, and approval cards stay plain text.
- **Footer:** the workspace chip (a dot means another workspace is running, or waiting for your approval) and the mode chip (hover for what the agent may do without asking).

### Model providers for Deep Agents

| `yourstack.provider` | Key | Notes |
| --- | --- | --- |
| `anthropic`, `openai`, `google` | Set API key | Set `yourstack.model`. |
| `deepseek` | Set API key | Empty `yourstack.model` uses `deepseek-flash`; `deepseek-v4-pro` also works. DeepSeek's thinking mode (on by default) rejects a forced tool choice; Deep Agents never forces one. |
| `openai-compatible` | Optional | One local or self-hosted server at `yourstack.baseUrl`. |
| `custom:<id>` | Set API key | Any number of OpenAI-compatible services (OpenRouter, Groq, a company gateway). Run **YourStack: Add custom provider**, or add `{ "id", "label", "baseUrl", "model" }` to `yourstack.customProviders`. The model must support tool calling; if it doesn't, the first tool call fails with the service's error. |

Keys are never stored in settings, only in SecretStorage. **YourStack: Clear stored keys** removes all of them, including CLI agent keys.

Requires VS Code 1.140 or newer. The integrated-browser tools are verified on VS Code 1.142.

## What asks for approval

| Action | Rule |
| --- | --- |
| Edit, create, overwrite, delete a file | Asks unless your approval rules say otherwise; edits and writes open a diff. Deletes go to the trash. Files with unsaved changes are refused. |
| Run a command | Asks unless an allow rule matches and the command has no shell operators (`; && \|\| \| \` $( > <`). Runs in the visible "YourStack" terminal. |
| Browser: navigate, click, type | Asks unless a rule says otherwise. Reading the page and screenshots do not. Page text is marked untrusted. |
| MCP tools (`yourstack.mcpServers`) | Every call asks unless a rule says otherwise. |
| Reading `.env*`, `*.pem`, `*.key`, `id_*` | Asks (contents would go to your model provider); grep never shows their lines. |
| Restricted Mode (untrusted workspace) | Read-only: no edits, commands, browser, MCP, or project AGENTS.md, rules, or agents. |

### Approval rules (Deep Agents)

Set these in your **user** settings: `yourstack.approvals.allow`, `yourstack.approvals.ask`, and `yourstack.approvals.deny`.

```json
"yourstack.approvals.allow": ["run(npm test *)", "run(git status)", "edit(docs/**)", "tool(browser_read_page)"],
"yourstack.approvals.ask": ["edit(src/migrations/**)"],
"yourstack.approvals.deny": ["run(rm *)", "delete(**)"]
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

### Settings a workspace can't change

These settings only take effect from your user settings, and are ignored in untrusted workspaces:

- `yourstack.approvals.*`
- `yourstack.commandAllowList` (deprecated; still honored as exact matches)
- `yourstack.customProviders` and `yourstack.baseUrl`
- `yourstack.mcpServers` and `yourstack.agentCommands`

A repository's `.vscode/settings.json` can't make YourStack run something without asking, launch a program, or send your keys elsewhere. If you had any of these in a workspace's settings, move them to your user settings; the workspace values are ignored, not deleted.

## Customisation files (Deep Agents)

| File | Who | Loads |
| --- | --- | --- |
| `~/.yourstack/AGENTS.md` | You | Always, in every workspace (also Restricted Mode) |
| `AGENTS.md` (project root) | The project | Trusted workspaces |
| `.yourstack/rules/*.md` | The project | Trusted workspaces; see frontmatter below |
| `~/.yourstack/agents/*.md`, `.yourstack/agents/*.md` | You, the project | Named agents; project agents load in trusted workspaces only, and win on the same name |
| `~/.claude/agents/*.md`, `.claude/agents/*.md` | You, the project | Claude Code subagents, translated (`Bash` = run, `Edit`/`Write` = edit, `WebFetch` = browser, `mcp__*` = mcp; `model` and `permissionMode` are ignored); `.yourstack/` wins on the same name |
| `~/.claude/skills/`, `~/.yourstack/skills/`, `.claude/skills/`, `.yourstack/skills/` | You, the project | Agent Skills (`<name>/SKILL.md`); your folders are read-only to the agent |

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

**Named agents** appear in the agent picker as "YourStack: <name>", and the main YourStack agent can delegate to them.

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

### Built into the YourStack agent

- **Sequential thinking:** for complex tasks the agent can think in numbered steps it may revise or branch; each step shows as a thought row. The logic is adapted from the Model Context Protocol reference server "sequentialthinking" (MIT); no MCP server runs. Turn it off with `yourstack.sequentialThinking`.
- **Background jobs:** the agent can start long-running commands (dev servers, watchers) and keep working: `start_background_job` asks like any command (approval rules apply), and each job gets its own terminal ("YourStack job: <name>"). The agent can read a job's output and stop it; the footer's jobs chip shows and stops them; closing a job's terminal stops it. Jobs end when the workspace closes.
- **Subagents:** besides the general-purpose one, the agent can delegate to **explorer** (finds code; read-only) and **reviewer** (reads and runs checks; never edits), plus your named agents (a named agent replaces a built-in of the same name). A subagent's work shows in its own row; every action still asks.

### Model options

`yourstack.modelOptions` sets `temperature`, `maxOutputTokens`, and `reasoningEffort` (`low` | `medium` | `high`):

- OpenAI-style providers get reasoning effort.
- anthropic gets extended thinking (2048 / 8192 / 24576 tokens), which can't be combined with `temperature`.
- google gets a thinking level.
- deepseek doesn't take `reasoningEffort`.

Anything a provider can't take is named in the panel instead of being silently dropped.

API keys live only in VS Code SecretStorage and are scrubbed from logs and panel messages.
LangSmith tracing is forced off for every run, even if `LANGSMITH_TRACING` is set in your environment.

## CLI agents: Claude Code, Codex, OpenCode

Pick the agent per workspace from the dropdown in the panel (or `yourstack.harness` for the main folder).
They run your installed CLIs over the Agent Client Protocol (ACP) and use your existing logins:

| Agent | Launched as | Forced mode (verified before any prompt) |
| --- | --- | --- |
| Claude Code | `npx -y @agentclientprotocol/claude-agent-acp@0.93.0` with your `claude` | Manual: every edit and command asks |
| OpenCode | `opencode acp` | `OPENCODE_CONFIG_CONTENT` sets edit, bash, webfetch, external_directory to `ask` |
| Codex (experimental) | `npx -y @agentclientprotocol/codex-acp@2.2.2` | Read-only: edits and network ask; read-only commands run in its sandbox |

If the forced mode can't be confirmed, the agent refuses to run. Every permission request becomes an
approval card (with a diff when the agent sends one). Approve picks "allow once", never "always".
CLI agents perform approved actions themselves, and refuse to run in Restricted Mode. Override a
launch with `yourstack.agentCommands`; the ask settings still apply. Check on your machine with
`npm run probe:agents` (asks each agent to write a file, rejects it, checks nothing was written).

**API keys for CLI agents (optional).** Without one, each agent uses its own login. **YourStack: Set API key**
also lists "CLI agent: Claude Code" (`ANTHROPIC_API_KEY`) and "CLI agent: Codex" (`CODEX_API_KEY`).
**YourStack: Use DeepSeek for Claude Code** stores a DeepSeek key and points Claude Code at
`https://api.deepseek.com/anthropic`. The key goes only into that agent's process environment, and
storing or clearing it restarts only workspaces running that agent. OpenCode keeps providers in its own config.

- **Claude Code with a key runs on its own config folder** (`CLAUDE_CONFIG_DIR` in YourStack's extension storage).
  A logged-in Claude Code otherwise sends its login credential instead of the key, to whatever endpoint is set.
  In this mode your personal `~/.claude` settings (user MCP servers, hooks, permissions, personal CLAUDE.md) don't load.
  `npm run test:live` checks against a localhost server that only the stored key is sent.
- **Codex keys are unverified:** Codex with its own login was checked against adapter 2.2.2 (Read-only confirmed, a reply received); a stored `CODEX_API_KEY` wasn't tested, and Codex may prefer its own login over it.

## Folders and multi-root windows

A window with one folder has one workspace, "Main". In a multi-root window (a `.code-workspace` with several folders), each local folder is its own workspace in the footer's workspace chip, named after the folder:
- the panel starts on the folder of the file you're editing;
- each folder remembers its own agent (`yourstack.harness` is only the default);
- skills and project agents come from the folder you're looking at;
- new worktree workspaces come from that folder's repository (shown as `folder/name`).

With no folder open (or only remote folders), the panel says so and offers **Open Folder**.

## Workspaces (Conductor-style)

**New workspace** (title bar, or the workspace chip's menu) creates a git worktree on a new branch `yourstack/<name>` from your current branch, stored
in the extension's storage (outside your repo). Each workspace has its own agent, transcript, and
terminal, and several can run at once. From the workspace chip's menu, **Review** shows each changed file against the base,
**Merge** commits the workspace's pending work and merges into the base (your main checkout must be
on that branch and clean; conflicts are aborted), and **Discard** deletes the worktree and branch. Both ask first.

## How it is built

```
panel (webview) -> AgentSession (stream, Stop) -> Deep Agents loop
                                                    |-- CompositeBackend
                                                    |     |-- scratch paths -> memory
                                                    |     `-- GatedBackend: write/edit/delete/uploadFiles/execute -> gate
                                                    `-- custom tools (browser, MCP) via gatedTool() -> gate
gate = src/gate/approvalGate.ts (the one place allow/deny is decided)
```

- `src/backend/` workspace backend, edit application (one function for preview and write), path checks
- `src/terminal/` shell-integration runner, output cleanup
- `src/browser/` integrated browser over CDP (`editor-browser` debug session + js-debug `requestCDPProxy`)
- `src/mcp/` MCP servers, every tool gated
- `src/agent/` agent assembly, streaming session, tracing-off config, the shared `Runner` contract
- `src/acp/` ACP runner for CLI agents, agent catalog (launch + forced ask mode), permission mapping
- `src/workspaces/` git worktrees: create, list, review, merge, discard
- `src/workspaceRuntime.ts` one runtime per workspace (harness, runner, approvals, terminal)

## Tests

```bash
npm run test:unit      # gate, backend contract, session/Stop, MCP, tracing on/off, panel click-through (jsdom)
npm run test:vscode    # real VS Code: editor edits + Undo, terminal, Stop, integrated browser, CLI agents, real panel round trips
npm run smoke          # real models with your keys (see test/smoke.ts for env vars)
npm run probe:agents   # installed CLI agents: rejected write must not happen (tiny prompt each)
npm run test:live      # installed CLI agents through the real controller: approve, follow-up, reject, Stop;
                       # Claude Code with a stored key must send only that key (localhost capture);
                       # DeepSeek checks need DEEPSEEK_API_KEY
```

## Upgrading Deep Agents, LangChain, or VS Code

Versions are pinned. Before changing any of them:

```bash
npm run check:upgrade && npm run test:vscode
```

`check:upgrade` runs the backend contract tests and fails if `FilesystemBackend` gains a method that
`GatedBackend` does not classify, so a new write path cannot skip the gate. `test:vscode` guards the
undocumented `requestCDPProxy` browser mechanism and shell integration.
