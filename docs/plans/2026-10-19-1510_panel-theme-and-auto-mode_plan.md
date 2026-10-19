# Auto mode for kernl's tools; one color system and clearer cards in the panel

- Date: 2026-10-19 15:10
- Status: built (window check left)
- Repos: kernl   Folders: `src/`, `media/`, `test/`   Files: `src/workspaceRuntime.ts`, `src/acp/acpRunner.ts`, `src/gate/approvalGate.ts`, `src/ui/approvalCards.ts`, `src/browser/tools.ts`, `media/panel.css`, `src/webview/*.ts` (class changes only), tests, `docs/guides/permission-modes.md`, `docs/guides/panel.md`, `CHANGELOG.md`
- Subagents: none
- Research: `docs/research/2026-10-19-1505_panel-colors-and-auto-mode_research.md`

## Context and problem

1. M started a Claude Code chat in Ask mode, switched to Auto, and still got a kernl card for a browser call.
2. The panel's colors don't agree: the send pill, the working indicator, the approval card, thinking, mentions, and status dots each use a different theme color for the same meaning.
3. Cards and rows for kernl's own tools are raw: "Use tool browser_navigate" with JSON; "mcp: Kernl browser navigate".

## Goals / Non-goals

- **Goal:** in Auto mode, kernl's tools follow the agent's own judgment, as Auto promises ("Claude Code decides for each tool call whether to ask").
- **Goal:** one accent for primary and active things, links only for links, neutral elsewhere, one color per status, defined once.
- **Goal:** kernl tool cards and rows in plain words.
- **Non-goal:** a new visual identity, new controls, or third-party component libraries (the Webview UI Toolkit is archived [research]).

## What is true today

See the research file: the diagnosis card (tagged), and the color inventory (four tokens for one role, three chains for warning and for success).

```
Claude Code (Auto) ──calls──> kernl tool (browser_navigate)
   agent's permission request ──> kernl answers yes, no card            (acpRunner.ts:614)
   tool runs ──> kernl tool gate: mode = bypass ? bypass : ask ──> CARD  (workspaceRuntime.ts:196)  <-- asks in Auto
```

## Options considered

### Auto mode for kernl's tools

| | A: the agent decides (recommended) | B: kernl's tools never ask in Auto |
| --- | --- | --- |
| How | In Auto, kernl's tool gate doesn't add a card; when the agent itself asks permission for a kernl tool, that request becomes the card (instead of an automatic yes) | In Auto, kernl's tools run without a card, whatever the agent thinks |
| Matches Auto's promise | yes | partly (ignores the agent's caution) |
| Deny rules | still apply | still apply |
| Risk | depends on the agent asking for risky MCP calls [unverified, live check] | no prompt even when the agent would have asked |
| Completeness | 9/10 | 6/10 |

RECOMMENDATION: A because Auto means the agent judges each call; kernl should neither skip its question nor add its own.

### Color system

| | A: role variables, one VS Code color each (recommended) | B: keep tokens, align a few rules |
| --- | --- | --- |
| How | `:root` defines `--accent` (button colors as a set), `--accent-soft` (a tint for checked rows and mention chips), `--link`, `--focus`, `--warning`, `--danger`, `--success`; every rule uses a role | change the visibly odd ones (working mark, card border) |
| Recurrence | a rule can't pick a stray token without bypassing the roles | drift returns with the next rule |
| Completeness | 9/10 | 5/10 |

RECOMMENDATION: A because the cause is one role spread over four tokens; naming the roles once is the structural fix.

## Decision

M signed off: Auto mode option A, color system option A with the drift test, and Part 3; one live Claude Code run in Auto.

## Design

### Part 1: Auto mode lets the agent decide (bug)

- Tool gate mode for CLI agents: `bypass` and `auto` -> no kernl card (deny rules first, as today); other modes unchanged.
- Runner: for a kernl tool, the agent's own permission request is answered yes only when kernl's gate will ask itself (every mode but Auto and Bypass); in Auto it goes to the card (through the agent gate, as any agent request does).
- Applies mid-run: both read the mode on each call.

### Part 2: one color system

Role variables on `:root` (each maps to exactly one VS Code color, with the fallback chain in one place):

| Role | VS Code color | Used for |
| --- | --- | --- |
| `--accent`, `--accent-fg`, `--accent-hover`, `--accent-border` | `button.background`, `button.foreground`, `button.hoverBackground`, `button.border` / `contrastBorder` | send pill, primary buttons (Approve), working mark, running dots, plan step in progress, context ring (normal), approval card border and icon |
| `--accent-soft` | `button.background` at 14% | checked menu rows and modes, mention chip background |
| `--link` | `textLink.foreground` | real links only (markdown links, sites in tool rows) |
| `--focus` | `focusBorder` | focus rings, focused composer and search |
| `--warning`, `--danger`, `--success` | `editorWarning.foreground`, `errorForeground`, `testing.iconPassed` | status only, always with an icon or text |
| neutral | `foreground`, `descriptionForeground`, `icon.foreground` | thinking icon and border, file badges, jobs, drop hint, mention text |

