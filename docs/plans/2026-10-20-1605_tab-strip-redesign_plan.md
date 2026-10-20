# Tab strip redesign

- Date: 2026-10-20 16:05
- Status: done (window check pending)
- Repos: kernl   Files: `src/webview/tabs.ts`, `media/panel.css`, `src/webview/icons.ts` (if an icon is needed), `test/unit/webview.test.ts`, `test/unit/panelTheme.test.ts`, `docs/guides/panel.md`, `CHANGELOG.md`
- Subagents: none
- Sign-off: M asked to "research and plan and implement to improve UX and UI significantly" (2026-10-20, with a screenshot); the decisions below are taken on that authority and reported at the end.

## Context and problem

M doesn't like the tab strip. Measured in the built panel, with three tabs in a 420 px panel [verified: `getBoundingClientRect` in a browser]:

- **Titles truncate while there is room:** "Fix the lo…", "Ne…". Each tab is `flex: 0 1 auto` with a 180 px cap, and the strip shrinks every tab once the close button and dot are counted [verified: `media/panel.css` `.tab`].
- **The active tab shows × instead of its state:** the close button is always visible on the active tab, next to a dot squeezed by the title. A working tab isn't obviously working [verified: `.tab.active .tab-close { visibility: visible }`].
- **It looks like old browser tabs:**
  - a gray box on hover;
  - a 2 px accent underline on the active tab;
  - a full-width border line under the strip.

  The strip takes a 32 px row on its own [verified: measured].
- **States:**
  - running is a small dot;
  - waiting is a warning dot;
  - a tab that finished in the background while you looked elsewhere shows nothing.
- **Keyboard:** each tab is a separate stop for the Tab key; arrow keys do nothing [verified: `src/webview/tabs.ts`].

## Research

