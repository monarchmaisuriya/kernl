# kernl

A VS Code desktop extension: a coding agent (Deep Agents) that uses **your own model key** and works in
**VS Code's integrated terminal and integrated browser**. It can also drive your installed Claude Code, Codex, or OpenCode.
Every change it can make waits for your click, unless you pick a permission mode that allows it.

## Install (team, from VSIX)

Download `kernl-X.Y.Z.vsix` from the [latest release](https://github.com/pushowl/kernl/releases/latest), then:

```bash
code --install-extension kernl-X.Y.Z.vsix --force
```

Or build it yourself:

```bash
npm ci && npm run package
code --install-extension kernl.vsix
```

What changed in each version: [CHANGELOG.md](CHANGELOG.md).

Requires VS Code 1.140 or newer. The integrated-browser tools are verified on VS Code 1.142.

## First run

Open the **kernl** icon in the activity bar (or **Help > Welcome > Get started with kernl**).
Pick an agent with the agent chip in the message box:

- **kernl:** its own agent, with your model keys. **Manage providers** in the panel's `...` menu stores a key and tests it; the model chip picks the provider and model.
- **Claude Code, Codex, OpenCode:** your installed CLIs. **Agent logins** in the `...` menu shows whether each is ready; a ready agent can be used in the shown workspace right away, and any agent can log in in a terminal or use a stored key.

For Ollama or another OpenAI-compatible server, use provider `openai-compatible` and `kernl.baseUrl` (e.g. `http://localhost:11434/v1`).

## What kernl never does

- Edit, delete, run a command, use the browser, or call an MCP tool without asking, unless your approval rules or permission mode allow it. See [approvals](docs/guides/approvals.md) and [permission modes](docs/guides/permission-modes.md).
- Store keys in settings: they live only in VS Code SecretStorage and are scrubbed from logs and panel messages.
- Send traces: LangSmith tracing is forced off for every run.
- Let a repository's `.vscode/settings.json` loosen approvals, launch programs, or redirect your keys.

## Docs

- **Using kernl:** [the panel](docs/guides/panel.md), [permission modes](docs/guides/permission-modes.md), [model providers](docs/guides/providers.md), [approvals](docs/guides/approvals.md), [customisation files](docs/guides/customisation.md), [CLI agents](docs/guides/cli-agents.md), [workspaces](docs/guides/workspaces.md)
- **How it's built:** [architecture](docs/architecture/overview.md)
- **Working on kernl:** [building](docs/development/building.md), [testing](docs/development/testing.md), [upgrading](docs/development/upgrading.md), [releasing](docs/development/releasing.md)
- **Limits:** [known issues](docs/known-issues/README.md)
- **History:** [plans](docs/plans/) and [research](docs/research/); see the [docs index](docs/README.md)