- Stop: neutral (as VS Code's Chat), inside the same pill shape.
- The accent is never a text color (contrast: `#0078D4` on `#181818` is 3.92:1, below 4.5 [research]); icons and borders only (3:1 needed).
- High contrast: filled accent elements keep `--accent-border`.
- Reduced motion: unchanged rules; any new animation gets the same guard.

### Part 3: kernl tool cards and rows in plain words

- Browser tools ask with a readable title and target: "Open developers.brevo.com/docs/loyalty-setup in kernl's browser", "Click …", "Type into …", "Take a screenshot" (new gate request kind `browser` with `action` and `target`), shown on the card without JSON.
- Rows for kernl's tools called by a CLI agent use kernl's own names ("Browser: open developers.brevo.com") instead of "mcp: Kernl browser navigate".

## Risks and mitigations

| Risk | Likelihood | Impact | Mitigation | How we'd notice |
| --- | --- | --- | --- | --- |
| Claude Code in Auto never asks for MCP tools, so kernl's browser runs unprompted | Medium [unverified] | Browser actions without a card in Auto | That is what Auto means; deny rules still apply; live check documents it | Live check |
| Theme authors' `button.background` low contrast on the sidebar | Low | Faint accent icons | Icons and borders only (3:1); text never accent | Window check in light and dark |
| Changing card titles breaks approval rules matching on tool names | Low | A rule stops matching | Rules match the request, not the title; test that existing `tool:` rules still match browser calls | Unit test |

## Acceptance criteria

- Given Claude Code in Auto, when it calls a kernl browser tool without asking, then no card appears; when it asks, then one card appears.
- Given Ask mode, then a kernl browser call shows one card (as today).
- Given a deny rule, then the call is refused in every mode.
- Given the panel in Dark Modern, Light Modern, and a high-contrast theme, then the send pill, working mark, running dots, in-progress plan step, context ring, and approval card border share one color; links alone use the link color.
- Given a kernl browser call that asks, then the card reads "Open <url> in kernl's browser" with no JSON.

## Rollout and rollback

- No setting; each part reverts on its own.

## Parts

### Part 1: Auto mode lets the agent decide
- [x] Gate mapping and the runner's kernl-tool request. Done: unit tests (Auto: no tool card, the agent's request becomes the card; Ask: one card; deny rule refuses in Auto); VS Code check with the fake agent; live check with Claude Code (M's OK).

### Part 2: one color system
- [x] Role variables and every color rule moved onto them. Done: a unit test that `panel.css` uses no raw `--vscode-*` color outside the `:root` role block (guards drift); panel tests pass; window check in dark, light, and high contrast.

### Part 3: plain-word cards and rows for kernl's tools
- [x] Browser requests and row titles. Done: unit tests for card text and row titles; existing rule tests pass.

### Finish
- [ ] Docs (permission modes, panel), changelog; suites; package, install, window check.

## Standardized review

- **Bottom line:** executable after two decisions; no blocking findings.
- **Criteria:** goal fidelity pass (both reported issues, plus the UX issues visible in the same screenshot); current-system accuracy pass (tagged in research); scope pass (no redesign); architecture pass (mode mapping at the runtime, request shape at the gate, colors at `:root`); sequencing pass (independent parts); completeness pass; failure handling pass (deny rules first in every mode); verification pass (a drift-guard test, not just screenshots); feasibility pass; decision readiness: two choices.
- **Findings:**
  1. **must-verify:** Claude Code's Auto behavior for MCP permission requests (live run, M's OK).
  2. **note:** "as much as possible" is bounded here to the issues with evidence; further ideas go to a follow-up list, not this change.

## Changes made

- Part 1: kernl's tool gate treats Auto like Bypass for kernl's own tools (deny rules first); the runner shows the agent's own request for a kernl tool as the card in Auto. Verified: runner tests (Auto: one card from the agent, approve and decline), VS Code check (Auto asks once as the agent's request, Ask once as kernl's command card), live Claude Code run in Auto: example.com opened through kernl's tool with no card (Claude Code judged it safe; kernl added none).
- Part 2: a role block on `:root` (accent, secondary, link, focus, warning, danger, success, neutral, syntax); every rule uses roles; the working mark, running dots, plan step, context ring, approval cards, send pill, and primary buttons share the accent; thinking, mentions, badges, jobs are neutral; one color per status; the send pill keeps a border in high contrast. Verified: drift tests (no theme color outside the block; every role defined; accent and link used only where intended).
- Part 3: `describeBrowserCall` gives cards ("Open developers.brevo.com in kernl's browser", exact URL as detail) and rows ("Browser: open developers.brevo.com"); the runner keeps the kernl tool name when it renames a row, so Ask mode still shows one card.
- Fixed while testing: a session superseded by New chat during an early start was closed without the next session waiting for it; its close now goes through the runner's existing wait, so the agent never holds both.
- Verified overall: unit tests (two full runs, 0 failures), single-folder suite 70/70, multi-root 6/6. Note: a browser row reads "Browser: open" for a moment until the agent sends the URL.

## Open questions

- Auto mode: A or B.
- Color system: A or B.