- **Cursor:**
  - chat tabs, created with Cmd+T and switched with Ctrl+Tab;
  - titles generated after the first message, and renameable;
  - a spinner on a generating tab, an orange dot when the chat needs input;
  - closed tabs kept in history

  [verified: [Cursor chat tabs](https://docs.cursor.com/agent/chat/tabs), [Cursor 3.0 changelog](https://cursor.com/changelog/3-0)].
- **VS Code chat:** a compact sessions list at the top of the Chat view [verified: [VS Code chat view](https://code.visualstudio.com/docs/agents/chat-view)].
- **Zed:** a threads sidebar and a Ctrl+Tab thread switcher; tabbed threads are still a request [verified: [Zed parallel agents](https://zed.dev/docs/ai/parallel-agents), [zed#42381](https://github.com/zed-industries/zed/discussions/42381)].
- **ARIA tabs pattern:**
  - one tab in the Tab order (roving `tabindex`);
  - Left and Right move between tabs, Home and End jump to the ends;
  - `aria-selected` on exactly one tab

  [verified: [summary of the APG tabs pattern](https://frontendchecklist.io/rules/accessibility/tabs-accessibility); secondary source].

## Goals / Non-goals

- **Goals:**
  - tabs that read clearly: full titles when there's room, a clear active tab, and state you can see at a glance (working, waiting for you, finished while you were away);
  - a lighter, shorter strip;
  - keyboard and mouse habits from browsers and editors.
- **Non-goals:** renaming tabs (needs a stored title), drag to reorder, and side-by-side chats. Each is a separate feature.

## Options considered

| | A: polished pill tabs (recommended) | B: one "chat switcher" pill with a menu | C: a vertical sessions list (VS Code style) |
| --- | --- | --- | --- |
| How | the same strip, redesigned: compact pills, a status slot, scroll with fades, keyboard | the current chat's title with a chevron; the menu lists open tabs with states, New tab, Conversations | a list of chats above the transcript |
| Parallel work visible at a glance | yes | no (behind a click) | yes, but it takes vertical space |
| Space | one compact row (about 26 px) | one compact row | several rows |
| Matches the tabs M asked for earlier (Cursor-like) | yes | partly | no |
| Completeness | 9/10 | 6/10 | 5/10 |

RECOMMENDATION: A, because it keeps what makes tabs useful (seeing every chat and its state at once) and fixes each measured problem.

## Design (A)

```
 [● Refactor the payment retry logic]  [◌ Fix the login loop]  [• New chat]  +
   active: filled pill                  working: spinner        waiting: dot
```

- **Look:**
  - pills about 24 px tall with `--radius-sm`;
  - the active pill filled with `--surface` (the message box's color) with a 1 px `--input-border` outline and `--fg` text (the list-selection color is a strong blue in many dark themes);
  - other pills in muted text, with `--hover` on hover;
  - no underline, and no full-width border (the transcript's own spacing separates it);
  - the strip row is about 28 px instead of 32.
- **Size:**
  - each pill fits its title up to 200 px and shrinks only when the strip is full (minimum 72 px);
  - past that the strip scrolls sideways, with a fade at a clipped edge;
  - the mouse wheel scrolls it sideways, and the shown tab scrolls into view.
- **Status slot:** a fixed 14 px slot at the pill's end, so widths don't jump.
  - **Working:** a small spinning ring (static with Reduce Motion).
  - **Waiting for you:** a warning dot.
  - **Finished while you were away:** an accent dot. It shows when a tab not shown stops running, and clears when you show it.
  - **Close:** on hover or keyboard focus, × replaces the status in the same slot (not on the workspace's first tab).
- **Mouse:**
  - click shows a tab;
  - middle-click closes it;
  - double-click on the empty part of the strip opens a new tab (as in browsers);
  - `+` sits right after the last tab, titled "New tab (⌘T)".
- **Keyboard:**
  - roving `tabindex`: the shown tab is the strip's single Tab stop;
  - Left and Right move and show the tab, Home and End jump to the ends;
  - Delete closes the focused tab (when it can close).
- **Accessibility:**
  - `role=tablist` and `tab`, with `aria-selected`;
  - each tab's label names its state ("Fix the login loop, working");
  - the close button gets its own label but isn't a separate Tab stop (Delete closes).
- **Ownership:** the "finished while away" state lives in the tab strip, which already sees every view each time it renders; no protocol change.

## Risks and mitigations

| Risk | Likelihood | Impact | Mitigation |
| --- | --- | --- | --- |
| Middle-click or Delete closes a working tab by accident | Low | A stopped run | Closing a working tab already asks first (the host's `closeTab`) |
| The spinner distracts | Low | Visual noise | Small, muted, and static with Reduce Motion |
| "Finished while away" lingers after a reload | Low | A stale dot | It's in-memory only: a reload starts clean |

## Acceptance criteria

- Given tabs whose titles fit in 200 px, then each shows in full; when they don't all fit the strip, it scrolls, with a fade at the clipped edge.
- Given a working tab that's shown, then its spinner shows; × appears only on hover or focus.
- Given a tab that finishes while another is shown, then it gets a dot; showing it clears the dot.
- Given focus on the strip, when M presses Right, then the next tab shows and has focus; Delete closes it (asking if it's working).
- Given a middle-click on a tab, then it closes; given a double-click on the strip's empty space, then a new tab opens.

## Verification

- The webview test rewritten for the new strip: states, keyboard, mouse, roving `tabindex`, "finished while away".
- Measured in a browser with the built panel: titles not truncated at 420 px, row height, and before/after screenshots.
- Both suites, package, install.

## Parts

- [x] Strip rewrite (`tabs.ts`), styles, tests, docs, changelog.

## Changes made

- `src/webview/tabs.ts` rewritten:
  - a bar holding the scrolling tablist, and `+` (always in view);
  - pills with a fixed state slot (spinner, waiting dot, "finished while away" dot);
  - × on hover or focus;
  - roving `tabindex` with arrows, Home, End, and Delete;
  - middle-click closes, and double-click on empty space opens a tab;
  - the wheel scrolls sideways, with edge fades.
- `media/panel.css`: the strip's rules replaced; `--mask-opaque` added for the edge fades.
- Measured in a browser (420 px, dark theme):
  - the strip row is 30 px (was 32), with no full-width border;
  - titles show in full up to 200 px (they were cut to "Fix the lo…" and "Ne…");
  - × shows only on hover or focus;
  - `+` stays in view while the tabs scroll.
- Found while measuring and fixed:
  - `.icon-button` overrode the close button's hiding;
  - `+` scrolled out of view inside the tablist;
  - pills shrank instead of scrolling.
- Deviations: the active pill uses `--surface` with an `--input-border` outline (not the list-selection color, a strong blue in many dark themes); the 0.9.1 alignment test now checks `.tab-bar`'s left padding.
- Tests: two webview tests (states and "finished while away"; keyboard and mouse); unit 411/411; suites 99/99 and 7/7.

## End-to-end check (2026-10-20, after 0.10.0)

Run in a real VS Code 1.142 window: a separate profile, the fake agent, driven over the DevTools protocol. No real agent and none of M's windows were involved.

- **Passed:**
  - `+` opens a tab, which becomes the shown tab and the only Tab stop; × is hidden until hover or focus;
  - a tab's saved queued message comes back;
  - a tab working while another is shown says "working", and "finished" after it ends; showing it clears the dot;
  - real key presses: Right shows the next tab and focus follows; Delete closes it.
- **Found and fixed:**
  - **a background tab's state was cut off** in the real sidebar (about 400 px), where the pill ran under the edge fade with its state at its end. Now the state leads the pill, pills shrink to 88 px before the strip scrolls, and only closable tabs reserve the × slot;
  - **tabs were lost on a reload when the first tab had a queued message.** Restoring the queue changed the workspaces during startup, which saved an empty tab list before `restoreTabs` read the saved one. Now `saveTabs` waits until the saved list has been read (`tabsRestored`, reset on `reloadWorkspaces`). A suite check reproduced it first (the tab didn't come back), then passed.
- The fake agent gained `FAKE_PROMPT_DELAY`, so a test can watch a turn that's working.
