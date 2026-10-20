# Changelog

All notable changes to kernl are recorded here. The format follows [Keep a Changelog](https://keepachangelog.com/en/1.1.0/), and versions follow [Semantic Versioning](https://semver.org/spec/v2.0.0.html): before 1.0.0, a breaking change raises the minor version. Add a line under "Unreleased" with every change people will notice; see [releasing](docs/development/releasing.md).

## [Unreleased]

## [0.10.5] - 2026-10-20

### Fixed

- The integration suite's panel check no longer fails when the panel loaded before the check started, and the suite's timeline now shows when the panel loads (test-only; kernl behaves the same).

## [0.10.4] - 2026-10-20

### Changed

- The tab row is framed by a line above and below across the panel, and tabs are cells divided by lines on the panel's own background (no filled card). The shown tab is marked by full-strength text, and the first title lines up with the message box's text.
- The message box runs the panel's full width, framed by a line above and below (no rounded card); its text stays on the same line as before.

## [0.10.3] - 2026-10-20

### Fixed

- A short tab title (a lone "New chat") is centered in its pill, so the space on its two sides matches instead of 10 px before and 25 px after.

## [0.10.2] - 2026-10-20

### Changed

- Tabs with the same title are numbered in strip order ("New chat", "New chat 2"…), so empty tabs, or two that started with the same message, can be told apart.

### Fixed

- A CLI agent's session tagged again is read fresh when the agent gives it no time (kernl can't tell whether it changed); before, the first read was reused until VS Code restarted.
- After a frame in the page navigates, the browser tools refuse its old refs with "take a new browser_snapshot" instead of a raw browser error.

## [0.10.1] - 2026-10-20

### Changed

- Tabs lead with their state (spinner, waiting dot, finished dot), so it stays in view in a narrow panel, and pills shrink (the full title is in the tooltip) before the strip scrolls, so every tab is visible.

### Fixed

- Tabs could disappear after a window reload when the first tab had a queued message: kernl saved an empty tab list before reading the saved one.

## [0.10.0] - 2026-10-20

### Changed

- The tab strip is redesigned: compact pills with the full title (up to 200 px), the shown tab filled like the message box, and a state slot that shows a spinner while a tab works, a warning dot while it waits for you, and an accent dot when it finished while you were in another tab. × appears on hover or focus instead of hiding the state. The strip scrolls sideways when full, with `+` always in view. Middle-click closes a tab, double-click on empty space opens one, and the keyboard follows the tabs pattern (one Tab stop; arrows, Home, End; Delete closes).

## [0.9.1] - 2026-10-20

### Changed

- The panel's rows line up on the left: the tab title, the message box's text and `+`, the plan bar, and the footer chips start on one line, and the boxes (tabs, message box, plan bar) on another.

## [0.9.0] - 2026-10-20

### Added

- kernl's own commands also work in Ask kernl and in VS Code's chat: `@kernl /` lists them and `@kernl /new` runs one, replying what ran.
- The `/` menu shows what an agent's command takes when the agent says (`/review [instructions]`).
- Tab shortcuts while kernl's panel has focus: Cmd+T (Ctrl+T) new tab, Cmd+W (Ctrl+W) close the shown tab, Ctrl+Tab and Ctrl+Shift+Tab next and previous tab.
- The browser snapshot includes frames from the same site, and clicks, typing, and the covered check work inside them.

### Changed

- A CLI agent's own session tagged in several tabs is read once for the window, and again only after the agent reports it changed.

### Fixed

- Cmd+W in kernl's panel no longer closes the editor next to it.
- A terminal selection or VS Code's own view of the last command no longer hands an agent the output of a command that names a credential file (`cat .env`).

## [0.8.1] - 2026-10-20

### Fixed

- Picking another conversation while a stored session was loading sent a message queued during the load, then stopped it in the conversation being left. It now stays queued, waiting for Send now.
- When the agent doesn't end its turn within 15 s of Stop, the message now says the conversation wasn't opened and to pick it again once the agent has stopped.

## [0.8.0] - 2026-10-20

### Changed

- Conversations: picking another conversation while the agent works asks "Stop the agent and open this conversation?", then stops the agent, waits for its turn to end, and opens it. If the agent hasn't stopped within 15 s, kernl says so and opens nothing.

### Fixed

- Stop pressed while kernl was still starting the agent was ignored, and the message went to the agent anyway; now the turn ends as stopped.

## [0.7.1] - 2026-10-20

### Fixed

- Tab on one of kernl's commands in the `/` menu puts its name in the box instead of running it; Enter or a click runs it.
- Conversations: **New conversation** while the agent works asks first, like New chat; picking another conversation then says to stop the agent first instead of doing nothing.

## [0.7.0] - 2026-10-20

### Added

