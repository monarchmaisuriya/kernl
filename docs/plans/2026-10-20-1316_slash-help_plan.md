# /help: kernl explained, with examples

- Date: 2026-10-20 13:16
- Status: done (window check pending)
- Repos: kernl   Folders: `docs/guides/`, `src/webview/`, `src/`, `test/`   Files: new `docs/guides/help.md`, `.vscodeignore`, `package.json` (command `kernl.help`, kernl menu), `src/quickAccess.ts`, `src/extension.ts`, `src/controller.ts`, `src/ui/protocol.ts`, `src/webview/panelCommands.ts`, `src/webview/main.ts`, tests, `README.md`, `docs/guides/panel.md`, `CHANGELOG.md`
- Subagents: none

## Context and problem

M wants a `/help` command that explains everything in kernl and gives usage examples. kernl's user guides already explain each feature in depth: nine files, 527 lines in `docs/guides/` [verified: `wc -l docs/guides/*.md`]. Two gaps remain:

- **They don't ship with the extension.** The package has only `out/`, `media/`, `package.json`, `README.md`, and `CHANGELOG.md` [verified: `.vscodeignore`]. So nothing inside VS Code can open them.
- **There's no overview page.** No page lists what kernl can do with short "type this" examples [verified: guide headings].

## Goals / Non-goals

- **Goal:** `/help` (and a Help entry in the kernl menu and the Command Palette) opens a "kernl help" page.
  - The page covers every feature area in a few lines each, with a usage example per area. Examples: `@src/app.ts why does this throw?`, `/new`, Cmd+Enter to queue, "why did my last command fail?".
  - Each area links to its guide for the details.
- **Goal:** the guides ship with the extension, so the page's links open the full guide inside VS Code.
- **Goal:** the page's command table can't drift from the real commands. A test fails when a kernl command or alias is missing from it.
- **Non-goal:** listing the agent's own commands on the page. They change per agent and per session, and the `/` menu already lists them live. The page says so.
- **Non-goal:** rendering the guides inside kernl's panel (option C below).

## What is true today

- **Guides:** `docs/guides/{panel,cli-agents,workspaces,approvals,permission-modes,providers,customisation,terminal-and-browser,connections}.md`. Every relative link in them points to another file in the same folder (8 distinct links), so the folder works on its own once packaged [verified: `grep -ohE "\]\([^)]+\)" docs/guides/*.md`].
- **Panel commands:** nine, in `PANEL_COMMANDS`. A command runs a panel action or posts a host message [verified: `src/webview/panelCommands.ts`, `src/webview/main.ts` `runCommand`].
- **The kernl menu:** its items are listed in `QUICK_ACTIONS` and in `package.json`'s `kernl.menu` submenu [verified: `src/quickAccess.ts:7-18`, `package.json:667-671,757-759`].
- **Markdown in the panel:** replies render through `MarkdownView`. Only `http(s)` links are clickable there, by design [verified: `docs/guides/panel.md` "Replies"]. A relative link between guides wouldn't work in the panel without changing that safety rule.

## Options considered

| | A: hand-written Help view in the panel | B: a help page in VS Code's Markdown preview (recommended) | C: render the guides inside the panel |
| --- | --- | --- | --- |
| How | a full-panel view (like Conversations) with text written in a webview module | ship `docs/guides/`; `/help` opens a new `help.md` in VS Code's built-in Markdown preview; its links open the guides there | ship the guides; a panel view renders them, following links between them |
| One source of truth | no: a second copy of the guides that drifts | yes: the guides, plus one overview page linking into them | yes |
| Links and anchors | n/a | VS Code's preview follows relative links and `#headings` | needs in-panel link handling, which changes the panel's "http(s) links only" rule |
| Where it shows | in the panel | an editor tab next to your files | in the panel |
| Cost | medium (writing and keeping a copy in sync) | small | large (navigation, history, safety review) |
| Completeness | 6/10 | 9/10 | 8/10 |

