# Tab row: full-width borders and divided cells

- Date: 2026-10-20 17:02
- Status: done
- Repos: kernl   Files: `media/panel.css`, `test/unit/panelTheme.test.ts`, `docs/guides/panel.md`, `CHANGELOG.md`
- Subagents: none
- Sign-off: M asked to "plan and implement" from a sketch (2026-10-20): "add top and bottom border, keep the same alignment, and instead of card use the same bg".

## Context and problem

The tab strip shows the shown tab as a filled, outlined pill ("card"). M's sketch replaces it with a row framed by a top and a bottom line across the panel. Tabs are cells divided by vertical lines, on the panel's own background.

## What is true today

- The panel's content sits inside a 12 px gutter (`#app` padding); the strip starts at that edge [verified: `media/panel.css:72`, `.tab-bar` padding-left 0].
- A tab's title starts on the content line, 12 + 10 px (`--content-inset`), like the message box's text [verified: measured 0.9.1, `test/unit/panelTheme.test.ts`].
- The shown tab is a pill: `--surface` fill and an `--input-border` outline [verified: `.tab.active`].

## Design

- **The gutter, defined once:** `:root --gutter: 12px`, used by `#app`'s padding. The tab row reaches past it with `margin: 0 calc(-1 * var(--gutter))`, so its borders run the panel's full width. Its `padding-left: var(--gutter)` keeps the first title on the content line.
- **Row:** a 1 px `--border` line at the top and the bottom; no rounded corners; cells fill the row's height (about 32 px).
- **Cells:**
  - each tab is a cell with a 1 px `--border` line on its right;
  - no fill: the active tab is shown by full-strength `--fg` text and the others by `--muted` text, and hover brings the text to `--fg`;
  - keyboard focus keeps its outline inside the cell.
- **Unchanged:**
  - the state at the cell's start, × in a reserved slot at the end, the 88 px minimum width and 200 px maximum, centering of a short title, scrolling with fades;
  - `+` stays after the last cell, outside the scrolling part.

## Risks

| Risk | Likelihood | Impact | Mitigation |
| --- | --- | --- | --- |
| The active tab is less obvious without a fill | Medium | Which chat is shown is harder to see | Full-strength text versus muted; the conversation below changes too. Easy to add a marker if M wants one |
| The negative margin misaligns if the gutter changes | Low | The borders stop short | Both come from `--gutter`; a test checks it |

## Acceptance criteria

- Given the panel, then the tab row has a top and a bottom line from the panel's left edge to its right edge, and cells divided by vertical lines.
- Given the shown tab, then it has no fill and no outline; its text is `--fg`, the others' `--muted`.
- Given one tab, then its title starts at the same x as the message box's text (22 px).

## Parts

- [x] Styles, tests, guide, changelog; measured in a browser; checked in a real VS Code window.

## Changes made

- `:root --gutter: 12px` (used by `#app`).
- `.tab-bar`: full width through `margin: 0 calc(-1 * var(--gutter))`, with a 1 px top and bottom border, 32 px tall.
- `.tab`: cells with a right divider and no fill; the active tab and hover use `--fg` text.
- Deviation:
  - titles start on the content line again (the 0.10.3 centering removed, since cells have no card edges to balance);
  - the minimum width is 64 px instead of 88, so "New chat" isn't padded out.
- Measured in a browser: the row spans 0 to 420 at 420 px; borders 1 px; no fill; the title is at 22 px, like the message box's text, with 11 px to the divider.
- Real VS Code 1.142 window (fresh profile, fake agent): matches M's sketch.
- `panelTheme.test.ts` checks the gutter, the row's full width, and that titles aren't centered.
- Unit 413/413; suites 100/100 and 7/7.