- kernl's own slash commands for every agent: `/new` (`/clear`), `/tab`, `/close`, `/conversations` (`/resume`), `/agent`, `/model`, `/mode`, `/connections`, `/settings`, `/help`. They run the panel action at once instead of sending. A command the agent offers keeps going to the agent; kernl's is then `/kernl:<name>`. See [the panel](docs/guides/panel.md).
- kernl help: `/help`, **kernl help** in the kernl menu, or **kernl: Help** opens [a tour of kernl with examples](docs/guides/help.md) in VS Code's Markdown preview. The user guides now ship with the extension, so its links open them there.

### Changed

- New chat asks first while the agent is working ("Stop the agent and start a new chat?"), like closing a working tab.

## [0.6.0] - 2026-10-20

### Added

- `read_thread`: an agent reads any part of a conversation tagged in its own conversation, by turn numbers or by words (kernl's agent and the CLI agents through kernl's tools). It doesn't ask; only tagged conversations can be read.
- `@` tags the CLI agents' own sessions too (those never opened in kernl), read through the agent when the message is sent.

### Changed

- A tagged conversation's text starts with a numbered outline of every turn, so a long thread's whole shape shows even when its middle is left out.
- Typing after `@` stays fast with many conversations: listing reads only conversations that changed since the last time.

## [0.5.0] - 2026-10-20

### Added

- Tag other conversations in a message: `@` lists conversations from every workspace of the window and every agent next to files, and **+ → Conversations...** does the same. A tagged conversation shows as a chip, and on Send the agent (any agent, any model provider) gets its first request and newest turns as text, up to 20,000 characters, saying how many turns were left out. See [the panel](docs/guides/panel.md).
- Tabs, like Cursor's: `+` in the strip above the conversation opens another session in the same folder (its own conversation, agent, model, and queue), working while you look at another. `kernl.tabs.max` (default 5) caps them; at the limit the tab shown longest ago that isn't working closes, and its conversation stays in Conversations. Tabs come back after a reload.
- Queued messages can be edited: click one, change it, and press Enter. It doesn't send while you edit it.
- **Conversations** is a view in place of the conversation, with Back (or Escape) and a search box, instead of a popup menu.

### Changed

- Send is a plain icon button like `+`: its arrow takes the theme's button color when there's something to send. The send options (Send, Queue for later, Send in a forked session) open when the pointer rests on Send, or with Arrow Up on it; the separate arrow is gone.
- An attached conversation keeps its newest turns instead of only its first 20,000 characters, and kernl's known secrets are removed from it.
- Conversations opens at once: the CLI agents' own sessions fill in as each agent answers, instead of the list waiting for every agent to start. How long each agent took is in kernl's log.
- The panel guide says how to put kernl's header on one line: the logo and buttons with no title (`workbench.activityBar.location: default`, `workbench.secondarySideBar.showLabels: false`), or the title and buttons (`workbench.activityBar.autoHide`).

### Fixed

- Merge refuses while any tab of a worktree workspace is working (it says so), and Discard stops all its tabs before removing the worktree.
- A queued message being edited is released if the panel reloads, instead of holding the queue.
- Clicking Conversations again while an agent is still listing its sessions reuses that request instead of starting the agent again.
- New workspace keeps the folder it started in, even if another folder is shown while it asks for the name and agent.

## [0.4.0] - 2026-10-19

### Added

- Agents can read your terminals: `terminal_list`, `terminal_read` (the commands run in any terminal since VS Code started, yours included, with output, folder, and exit code), and `terminal_selection`. Reading doesn't ask; kernl's known secrets are removed from the output. See [terminal and browser](docs/guides/terminal-and-browser.md).
- A command waiting for input (`[y/N]`, a password, "Press any key") comes back as "waiting for input" instead of hanging until the timeout; `terminal_send_input` answers it or stops it.
- Commands run in the kernl terminal without shell integration too (macOS and Linux), with output and exit code.
- `browser_snapshot`: the page as an outline with a ref for each button, link, and field. `browser_click` and `browser_type` take a ref and use real mouse and text input; `browser_press_key`, `browser_scroll`, and `browser_back` are new. Each action waits for the page to settle and reports the new page and any console errors or failed requests.
- Real clicks, keys, and typing are checked to reach the page. When kernl's tab isn't taking input, kernl brings it to the front, tries again, and puts your focus back in your editor or the kernl panel; only then does it use the page's script, and it says so.

### Changed

- kernl starts with VS Code (so terminal commands are recorded from the start).
- Browser approval cards name the element as the page has it, with the agent's description below.
- A command kernl stopped (Stop or timeout) is reported as stopped, not as a failure exit code.

### Fixed

