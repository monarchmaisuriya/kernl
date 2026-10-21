# The panel

## kernl from anywhere

| Where | What |
| --- | --- |
| The kernl button in the editor toolbar (top right of an editor) | The kernl menu |
| `kernl` in the status bar | The same menu; it shows a warning and a count when the agents you're using need you (a login, a key) |
| `Ctrl+Alt+K` | Open kernl |
| `Ctrl+Alt+Shift+K` | Ask kernl…: type a request; it goes to the workspace the panel shows (queued if the agent is working). kernl's own commands (`/new`, `/tab`…) run there too |
| `@kernl` in VS Code's chat | Sends the request, and files it references, to the kernl panel; the work and approvals happen there. `@kernl /` lists kernl's own commands, and `@kernl /new` runs one |

**The kernl menu:**
- Open kernl, Ask kernl…, and Ask kernl about this file or selection (attaches the file, or the selected lines, to the message box);
- New chat, New workspace, Conversations;
- Choose agent, Agent logins, Show connections, settings, and kernl help.

**`kernl.replaceChatButton`** hides VS Code's chat button in the Command Center so kernl's takes its role. It does this by setting VS Code's `chat.agentsControl.enabled` to `hidden` in your user settings; turning the option off puts back what was there, unless you've changed it yourself since.

- **Where kernl's button goes:** VS Code doesn't let extensions place a button in the Command Center itself, so kernl's is the one in the editor toolbar right below it.
- **With the Command Center turned off:** VS Code shows a different chat button, which only its "hide AI features" switch removes, so kernl leaves it.

`kernl.statusBar.show` hides the status bar item.

## In the panel

- **Tabs:** the row above the conversation, framed by a line above and below, shows the workspace's tabs as cells divided by lines, each named by its conversation. The shown tab's name is in full-strength text. Each tab leads with its state: a spinner while it works, a warning dot while it waits for your approval, and an accent dot when it finished while you looked at another tab (until you show it). On hover or keyboard focus, × appears at its end. When the tabs don't fit, the strip scrolls sideways (the wheel works), with `+` always in view.
  - `+` opens a tab: another session in the same folder, with its own conversation, agent, model, mode, and queue. It keeps working while you look at another tab.
  - Mouse: middle-click closes a tab; double-click on the strip's empty space opens one. Keyboard: the shown tab is the strip's one Tab stop; Left and Right (Home, End) show another, and Delete closes it.
  - While kernl's panel has focus: Cmd+T (Ctrl+T) opens a tab, Cmd+W (Ctrl+W) closes the shown one (on the workspace's last tab it does nothing, rather than close your editor), and Ctrl+Tab and Ctrl+Shift+Tab show the next and previous tab.
  - `×` closes any tab while the workspace has two or more, the first one too (a working one asks first); its conversation stays in Conversations. The last tab stays, so a workspace always has one. A closed first tab stays closed after a reload.
  - `kernl.tabs.max` (default 5; `0` for no limit) caps the tabs per workspace. At the limit, a new tab opens and the one shown longest ago that isn't working closes (the first tab too).
  - Tabs come back after a reload; each opens its conversation when you first show it.
  - Tabs share the folder: two tabs can change the same files, and kernl says so when you start one while another works. For separate work, use a worktree workspace.
