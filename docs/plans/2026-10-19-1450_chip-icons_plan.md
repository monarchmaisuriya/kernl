# Icons and clearer labels on the composer's chips

- Date: 2026-10-19 14:50
- Status: done
- Repos: kernl   Folders: `src/webview/`, `media/`, `test/unit/`   Files: `src/webview/icons.ts`, `src/webview/main.ts`, `media/panel.css`, `test/unit/webview.test.ts`
- Subagents: none

## Context and problem

M finds the chips under the message box ("OpenCode", "litellm/GPT-5.6 Sol…", "Thinking: Medium") hard to read at a glance: only thinking has an icon, the model chip spends its width on the provider prefix, and fast mode reads "Fast: off" as plain text.

## Goals / Non-goals

- **Goal:** every chip leads with an icon that says what it is; the model chip shows the model name first; fast mode reads as a toggle.
- **Non-goal:** brand logos (kernl draws its own icons; no third-party marks); changing what any chip does.

## What is true today

- Icons are inline SVG paths in `icons.ts`; the set has `kernl` (the mark), `bulb`, `terminal`, `folder`, `branch`, `shield`, and others, but no model or fast icon [verified: `src/webview/icons.ts:7-34`].
- Agent chip: text and a chevron [verified: `main.ts:278`]. Model chip: text and a chevron, the full `provider/model` for OpenCode and custom providers [verified: `main.ts:297, 301`]. Thinking: bulb, "Thinking: <level>" [verified]. Fast: "Fast: on/off" text [verified].

## Design

```
today:   OpenCode v   litellm/GPT-5.6 Sol... v   (bulb) Thinking: Medium v   Fast: off
after:   [>_] OpenCode v   [chip] GPT-5.6 Sol v   (bulb) Medium v   [bolt] Fast     <-- icons; shorter text
```

| Chip | Icon | Text | Tooltip (full detail) |
| --- | --- | --- | --- |
| Agent | kernl mark for kernl; terminal `>_` for Claude Code, Codex, OpenCode | agent name | as today |
| Model | new `chip` icon (a processor) | model name after the last `/` | provider and full id, as today |
| Thinking | bulb (as today) | the level only ("Medium") | "Thinking: Medium. How much … thinks" |
| Fast | new `bolt` icon, outline when off, filled when on | "Fast" | "Fast mode: on/off. Click to turn it off/on" |

- Screen readers keep the full labels (aria-labels already say "Model: …", "Thinking: …"; fast keeps `aria-pressed`).
- Two new icon shapes in `icons.ts` on the existing 16 px grid.

## Risks and mitigations

| Risk | Likelihood | Impact | Mitigation | How we'd notice |
| --- | --- | --- | --- | --- |
| Dropping the provider prefix hides which provider a model is on | Low | Confusion between same-named models | Tooltip and the model menu keep the full id | Window check |
| "Medium" alone is ambiguous | Low | Unclear chip | The bulb icon, tooltip, and aria-label say "Thinking" | Window check |

## Acceptance criteria

- Given the composer, then the agent, model, thinking, and fast chips each start with an icon.
- Given an OpenCode model `litellm/GPT-5.6 Sol`, then the chip reads "GPT-5.6 Sol" and its tooltip names `litellm/GPT-5.6 Sol`.
- Given fast mode on, then its bolt is filled and `aria-pressed` is true.

## Rollout and rollback

- No setting; rollback is reverting the change.

## Parts

### Part 1
- [ ] Icons, labels, and styles; panel tests updated for the new texts. Done: panel tests pass; package, install, window check.

## Standardized review

- **Bottom line:** executable; no blocking findings.
- **Criteria:** goal fidelity pass; accuracy pass (tagged); scope pass (webview only); architecture pass; completeness pass; failure handling n/a; verification pass; feasibility pass; decision readiness: M confirms the labels.
- **Findings:** 1. **note:** shortened labels rely on the icon and tooltip; checked in M's window.

## Changes made

None yet.

## Open questions

- None.
