# Terminal and browser

kernl's agent, and CLI agents through kernl's tools (see [CLI agents](cli-agents.md#terminal-and-browser)), can read your terminals, run commands in a visible "kernl" terminal, and use VS Code's integrated browser.

## Reading your terminals

kernl starts with VS Code and records every command run in the window's terminals, yours included: the command, its folder, its exit code, and its output (the last 30 commands per terminal).

| Tool | Asks? | What the agent gets |
| --- | --- | --- |
| `terminal_list` | no | Each terminal: name, shell, folder, whether shell integration is on, what's running, and the last command with its exit code |
| `terminal_read` | no | A terminal's last commands (default 5) with their output, by "active", its number, or its name |
| `terminal_selection` | no | The text you selected in the active terminal |

- **What can be read:** commands run since VS Code started, in terminals with shell integration (on by default for bash, zsh, fish, and PowerShell). VS Code has no way for an extension to read a terminal's screen, so output from before VS Code started can't be read.
- **VS Code's own view:** when VS Code's AI features are on, kernl also uses VS Code's terminal tools: the active terminal's last command as shown on screen (when kernl recorded nothing there), and your selection. Without them, `terminal_selection` says it isn't available.
- **Privacy:** reading changes nothing, so it doesn't ask, like reading a file. Output is marked as untrusted data for the agent, and kernl's known secrets (stored keys, secret header values) are removed from it before the agent sees it. A command that names a credential-like file (`cat .env`, a `.pem` or `.key` file) has its output hidden: reading that file directly asks you first. The same goes for VS Code's own view of the last command, and for your selection when it shares a line with such a command's output (or, with nothing recorded in that terminal, when VS Code's last command names such a file). Other secrets printed in a terminal are not removed.

## Running commands

`run_in_terminal` runs one command at a time in the workspace's "kernl" terminal, where you see it run. It asks first, unless your approval rules or permission mode allow it.

- **A command that waits for input** (a `[y/N]` question, a password prompt, "Press any key"): after 3 s of quiet with a question-like last line, the agent gets the output and "waiting for input", and the command keeps running. The agent answers with `terminal_send_input` (a line of text, or `ctrl-c` to stop it), which asks like a command. Until then, new commands wait.
- **Without shell integration**, commands still run: kernl runs them through a small script in the same terminal that saves the output and exit code (macOS and Linux). kernl says so once.
- **Stopped commands:** when kernl stops a command (Stop, or the 120 s timeout), the result says "stopped" or "timed out" rather than a failure exit code.

## Browser

The browser tools use VS Code's integrated browser tab.

| Tool | Asks? | What it does |
| --- | --- | --- |
| `browser_navigate` | yes | Opens a URL (http, https, or about:) |
| `browser_snapshot` | no | The page as an outline: headings, text, and every button, link, and field, each with a ref (`e1`, `e2`, ...) |
| `browser_click` | yes | Clicks an element by its ref (or a CSS selector) |
| `browser_type` | yes | Replaces a field's text, optionally pressing Enter |
| `browser_press_key` | yes | Presses Enter, Tab, Escape, an arrow, or one character |
| `browser_back` | yes | Goes back one page |
| `browser_scroll` | no | Scrolls about a screen up or down |
| `browser_read_page` | no | The page's URL, title, and visible text |
| `browser_screenshot` | no | A PNG of the page |

- **Refs, not guesses:** the snapshot comes from the page's accessibility tree (what a screen reader reads), so the agent acts on elements it saw instead of guessing selectors. An element keeps its ref in every snapshot of a page, and a ref is never given to another element, so an approved ref always means the approved element. After the page navigates, old refs are refused with "take a new browser_snapshot".
- **Covered elements aren't clicked:** if something sits over the element (a cookie banner, a dialog, a sticky bar), kernl doesn't click and says what covers it, so the agent can close it first.
- **Frames:** the snapshot also outlines the page's frames from the same site, under each frame's address, with refs like the page's; clicks, typing, and the covered check work inside them. A frame from another site runs in its own process: the snapshot names it and says kernl can't read inside it.
- **Like a person:** clicks are real mouse input at the element's center, typing is real text input, and keys are real key presses, so pages that track input (React forms included) see them. kernl checks that each one reached the page.
- **When kernl's tab isn't taking input:** VS Code can stop passing real input to a browser tab that isn't in front (seen after browser connections were restarted). kernl then brings its tab to the front (this takes keyboard focus), tries again, and puts your focus back in your editor or the kernl panel. Focus that was elsewhere (a terminal, another view) stays on kernl's tab: VS Code doesn't tell extensions where it was. If input still doesn't arrive, kernl uses the page's script instead. The tool result says which happened.
- **One tab:** kernl uses one browser tab. A dropped connection reconnects to it, closing it (or the kernl workspace) closes it, and if you close it, the next browser action opens a new one.
- **After each action** kernl waits for the page to load and its network to go quiet (up to 5 s), then reports the page's title and URL, and any console errors or failed requests since the last action.
- **Approval cards** name the element as the page has it, for example `Click button "Accept All Cookies" in kernl's browser`, with the agent's description and the ref below, so a card can't show one element while the agent clicks another.
- Page content is marked as untrusted data for the agent: text on a page can't run anything by itself.