RECOMMENDATION: B, because the guides are already the maintained explanation of everything, and VS Code's preview reads them with working links at almost no code cost.

## Decisions for M

- **D1, where help shows:** B (above).
- **D2, Help beyond `/help`:** also add **Help** to the kernl menu (editor toolbar button, status bar item) and to the Command Palette as "kernl: Help". Recommended: yes, because someone who doesn't know about `/` most needs a way in.

## Design

### The page (`docs/guides/help.md`, new)

One page, a short section per area. Each section has 2 to 4 lines on what it does, one or two "type this" examples, and a link to the guide:

1. **Start:** open kernl (`Ctrl+Alt+K`), pick an agent, connect it, send. Link: panel, connections.
2. **Talking to the agent:**
   - `@` files and folders, for example `@src/app.ts why does this throw?`;
   - `+` attachments; Add to kernl chat in the Explorer; Ask kernl about this file or selection.

   Link: panel.
3. **kernl's commands:** a table of `/new` (`/clear`), `/tab`, `/close`, `/conversations` (`/resume`), `/agent`, `/model`, `/mode`, `/connections`, `/settings`, `/help`.
   - The agent's own commands and skills are in the same `/` menu.
   - `/kernl:<name>` reaches kernl's when the agent has a command of that name.
4. **Sending:** Enter, Shift+Enter, queue (Cmd/Ctrl+Enter), send in a fork (Option/Alt+Cmd/Ctrl+Enter), editing a queued message.
5. **Approvals and modes:** the approval shortcuts and the mode chip. Links: approvals, permission modes.
6. **Undo and branches:** Restore checkpoint, Fork from here.
7. **Tabs and workspaces:** `/tab`, `kernl.tabs.max`, and worktree workspaces for separate work. Links: panel, workspaces.
8. **Earlier conversations:**
   - `/conversations`;
   - tagging with `@` (example: `@Add a changelog what did we decide?`);
   - the agent reading more with `read_thread`.
9. **Agents and models:** kernl's own agent (any provider, your key) or Claude Code, Codex, and OpenCode; the model and thinking chips. Links: providers, CLI agents.
10. **Terminal and browser:** examples "why did my last command fail?" and "open http://localhost:3000 and check the sign-in form". Link: terminal and browser.
11. **Your setup:** AGENTS.md, skills, MCP servers, and reuse of Claude Code's and the others' setup. Link: customisation.
12. **When something needs you:** the status bar count and the Connections view. Link: connections.

Every statement is taken from the guides, which are the source, and checked against them while writing. Where a guide and the code disagree, I stop and say so.

### Shipping the guides

`.vscodeignore` gains `!docs/guides/**`, adding about 30 KB [inferred: 527 lines of Markdown].

### Opening it

- **Host:**
  - `controller.showHelp()` runs VS Code's `markdown.showPreview` on `<extension>/docs/guides/help.md`;
  - the `kernl.help` command and the panel message `{ type: "showHelp" }` both call it.
