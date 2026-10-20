# Title bar: smaller icons and a menu icon

- Date: 2026-10-21 09:05
- Status: done
- Repos: kernl   Files: `package.json`, `media/title/*.svg` (new), `docs/guides/panel.md`, `CHANGELOG.md`
- Subagents: none
- Sign-off: M asked (2026-10-21, with a screenshot of the panel's title bar): "make the icons slightly smaller, and use a different icon for menu, implement, build, release, commit".

## Context and problem

kernl's panel title bar shows `+` (New chat), a branch (New workspace), and a clock (Conversations), then VS Code's "..." with kernl's other actions. M wants the icons slightly smaller and a different icon for the menu.

## What is true today

- The three icons are VS Code codicons (`$(add)`, `$(git-branch)`, `$(history)`), drawn by VS Code as 16 px glyphs in 22 px buttons, colored `rgb(204, 204, 204)` in Dark Modern [verified: `package.json` commands; measured in a test window]. An extension can't size a codicon.
- The "..." is VS Code's own overflow button ("Views and More Actions..."), shown because kernl puts six actions in non-navigation groups (`1_agent`, `3_settings`) [verified: `package.json` `view/title`; test window].
- kernl's panel already draws its own 16 px icons (`src/webview/icons.ts`), with smaller glyphs than codicons (its `+` spans 9.5 px).

## Design

- **Smaller icons:** kernl's own SVG files for New chat, New workspace, and Conversations, drawn with the panel's icon shapes on a 16 px grid (about 20% smaller glyphs than the codicons), with a light-theme and a dark-theme color. Colors come from VS Code's own title icons, measured in the default light and dark themes.
- **Menu:** the six actions move into a kernl submenu in the title bar (`kernl.panelMenu`), keeping their groups and order, with a three-line menu icon.
- **Tradeoff:** icon files have fixed colors per light or dark theme; codicons follow every theme's icon color. A theme with a very different icon color shows kernl's icons in the default color.
- **Checked:** VS Code no longer shows its own "..." once kernl's actions move out (real window, side bar).

## Acceptance criteria

- Given the panel, then `+`, branch, and clock are visibly smaller than VS Code's maximize and close icons, in the same color.
- Given the panel, then the menu button shows the three-line icon and lists Choose agent, Manage providers, Agent logins, Open settings, Show connections, Show loaded sources.

## Parts

- [x] SVG files, `package.json`, guide, changelog; measure in a real window; unit tests and both suites.

## Changes made

- `media/title/`: New chat, New workspace, Conversations, and menu icons as SVG, light (#3B3B3B, Light Modern's title icon color) and dark (#CCCCCC, Dark Modern's), measured in a test window.
- `package.json`: the three commands use these icons; six actions moved into the `kernl.panelMenu` submenu ("More kernl actions", navigation@4), same groups and order.
- `test/unit/quickAccess.test.ts`: finds the editor toolbar's kernl submenu by its id, not by its position in the list (adding a submenu first broke it).
- Real window (Dark Modern): the icons draw at 16 px as images with smaller glyphs; VS Code's "..." is gone; the menu lists the six actions in order.
- Unit 413/413; single-folder 100/100; multi-root 7/7.

## Open questions

- None.
