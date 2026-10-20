# Built-in slash commands for kernl's panel

- Date: 2026-10-20 13:03
- Status: presented
- Mode: explore options
- Repos: kernl   Folders: `src/webview/`, `src/ui/`, `src/controller.ts`
- Question / problem: which slash commands should kernl's own panel offer, and how should they share the `/` menu with the agents' commands and skills?

## Options: give the `/` menu a small set of kernl's own panel actions that work with every agent and never take a command the agent offers

- **Bottom line:** add about nine kernl commands to the `/` menu. Each runs a panel action that already exists as a button (new chat, new tab, Conversations, agent, model, mode, and others). The panel recognizes them before sending, so they run at once and are never sent to the agent. When an agent offers a command with the same name, the agent's command wins, and kernl's stays reachable as `/kernl:<name>`.
- **Where we are:** framing done. Read kernl's composer and host code, the two ACP adapters kernl runs (Claude Code 0.93.0, Codex 2.2.2), and 5 outside sources. Next step is the plan.
- **Need from M:** pick an option (recommended: B).

### The problem, framed

- **What:** the `/` menu lists only skills (kernl's agent) or the agent's own commands (CLI agents). Panel actions such as New chat, Conversations, and Choose agent are buttons and title-bar icons only.
- **Why:** you can drive the panel from the keyboard without leaving the message box, the way Claude Code and Codex users already do (`/clear`, `/resume`, `/model`).
- **Who:** M, typing in kernl's message box.
- **Whom:** the panel. These commands control kernl, not the agent.
- **When:** any time, including while an agent is working.
- **Where:** the composer (`src/webview/main.ts`, `src/webview/attachments.ts`) and the host's message switch (`src/controller.ts`).
- **Which:** the existing `/` popover and the existing panel messages.
- **How:** type `/`, pick or type a command, press Enter. The action runs and the box clears.
- **How much:** small. One new webview module and two new panel messages; no new settings; no storage.

### What is true today

- **The `/` menu:** it opens only when the whole text before the caret is `/` plus letters (`SLASH_QUERY = /^\/([\w-]*)$/`). It lists kernl's skills for kernl's agent, or the agent's commands for a CLI agent. Picking a row inserts `/name ` [verified: `src/webview/attachments.ts:20,212-215`; `src/webview/main.ts:609-613`].
- **Sending:** text starting with `/` is sent to the agent like any other text. Nothing in the panel or host treats it differently [verified: `src/webview/main.ts:569-580`; no other `/` handling found in `src/`].
- **ACP commands:** an agent advertises commands with `available_commands_update` (name, description, optional `input.hint`). The client runs one by sending it as ordinary prompt text ("Commands are included as regular user messages in prompt requests") [verified: [ACP slash commands](https://agentclientprotocol.com/protocol/slash-commands)]. The spec says nothing about client-side commands or name clashes [verified: same page].
- **kernl keeps the name and description only and drops `input.hint`** [verified: `src/acp/acpRunner.ts:659-660`].
- **Claude Code over ACP doesn't offer `/clear`:**
  - the adapter's `UNSUPPORTED_COMMANDS` drops `clear`, `cost`, `login`, `logout`, `todos`, and a few others;
  - it also drops commands Claude Code marks as terminal-only

  [verified: `@agentclientprotocol/claude-agent-acp@0.93.0` `dist/acp-agent.js:9605-9655`].
- **Codex over ACP offers:** `plan`, `mcp`, `skills`, `status`, `review`, `review-branch`, `review-commit`, `compact`, `goal`, `rename`, `logout`. It has no new-chat command [verified: `@agentclientprotocol/codex-acp@2.2.2` `dist/index.js:38695-38820`].
- **So no agent kernl runs offers "start a new conversation" as a command.** The client has to provide it [inferred: from the two adapter lists above].
- **kernl's panel actions already exist as messages or buttons:**
  - from the panel: `newTab`, `closeTab`, `pickHarness`, `pickModel` / `pickAgentOption`, `showConnections`, `openSettings`, and the mode chip's menu;
  - New chat and Conversations are VS Code title-bar commands (`kernl.newChat` and `kernl.sessions`) with no panel message

  [verified: `src/ui/protocol.ts:257-326`; `src/webview/main.ts:190-197,649-652`; `src/controller.ts:986,1647`; `package.json:95-148`].

### How others do it

| Aspect | Claude Code (terminal) | Codex (CLI) | VS Code chat (Copilot) | Zed agent panel (ACP agents) |
| --- | --- | --- | --- | --- |
| New chat | `/clear` (aliases `/reset`, `/new`) | `/new` | `/clear` | panel button; Zed lists the agent's commands |
| Open past chats | `/resume` | `/resume` | history button | history button |
| Model | `/model` | `/model` | model picker | model picker |
| Custom vs built-in name clash | the user's skill replaces the built-in; aliases still reach it | not documented on the page read | not documented | not documented |
| Commands while the agent works | queued, except some (`/status`, `/usage`) that run at once | not documented | not documented | not documented |

Evidence:
- **Claude Code:** commands reference: `/clear` "Aliases: `/reset`, `/new`"; `/resume`; `/model`. "A command is only recognized at the start of your message". Queued while responding, with exceptions. A partial name filters the menu and alias matches count. A built-in replaced by a same-named skill stays reachable by its aliases [verified: [Claude Code commands](https://code.claude.com/docs/en/commands); [Claude Code skills and commands](https://code.claude.com/docs/en/slash-commands)].
- **Codex:** the CLI docs list `/new`, `/resume`, `/model` [unverified: the developer-commands page read lists only `/feedback`, `/goal`, `/init`, `/mcp`, `/plan`, `/review`, `/status`; check the [Codex slash commands reference](https://learn.chatgpt.com/docs/developer-commands?surface=cli) past 100,000 characters].
- **VS Code chat:** GitHub's chat cheat sheet: `/clear` starts a new chat session [verified: [GitHub Copilot chat cheat sheet](https://docs.github.com/ru/copilot/reference/chat-cheat-sheet)]. VS Code's own docs say only "Type `/` in the chat input to see all available commands" [verified: [VS Code chat docs](https://code.visualstudio.com/docs/copilot/chat/chat-ask-mode)].
- **Zed:** Zed says only some of Claude Code's built-in commands work in its panel, and custom commands are fully supported [verified: [Zed external agents](https://git.secluded.site/zed/blob/v0.208.1-pre/docs/src/ai/external-agents.md?raw=1), a mirror of Zed's docs; tertiary].

### What must be true

- **Hard constraints:**
  - a command the agent offers must keep reaching the agent; kernl can't take it silently [verified: ACP runs commands as prompt text, so a client that intercepts the text breaks the agent's command];
  - the agent's list changes during a session [verified: ACP "The Agent can update the list of available commands at any time"];
  - text like `/usr/bin/env is missing` must still go to the agent [inferred: today it does, and a path is not a command name].
- **Conventions:** commands match at the start of the message; aliases match in the menu; unavailable commands are left out of the menu (Claude Code's rules above).
- **Open checks:**
  - whether Claude Code over ACP offers `/model` or `/resume` (if it does, those names go to Claude Code under option B's rule) [unverified: open a Claude Code tab and type `/`];
  - `/new` while a run is in progress: the title bar's New chat saves the conversation, then stops the turn without asking (`newThread()` calls the runner's `newThread()`, which calls `stop()` for both kernl's agent and CLI agents) [verified: `src/workspaceRuntime.ts:588-596`, `src/agent/session.ts:221-222`, `src/acp/acpRunner.ts:233-234`]. Whether a typed `/new` should ask first is a decision for the plan.

### Options

| | A: panel commands go to the host as text | B: the panel recognizes kernl commands (recommended) | C: a separate prefix (for example `//new` or `>new`) |
| --- | --- | --- | --- |
| How it works | the host checks every sent message for a kernl command before the agent sees it | a webview module lists kernl's commands; the menu shows them beside the agent's; Enter runs the action at once instead of sending | kernl commands use another trigger character; `/` stays the agent's |
| Fits our code | the panel has already cleared the box and may have queued the message; mode and model menus live in the panel | reuses the chips' handlers and existing messages; two new messages (new chat, Conversations) | a second popover trigger |
| Clash with agent commands | needs the agent's list in the host (not kept today) | the panel has the agent's list per tab (`p.commands`) and kernl's skills; the agent wins; `/kernl:<name>` reaches kernl | none |
| Cost | medium | small | small |
| When it fails | `/new` typed while running is queued, so it runs after the turn; a bad command clears the box | Ask kernl and `@kernl` in VS Code chat don't get commands (they send text) | users from Claude Code and Codex type `/clear` and `/model` by habit, and it goes to the agent |
| Evidence | `src/webview/main.ts:569-580` | `src/webview/main.ts:609-652` | Claude Code, Codex, and VS Code all use `/` |
| Completeness | 6/10 | 9/10 | 5/10 |

### Flow of the recommended option

```
type "/"  ->  menu: kernl's commands + the agent's commands / skills   <-- kernl rows added
Enter on "/new"
   |
   +-- the agent offers "new"?  yes -> send as text (unchanged)
   |                            no  -> kernl command?  yes -> run the action now, clear the box   <-- new
   |                                                    no  -> send as text (unchanged)
   +-- "/kernl:new" -> always kernl's                                                          <-- new
```

### Recommendation

RECOMMENDATION: B, because the panel already holds both lists and every action's handler, so a command runs at once with no queueing, and an agent's own command is never taken from it.

### Sources

- [Agent Client Protocol: slash commands](https://agentclientprotocol.com/protocol/slash-commands) (primary)
- [Claude Code: commands reference](https://code.claude.com/docs/en/commands) (primary)
- [Claude Code: skills and commands](https://code.claude.com/docs/en/slash-commands) (primary)
- [Codex: developer commands](https://learn.chatgpt.com/docs/developer-commands?surface=cli) (primary, partly read)
- [GitHub Copilot chat cheat sheet](https://docs.github.com/ru/copilot/reference/chat-cheat-sheet) (primary)
- [VS Code chat docs](https://code.visualstudio.com/docs/copilot/chat/chat-ask-mode) (primary)
- [Zed external agents docs (mirror)](https://git.secluded.site/zed/blob/v0.208.1-pre/docs/src/ai/external-agents.md?raw=1) (tertiary)
- `@agentclientprotocol/claude-agent-acp@0.93.0` and `@agentclientprotocol/codex-acp@2.2.2`, read from the npx cache (primary: source code)

## Standardized review

- **Bottom line:** present as is (0 blocking, 1 must-verify, 2 notes).
- **Criteria:**
  - **Question and decision fit:** pass. Question, decision, and scope stated.
  - **Method:** pass. Code first, then the adapters kernl runs, then vendor docs.
  - **Source quality:** pass. The adapters' source settles what reaches kernl; docs show conventions.
  - **Coverage:** pass. Includes a do-it-in-the-host option and a separate-prefix option.
  - **Claim traceability:** pass. Each claim has a file, line, or link.
  - **Evidence handling:** pass. Codex's `/new` and `/model` are marked unverified.
  - **Analysis:** pass. Same criteria for all three options.
  - **System fit:** pass. Uses existing messages and handlers.
  - **Uncertainty:** pass. Open checks named.
  - **Recommendation:** pass. Follows from the clash and timing evidence.
  - **Reproducibility:** pass. Paths and versions given.
- **Findings:**
  1. **must-verify:** which of kernl's names Claude Code offers over ACP (`/model`, `/resume`). Under B these go to Claude Code, and kernl's version shows as `/kernl:model` [unverified: type `/` in a Claude Code tab].
  2. **note:** `/new` while running stops the turn without asking, like the title bar's New chat [verified: see What must be true]. The plan should decide whether a typed command asks first.
  3. **note:** the Codex comparison row is partly unverified (the page was read only up to 100,000 characters). It doesn't change the recommendation, which rests on what codex-acp sends.