- **If the preview fails** (for example, VS Code's Markdown extension is disabled), kernl shows an error naming the file's path rather than opening something else.
- **Panel:** `PANEL_COMMANDS` gains `{ name: "help", description: "How to use kernl, with examples" }`. `runCommand("help")` posts `showHelp`.
- **kernl menu (D2):** `QUICK_ACTIONS` and the `kernl.menu` submenu gain Help, last.

### Drift guards (tests)

- Every `PANEL_COMMANDS` name and alias appears as `/name` in `help.md`.
- Every relative link in `docs/guides/*.md` names a file that exists there, and its `#anchor` matches a heading in that file (VS Code's slug rule: lowercase, spaces to hyphens, punctuation removed).
- The packaged `.vsix` contains `docs/guides/help.md` (checked once at packaging with `unzip -l`).

## Risks and mitigations

| Risk | Likelihood | Impact | Mitigation | How we'd notice |
| --- | --- | --- | --- | --- |
| Claude Code offers its own `/help` | Medium | `/help` in a Claude Code tab goes to Claude Code | The clash rule: kernl's is `/kernl:help`, shown that way in the menu; the kernl menu entry always works | Window check |
| The help page drifts from the commands | Medium | Wrong help | Command-table test | Unit test |
| A guide link breaks once packaged | Low | A dead link in help | Link test | Unit test |
| Markdown preview disabled | Low | Help doesn't open | An error naming the file | User |

## Acceptance criteria

- Given kernl's agent, when M types `/help` and presses Enter, then VS Code opens the "kernl help" page as a preview, and nothing is sent to the agent.
- Given the help page, when M clicks "CLI agents", then the CLI agents guide opens in the preview.
- Given the kernl menu, when M picks Help, then the same page opens.
- Given a new kernl command added to `PANEL_COMMANDS` without a line in `help.md`, then the unit test fails.

## Rollout and rollback

- No settings. Revert the commit to undo. The package grows by the guides' size.

## Parts

### Part 1: page and packaging
- [x] `docs/guides/help.md`, `.vscodeignore`, the link and command-table tests. Done: tests pass; `unzip -l` shows the guides in the `.vsix`.

### Part 2: opening it
- [x] `showHelp`, `kernl.help`, the panel message, `/help`, the kernl menu entry. Done: a webview test (`/help` posts `showHelp`); a VS Code check (`kernl.help` opens a Markdown preview of `help.md`); `quickAccess` tests updated.

### Finish
- [x] README and panel guide links, changelog, both suites, package, install.

## Standardized review

- **Bottom line:** present as is (0 blocking, 1 must-verify, 1 note).
- **Criteria:**
  - **Goal fidelity:** pass. Explains everything (overview plus the full guides) with usage examples.
  - **Current-system accuracy:** pass. Tagged.
  - **Scope:** pass. No in-panel renderer and no agent command list, with reasons.
  - **Architecture:** pass.
    - The guides stay the single source; the page links into them.
    - Opening it lives in the host.
    - The command name lives in `PANEL_COMMANDS`.
  - **Sequencing:** pass.
  - **Completeness:** pass. Packaging, menu, docs, changelog.
  - **Failure and recovery:** pass. Preview disabled, a broken link, drift, a name clash.
  - **Verification:** pass. Drift tests fail on the real defects.
  - **Feasibility:** violation (finding 1).
  - **Decision readiness:** pass. D1 and D2.
- **Findings:**
  1. **must-verify:** whether Claude Code offers `/help` to kernl. If it does, `/help` in a Claude Code tab goes to Claude Code by the agreed clash rule, and kernl's is `/kernl:help` [unverified: type `/` in a Claude Code tab after the reload].
  2. **note:** the help opens in an editor tab, not inside the panel. That's the cost of B.

## Changes made

- Sign-off: M approved D1 B and D2 (2026-10-20).
- Part 1: `docs/guides/help.md` (twelve sections, each with examples and a guide link); `.vscodeignore` ships `docs/guides/`; `test/unit/helpPage.test.ts` (every command and alias on the page; every link between guides opens a shipped file at an existing heading; the guides are packaged). Both guards were checked to fail on a broken copy (a missing `/tab`, a wrong anchor).
- Part 2: `controller.showHelp()` (`markdown.showPreview`, an error naming the file if it fails); `kernl.help` command; `showHelp` panel message; `/help` in `PANEL_COMMANDS`; **kernl help** last in the kernl menu. Webview test and a VS Code check (both entry points open "Preview help.md").
- Found while writing: a typed `@path` attaches only when picked from the list, so the page's examples say to pick it.
- Docs: README links the help page; the panel guide's `/` line was out of date since the last change and now describes kernl's commands.

## Open questions

- D1 and D2 above.