- **Title bar:**
  - **One line:** VS Code draws this header, so kernl can't change it itself. With `workbench.activityBar.location` set to `top`, the kernl logo gets its own row above "Kernl: Agent". For the logo and the buttons on one line (no title text), set `workbench.activityBar.location` to `default` and `workbench.secondarySideBar.showLabels` to `false`; your main side bar's icons then sit in a strip on the left. To keep them on top instead, turn on `workbench.activityBar.autoHide`: the logo row goes, and "Kernl: Agent" stays with the buttons.
  - `+` starts a new chat in the workspace you're looking at;
  - the branch icon creates a workspace;
  - the clock icon opens the Conversations view in place of the conversation: New conversation, a search box, the workspace's conversations (kept across restarts) at once, then the CLI agents' own sessions in this folder as each agent answers, with "Looking for … sessions" until it does (see [CLI agents](cli-agents.md#sessions-started-outside-kernl)). Pick one to open it. While the agent works, picking one asks first, then stops the agent, waits for its turn to end (up to 15 s), and opens it. Back (or Escape) returns to the conversation;
  - the menu icon (three lines) holds Choose agent, Manage providers, Agent logins, settings, Show connections, and Show loaded sources.
  - Every list (agent, model, workspace, attach, conversations, setup steps) opens in the panel next to the button that opened it, with a search box for long lists; Escape or a click outside closes it. From the Command Palette, with the panel hidden, VS Code's own list is used. Typed answers (keys, names) still use VS Code's input box.
- **Composer:** the message box runs the panel's full width, framed by a line above and below; its text lines up with the conversation's.
  - `+` attaches Files & Folders, another Conversation, a GitHub Issue, or a Pull Request;
  - `@` autocompletes workspace paths; picked files and folders appear as highlighted `@path` mentions in your message (Backspace removes a whole mention);
  - `@` also finds conversations, from every workspace of the window and every agent (shown with the agent, workspace, and when it was last active), and the CLI agents' own sessions there that kernl hasn't opened ("Claude Code session"). A picked one shows as a chip. On Send, the agent gets that conversation as text, read at that moment (an agent's own session is read through the agent, once for the whole window until the agent reports it changed): a numbered outline of every turn, its first request, and its newest turns, up to 20,000 characters. The agent can read any other turn with its `read_thread` tool, by number or by words; it reads only conversations tagged in its own conversation. Any agent and model provider can read it, since every conversation is kept in one format;
  - the file open in the editor is offered as a dashed "+ file" suggestion;
  - `/` lists kernl's commands, then kernl's skills or the CLI agent's own commands (see Slash commands below);
  - right-click files or folders in the Explorer and pick **Add to kernl chat** (several at once with a multi-selection); a file from another folder of the window names that folder: switch to it with the workspace chip;
  - drag files onto the panel while holding **Shift** (VS Code blocks plain drags into extension panels; the composer shows "Drop to attach"). From VS Code's own Explorer this is broken in VS Code 1.140 and later (see known issues); from Finder it works, and text files are attached by their content (up to 20,000 characters). Anything that can't be attached says why;
  - the model and thinking chips: for kernl, the provider's model and how much it thinks ([providers](providers.md#choosing-a-model)); for a CLI agent, its own model, thinking level, and fast mode ([CLI agents](cli-agents.md#model-thinking-and-fast-mode));
  - Send, a plain icon button like `+`: dimmed with nothing to send, its arrow in the theme's button color once there's something to send, and a stop square while the agent runs.

  What you've typed (and attached) but not sent is kept for the window: it's back after a reload or a VS Code restart, until you send it or clear it. Long pasted text over 50,000 characters isn't kept.

  Enter sends; Shift+Enter adds a line. Resting the pointer on Send for a moment (or Arrow Up on the focused Send button) opens three ways to send:
  - **Send** (Enter). While the agent is working, the message waits in a queue instead.
  - **Queue for later** (Cmd+Enter on macOS, Ctrl+Enter elsewhere). The message waits its turn.
  - **Send in a forked session** (Option+Cmd+Enter, or Alt+Ctrl+Enter). The conversation is forked at its last message and the message goes to the fork; the original stays in Conversations. This works when the agent is idle. Claude Code forks its whole conversation; an agent that can't fork says so, and your message and its attachments go back in the box.

  Queued messages show above the input, each with Remove. Click a queued message to edit it: Enter saves, Shift+Enter adds a line, Escape cancels. While you edit it, it doesn't send. When a run finishes normally, the next one sends. After Stop, an error, or a change of conversation, the queue pauses: use **Send now** on a message to continue. Queued messages are kept with your conversations: after a window reload they come back paused, and Clear history removes them.
- **Under your messages:** Copy, Restore, and Fork. Under each finished reply: Copy and Fork. The newest turn's buttons always show; earlier ones show on hover or keyboard focus.
  - **Copy** copies your message, or the whole reply of that turn (every part between tool calls, as Markdown).
  - **Restore checkpoint** puts the files back to before that message (kernl can also rewind the conversation). It lists the files first and offers Undo; terminal side effects can't be undone.
  - **Fork from here** starts a new conversation with the history up to and including that turn's reply; Fork under your message and under its reply do the same. CLI agents can fork only their whole conversation, so on earlier turns their Fork is dimmed and says why.
- **Working:** while the agent works, "Working" shimmers at the end of the transcript with how long the run has taken; "Waiting for your approval" when a card is waiting. It stays still with Reduce Motion.
- **Thinking:** when the agent thinks (Claude Code, Codex, OpenCode, and kernl's own agent with DeepSeek, or Claude with a reasoning effort set), "Thinking…" streams in place, then collapses to "Thought for 12s" and a preview; click to reopen. `kernl.thinkingDisplay` keeps it always collapsed or always open. What's shown is the model's own summary of its thinking.
- **Tool calls:**
  - One line each, updated in place as the call moves from waiting to running to done or failed: an icon for the kind of action, what it does in plain words ("Reading src/a.ts", "Running npm test"), and the time taken (not shown for instant calls). There are no tick marks: a running call's text shimmers, a finished one is plain, and a failed one reads "Failed: …" in red.
  - A command leads with the agent's own description when it gives one ("Find usages of useRewards"), then the command; a `cd` into the workspace folder is left out.
  - Reads and searches in a row fold into one line, "Explored 1 file, 4 searches" ("· 1 failed" in red when one failed); click it for the individual rows. A shell command counts when every part of it only reads or searches (`grep`, `rg`, `find`, `ls`, `cat`, `head`, `tail`, `wc`, `sed -n`, output thrown away at most); anything that could write a file or run a program stays its own line.
  - Long output shows its first and last 5 lines, with **Show all**; a failed call opens itself.
  - **Previews:** an image a call read or produced (a read PNG, a browser screenshot) shows as a thumbnail on its line and on its group's line, and larger with **Open** when you open the row. Images are kept with the conversation (PNG, JPEG, GIF, WebP up to 5 MB) and deleted with it.
  - A group of reads names its files as chips on its line; a click opens the file.
  - A fetched web page shows its site on the line and its address as a link inside; a web search shows how many results it found and lists them as links. Nothing is loaded from the web: no favicons or remote images.
  - An edit shows its size (+2 −1) and **View diff** (VS Code's diff editor).
  - Files the agent works on are links.
  - Click a row for its arguments and output.
- **Plan:** the agent's plan (or kernl's to-do list) is pinned above the input. It shows "Current: …" and how far along it is; click it for every step.
- **Context:** agents that report it get a ring in the footer showing how full the context window is. It turns yellow from 75%, orange from 90%, and red from 95%; hover for the numbers and cost.
- **Slash commands:** "/" lists kernl's own commands first, then kernl's skills (for its own agent) or the CLI agent's own commands, with what each command takes when the agent says (`/review [instructions]`). kernl's commands run at once, even while the agent works, and are never sent to the agent. Enter or a click runs one; Tab puts its name in the box. The list, and what happens when the agent has a command of the same name, are in [kernl help](help.md#kernls-commands). `/help` opens that page in VS Code's Markdown preview (also **kernl help** in the kernl menu and **kernl: Help** in the Command Palette).
- **Approvals:** Approve allows once. An agent's own "always" option shows in its words when it offers one, and is never the default. Shortcuts: ⌘/Ctrl+Y allows once, ⌘/Ctrl+⌥/Alt+Y allows always, ⌘/Ctrl+⌥/Alt+Z rejects. They don't fire while you're typing a message.
- **Accessibility:** screen readers hear "Reply finished" with the reply, approvals, and errors, not every streamed word; each turn has a heading. Animations stop with Reduce Motion, and high-contrast themes get borders.
- **Replies:** agent replies render as Markdown (code blocks with Copy, lists, tables, links). Only `http(s)` links are clickable and they open in your browser; images are never loaded; raw HTML in a reply shows as text. Your own messages, tool output, and approval cards stay plain text.
- **Colors:** one accent (your theme's button color) marks what's primary or in progress: Send, Approve, the working mark, running workspaces, the plan step in progress, the context ring, and waiting cards. Links use the link color; warnings, errors, and success use one color each, always with an icon or words. Everything follows your theme, including high contrast.
- **Footer:** the workspace chip (a dot means another workspace is running, or waiting for your approval), the agent chip (with a warning button when the agent still needs setup), and the permission mode chip (below).
