# A more attractive send control

- Date: 2026-10-19 15:00
- Status: built (window check left)
- Repos: kernl   Folders: `media/`, `src/webview/`, `test/unit/`   Files: `media/panel.css`, `src/webview/main.ts` (only if markup changes), `test/unit/webview.test.ts`
- Subagents: none

## Context and problem

M doesn't like the send control: a 28 px blue square with a separate, loose grey chevron next to it reads as two unrelated controls.

## Goals / Non-goals

- **Goal:** Send and its options read as one, attractive control in both themes; off (no text) and Stop states stay clear.
- **Non-goal:** changing what Send, Stop, or the three send options do.

## What is true today

- `.send` is a 28 px square, `--radius-sm`, button background; `.send-more` is a separate 18 px transparent button 1 px away [verified: `media/panel.css:235-242`].
- With no text both are off; while the agent runs Send becomes Stop (secondary colors) [verified: `panel.css:237-238`; `main.ts` sendButton].

## Options considered

| | A: joined pill (recommended) | B: round button, options on hover | C: labelled "Send" pill |
| --- | --- | --- | --- |
| How | one rounded pill in the button color: arrow half, a faint divider, chevron half; both halves share hover and off states | a round button; the chevron appears only on hover or focus | a pill with the word "Send", a divider, and the chevron |
| Discoverable | yes | less (hidden until hover) | yes |
| Width | ~58 px | 30 px | ~80 px (crowds narrow panels) |
| Completeness | 9/10 | 6/10 | 7/10 |

RECOMMENDATION: A because it makes the two controls one shape without hiding the options or costing width.

## Decision

Pending M's pick.

## Design (A)

- `.send-group` becomes the pill: rounded ends (height 28 px, radius 14 px), button background, `overflow: hidden`.
- `.send` and `.send-more` lose their own backgrounds and radii inside it; a 1 px divider at 35% of the button foreground sits between them.
- Hover lights only the half under the pointer; with no text the whole pill is muted (outline in `--muted`); Stop paints the pill in the secondary colors with the chevron still separated by the divider.
- Focus rings stay per half (keyboard users reach each).

## Risks and mitigations

| Risk | Likelihood | Impact | Mitigation | How we'd notice |
| --- | --- | --- | --- | --- |
| High-contrast themes lose the divider | Low | Halves blur together | Divider uses the button foreground; check in a high-contrast theme | Window check |

## Acceptance criteria

- Given text in the box, then Send and the chevron show as one blue pill with a divider.
- Given an empty box, then the pill is muted and neither half reacts.
- Given a running agent, then the pill shows Stop in secondary colors.

## Rollout and rollback

- No setting; rollback is reverting the CSS.

## Parts

### Part 1
- [ ] Styles (and markup if needed); panel test asserts the group carries the state classes. Done: tests pass; package, install, window check.

## Standardized review

- **Bottom line:** executable after M's pick; no blocking findings.
- **Criteria:** goal fidelity pass; accuracy pass (tagged); scope pass (styles only); verification pass (panel test plus window check, since looks need eyes); decision readiness: A, B, or C.
- **Findings:** 1. **note:** visual quality is judged in M's window, not by tests.

## Changes made

None yet.

## Open questions

- A, B, or C.