- An approved browser click always hits the element shown on the card: an element keeps its ref across snapshots, and a ref is never reused for another element.
- kernl no longer clicks an element something else covers (a banner, a dialog): it says what covers it.
- `terminal_read` hides the output of a command that names a credential-like file (`cat .env`), as reading that file asks first.
- Commands kernl stops leave no script or output files behind (terminals without shell integration).
- kernl's browser no longer leaves tabs behind: a dropped connection reconnects to the same tab, and closing kernl's browser closes its tab. A tab you closed yourself no longer makes kernl's cleanup fail.

## [0.3.0] - 2026-10-19

### Added

- **kernl: Show connections**: every agent login, stored key, MCP server (claude.ai connectors included), and Claude Code plugin, with its state, what its source said, when it was checked, and a fix (Log in, Set key, Check now). Also in the panel's `...` menu, and as a warning button beside the agent chip.
- Statuses stay current: at startup, when you come back to VS Code, when a login file or key changes, every 60 s while the panel is visible (`kernl.connections.pollSeconds`), and at once when a run hits a login error, a refused key, or an MCP server that didn't start.
- Stored keys are checked with the provider's model list (`kernl.connections.checkKeys`); no tokens are spent.
- kernl from anywhere:
  - a kernl button in the editor toolbar and `kernl` in the status bar, both opening the kernl menu (Open kernl, Ask kernl…, Ask about this file or selection, New chat, New workspace, Conversations, Choose agent, Agent logins, Show connections, settings);
  - `Ctrl+Alt+K` opens kernl, and `Ctrl+Alt+Shift+K` asks kernl;
  - `@kernl` in VS Code's chat sends the request to the kernl panel.
- `kernl.replaceChatButton`: hide VS Code's chat button in the Command Center in favor of kernl's (reversible).
- Custom providers speak the OpenAI or the Anthropic API (`protocol`) and send your headers (`headers`); secret header values (`secretHeaders`) stay in SecretStorage, and a provider with one needs no API key.
- The model chip lists the provider's own models; type an id when it has no list.
- A thinking chip for kernl's agent, and `kernl.modelProfiles` for options per model, including its context window (kernl compacts at 85% of it).
- Claude Code's, Codex's, and OpenCode's own model, thinking, and fast-mode switches as chips, remembered per folder and agent. The shown workspace's agent starts its session as soon as it's shown, so you can choose them before the first message.
- Conversations lists the CLI agents' own sessions for the folder (started in a terminal or another app); opening one shows its history and continues it (`kernl.sessions.importFromAgents`).
- Reopening a kernl conversation with a CLI agent shows the turns added to its session elsewhere since, below kernl's own.
- Unsent messages (and their attachments) are kept for the window and come back after a reload or restart.
- kernl's browser actions read in plain words: "Open developers.brevo.com in kernl's browser" on cards, "Browser: open developers.brevo.com" on rows.

### Changed

- Agent logins are checked the way kernl launches each agent (its binary and environment). Claude Code's expired login now reads "Login expired" instead of "not logged in".
- Log in (Connections and Agent logins) runs the agent's own login command in a terminal and checks again every 5 s while it's open.
- One color system in the panel: the theme's button color marks everything primary or in progress (Send, Approve, the working mark, running workspaces, the plan step, the context ring, waiting cards); links, warnings, errors, and success each have one color.
- The agent chip moved to the bottom row (workspace, agent, mode); the chips have icons; Send and its options are one pill, off while the box is empty.

### Fixed

- An agent's status no longer flips to usable while it's being rechecked.
- A message sent while a CLI agent's login is being rechecked (after a login, key, or setting change) waits for the answer, so an agent that can't start is stopped with the fix instead of starting and failing.
- Auto mode now applies to kernl's own tools too: a CLI agent in Auto calling kernl's terminal or browser no longer gets a kernl card on top of its own judgment.

## [0.2.0] - 2026-10-19

### Added

- kernl's own agent reuses your Claude Code, Codex, and OpenCode setup: skills, Claude Code commands (as skills), subagents, CLAUDE.md and `.claude/rules`, OpenCode instructions, MCP servers, and enabled Claude Code plugins. Switch each kind in Settings > kernl > Sources. Project files load only in trusted workspaces, and a project's MCP server asks once before it first starts.
- **kernl: Show loaded sources** lists what loaded from where, and what didn't and why (OAuth servers, plugin hooks, Claude Code workflows), with names only, never a configured value.
- CLI agents use kernl's terminal, background jobs, and integrated browser through a local MCP server with kernl's approvals. With `kernl.terminal.cliAgents` set to `kernl` (the default), Claude Code's and OpenCode's commands run in the visible kernl terminal; Codex keeps its shell, and its command output shows in a read-only terminal and in the command's row.
- Settings in modules: Sources (one group per agent), MCP, Terminal, and Browser, including `kernl.mcp.toolTimeoutSeconds`, `kernl.terminal.outputLimit`, and `kernl.browser.timeoutSeconds`.
- `kernl.mcpServers` accepts `headers` for remote servers.
- Message actions: Copy, Restore, and Fork under your messages; Copy and Fork under replies.
- Previews in tool rows: thumbnails for images a tool reads or makes, file chips for grouped reads, and site chips for fetched pages and web search hits.
- The panel shows the agent's thinking, live tool calls, its plan, and a context usage ring.
- Permission modes per agent (Ask before edits, Edit automatically, Plan, Auto, Bypass), applied at kernl's gate or on the CLI agent's session and confirmed.
- Multi-root windows: each folder is its own workspace with its own agent.
- Read-only shell lookups (grep, rg, find, ls, cat, head, tail, wc, sed -n) fold into one "Explored" line.
- This changelog, versions, and `npm run release`.

