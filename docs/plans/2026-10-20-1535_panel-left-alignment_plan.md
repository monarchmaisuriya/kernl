# Panel left alignment

- Date: 2026-10-20 15:35
- Status: done (window check pending)
- Repos: kernl   Files: `media/panel.css`, `test/unit/panelTheme.test.ts`, `CHANGELOG.md`
- Subagents: none
- Sign-off: M asked to "plan and implement" (2026-10-20, with a screenshot of the panel's left side).

## Context and problem

The panel's rows start at different distances from its left edge (the content area starts 12 px in) [verified: `media/panel.css`]:

| Row | First text or icon | Box edge | Rules |
| --- | --- | --- | --- |
| Tab strip | 28 px | 20 px (hover box and underline) | `.tabs` padding-left 8, `.tab-button` padding-left 8 |
| Message box text | 23 px | 12 px (border) | `.composer` border 1 + padding-left 10 |
| `+` (attach) | 27 px | | the text line + the button's border 1 and padding 3 |
| Footer chips | 21 px | | `.footer` padding-left 2 + chip border 1 and padding 6 |
| Plan bar | 23 px | 12 px | border 1 + summary padding-left 10 |
| Warning banner | 25 px | 12 px | border 1 + padding-left 12 |

M's screenshot shows the result: the tab title, the placeholder, the `+`, and the Develop chip each start at a different place.

## Goals / Non-goals

- **Goal:** two lines, each defined once.
  - **Edge line (12 px):** every box's left edge (the tab strip's first tab, the message box, the plan bar, the banner) and the transcript's text.
  - **Content line (12 + 10 = 22 px):** the first text or icon in those rows: the tab title, the message box's text and its `+`, the plan bar's icon, the banner's icon, and the footer's first chip icon.
- **Non-goal:**
  - the empty state, which stays centered (it's a placeholder, not a row);
  - your messages, which stay on the right;
  - the logo row above the panel, which VS Code draws.

## Design

- **The content line, defined once:** `:root` gains `--content-inset: 10px`. Each row derives its left padding from it, minus that row's own border or button padding:
  - `.tabs` padding-left 0; `.tab-button` padding-left `var(--content-inset)`;
  - `.composer` padding-left `calc(var(--content-inset) - 1px)` (border);
  - `.composer .attach` margin-left `-4px` (the button's border 1 and padding 3), so the `+` sits on the line with the text;
  - `.footer` padding-left `calc(var(--content-inset) - 7px)` (chip border 1 and padding 6);
  - `.plan-bar > summary` and `.banner` padding-left `calc(var(--content-inset) - 1px)`.
- **No layout or behavior changes** beyond these offsets; right-side paddings stay.

## Verification

- **Measured in a real browser:** the built panel (`out/webview/main.js` and `media/panel.css`) is loaded in a page with test messages. `getBoundingClientRect` must show the tab title, the input text, the `+` icon, the footer's first icon, and the plan bar's icon at the same x, and the boxes at the same x.
- **A unit test** (`panelTheme.test.ts`): each of these rules uses `--content-inset`, so a later edit can't silently move one row.
- Both suites, package, install, and a look at M's window after a reload.

## Risks

| Risk | Likelihood | Impact | Mitigation |
| --- | --- | --- | --- |
| The `+` button's hover background now starts 4 px left of the text line | Certain | Cosmetic | It still sits inside the message box's padding |
| Narrow panels lose 8 px of tab strip on the left | Low | A tab title clips earlier | The strip still scrolls |

## Changes made

- `:root --content-inset: 10px`. `.tabs`, `.tab-button`, `.composer`, `.composer .attach`, `.footer`, `.plan-bar > summary`, and `.banner` derive their left offsets from it.
- Measured in a browser, with the built panel and test data [verified: `getBoundingClientRect`]:

  | Element | Before (px) | After (px) |
  | --- | --- | --- |
  | Tab box | 20 | 12 |
  | Tab title | 28 | 22 |
  | Message box | 12 | 12 |
  | Input text | 23 | 22 |
  | `+` icon | 27 | 22 |
  | Footer's first icon | 21 | 22 |
  | Plan bar | 12 | 12 |
  | Plan icon | 23 | 22 |
  | Reply text | 12 | 12 |

- `panelTheme.test.ts` checks the rules use the variable.
