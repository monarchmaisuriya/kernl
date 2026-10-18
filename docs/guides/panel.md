# The panel

- **Title bar:**
  - `+` starts a new chat in the workspace you're looking at;
  - the branch icon creates a workspace;
  - the clock icon lists the workspace's conversations, kept across restarts;
  - `...` holds Choose agent, Manage providers, Agent logins, and settings.
  - Every list (agent, model, workspace, attach, conversations, setup steps) opens in the panel next to the button that opened it, with a search box for long lists; Escape or a click outside closes it. From the Command Palette, with the panel hidden, VS Code's own list is used. Typed answers (keys, names) still use VS Code's input box.
- **Composer:**
  - `+` attaches Files & Folders, another Conversation, a GitHub Issue, or a Pull Request;
  - `@` autocompletes workspace paths; picked files and folders appear as highlighted `@path` mentions in your message (Backspace removes a whole mention);
  - the file open in the editor is offered as a dashed "+ file" suggestion;
  - `/` lists skills (kernl agent);
  - you can drop files on the panel, or use "Add to kernl chat" in the Explorer;
  - the agent chip warns when an agent still needs setup;
  - the model chip (kernl only) and one button that sends, or stops a running agent.

  Enter sends; Shift+Enter adds a line. The arrow next to Send opens three ways to send:
  - **Send** (Enter). While the agent is working, the message waits in a queue instead.
  - **Queue for later** (Cmd+Enter on macOS, Ctrl+Enter elsewhere). The message waits its turn.
  - **Send in a forked session** (Option+Cmd+Enter, or Alt+Ctrl+Enter). The conversation is forked at its last message and the message goes to the fork; the original stays in Conversations. This works when the agent is idle. Claude Code forks its whole conversation; an agent that can't fork says so, and your message and its attachments go back in the box.

  Queued messages show above the input, each with Remove. When a run finishes normally, the next one sends. After Stop, an error, or a change of conversation, the queue pauses: use **Send now** on a message to continue. Queued messages are kept with your conversations: after a window reload they come back paused, and Clear history removes them.
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
- **Slash commands:** "/" offers kernl's skills to its own agent, and a CLI agent's own commands to that agent.
- **Approvals:** Approve allows once. An agent's own "always" option shows in its words when it offers one, and is never the default. Shortcuts: ⌘/Ctrl+Y allows once, ⌘/Ctrl+⌥/Alt+Y allows always, ⌘/Ctrl+⌥/Alt+Z rejects. They don't fire while you're typing a message.
- **Accessibility:** screen readers hear "Reply finished" with the reply, approvals, and errors, not every streamed word; each turn has a heading. Animations stop with Reduce Motion, and high-contrast themes get borders.
- **Replies:** agent replies render as Markdown (code blocks with Copy, lists, tables, links). Only `http(s)` links are clickable and they open in your browser; images are never loaded; raw HTML in a reply shows as text. Your own messages, tool output, and approval cards stay plain text.
- **Footer:** the workspace chip (a dot means another workspace is running, or waiting for your approval) and the permission mode chip (below).