### Changed

- The project is now kernl (it was YourStack): settings and commands are `kernl.*`, folders `~/.kernl` and `.kernl/`.
- Menus open next to the control that opened them, with search for long lists.
- Tool rows read as one plain line; failures read "Failed: ..." in red; a "Working" shimmer shows the elapsed time.
- Each MCP server connects on its own: one that fails or doesn't answer in time is a notice, and the others still load.
- Each folder and worktree gets its own named kernl terminal; agent commands run with no pager.

### Fixed

- Browser actions no longer wait forever on a page that doesn't answer, and the browser reconnects after its tab or connection drops without opening a second tab.
- A command with huge output no longer holds all of it in memory: only the end is kept while it streams.
- Saving a conversation reads it before anything else runs, so New Chat keeps the last state, and previews are saved into their own conversation.
- Writes of one conversation are serialized, so concurrent saves can't leave a half-written file.
- A late update from an agent no longer turns a finished tool row back into a running one.
- Drops on the panel read every format VS Code offers; text files from Finder attach by content; a drop that attaches nothing says why. (Dragging from VS Code's Explorer is broken upstream in VS Code 1.140 and later: use `@` or **Add to kernl chat**.)
- Long attachment names and command titles no longer break the composer or tool row layout.
- Restore points include files inside nested git repositories.

## [0.1.0] - 2026-10-18

### Added

- A VS Code chat panel running its own coding agent (LangChain Deep Agents) with your own model keys: Anthropic, OpenAI, Google, DeepSeek, OpenAI-compatible servers, and custom providers. Keys are kept in VS Code's SecretStorage.
- Claude Code, Codex, and OpenCode in the same panel over the Agent Client Protocol, using your existing logins.
- Every edit, command, browser action, and MCP tool call waits for your approval, with diffs for edits, and approval rules for what may skip a card.
- Commands run in VS Code's integrated terminal; browser tools drive VS Code's integrated browser.
- Workspaces on git worktrees, conversation history, queued messages, checkpoints with restore, and forking.
- `AGENTS.md`, `.kernl/rules`, named agents, and Agent Skills.

[Unreleased]: https://github.com/pushowl/kernl/compare/v0.10.5...HEAD
[0.10.5]: https://github.com/pushowl/kernl/compare/v0.10.4...v0.10.5
[0.10.4]: https://github.com/pushowl/kernl/compare/v0.10.3...v0.10.4
[0.10.3]: https://github.com/pushowl/kernl/compare/v0.10.2...v0.10.3
[0.10.2]: https://github.com/pushowl/kernl/compare/v0.10.1...v0.10.2
[0.10.1]: https://github.com/pushowl/kernl/compare/v0.10.0...v0.10.1
[0.10.0]: https://github.com/pushowl/kernl/compare/v0.9.1...v0.10.0
[0.9.1]: https://github.com/pushowl/kernl/compare/v0.9.0...v0.9.1
[0.9.0]: https://github.com/pushowl/kernl/compare/v0.8.1...v0.9.0
[0.8.1]: https://github.com/pushowl/kernl/compare/v0.8.0...v0.8.1
[0.8.0]: https://github.com/pushowl/kernl/compare/v0.7.1...v0.8.0
[0.7.1]: https://github.com/pushowl/kernl/compare/v0.7.0...v0.7.1
[0.7.0]: https://github.com/pushowl/kernl/compare/v0.6.0...v0.7.0
[0.6.0]: https://github.com/pushowl/kernl/compare/v0.5.0...v0.6.0
[0.5.0]: https://github.com/pushowl/kernl/compare/v0.4.0...v0.5.0
[0.4.0]: https://github.com/pushowl/kernl/compare/v0.3.0...v0.4.0
[0.3.0]: https://github.com/pushowl/kernl/compare/v0.2.0...v0.3.0
[0.2.0]: https://github.com/pushowl/kernl/compare/v0.1.0...v0.2.0
[0.1.0]: https://github.com/pushowl/kernl/releases/tag/v0.1.0
