# Composer: full width

- Date: 2026-10-20 17:45
- Status: done
- Repos: kernl   Files: `media/panel.css`, `test/unit/panelTheme.test.ts`, `docs/guides/panel.md`, `CHANGELOG.md`
- Subagents: none
- Sign-off: M asked (2026-10-20, with a screenshot): "instead of card, expand the sides to remove the padding or margin so it looks full width, just the composer, commit and release once done".

## Context and problem

The message box (composer) is a card: a rounded box with a border on all four sides, inside the panel's 12 px side margin [verified: `media/panel.css` `.composer`, before this change]. M wants it to run the panel's full width, like the tab row since the previous change.

## Design

- `.composer` reaches past the gutter with `margin: 0 calc(-1 * var(--gutter))`, the same way `.tab-bar` does.
- Only a top and a bottom line (`--input-border`, `--focus` while typing); no rounded corners. The `--surface` fill stays (M asked only to remove the card's sides).
- Padding grows by the gutter on both sides, so the text stays on the content line (22 px) and Send stays where it was (1 px further right, since the side border is gone).
- The Shift-drag outline is drawn inside the box (`outline-offset: -2px`), since outside it would be cut off by the panel's edges.
- Not changed: the footer, banners, plan bar, approval cards (M: "just the composer").

## Acceptance criteria

- Given the panel, then the message box spans from the panel's left edge to its right edge, with lines only above and below.
- Given an empty box, then the placeholder starts at 22 px, as before.

## Parts

- [x] Styles, test, guide, changelog; measured; checked in a real VS Code window.

## Changes made

- See Design. `panelTheme.test.ts` checks the full width, the content line, and that the box has no card border or radius.
