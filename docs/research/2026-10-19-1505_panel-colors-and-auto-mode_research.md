# Panel colors and UX; Auto mode still asking for kernl's tools

- Date: 2026-10-19 15:05
- Status: presented
- Mode: find out (bug) and explore options (colors and UX)
- Repos: kernl   Folders: `media/`, `src/webview/`, `src/gate/`, `src/acp/`, `src/workspaceRuntime.ts`
- Question / problem: why does a Claude Code session in Auto mode still show kernl approval cards, and how should the panel's colors and UX be made consistent?

## Research: Auto mode still asks for kernl's own tools

- **Bottom line:** in every mode but Bypass, kernl's own tools (browser, terminal, jobs) ask through kernl's gate when a CLI agent calls them, and kernl answers the agent's own permission request for those tools "yes" without asking. So in Auto mode the agent's judgment is skipped and kernl asks anyway. Confidence: high.
- **Where we are:** traced in code; not reproduced live (it needs a running Claude Code session).
- **Need from M:** pick the fix (in the plan).

### Diagnosis card

| | |
| --- | --- |
| Symptom | M switched Claude Code from Ask to Auto; the notice "Permission mode: Auto mode." showed; the next kernl browser call still opened a card "Use tool browser_navigate". |
| Mechanism | The tool gate for kernl's tools used by CLI agents maps modes as `permissionMode === "bypass" ? "bypass" : "ask"` [verified: `src/workspaceRuntime.ts:193-197`]; the gate asks for any non-bypass mode unless a rule allows it [verified: `src/gate/approvalGate.ts:60-77`]. The agent's own permission request for a kernl tool is answered yes without a card [verified: `src/acp/acpRunner.ts:609-617`, `isKernlTool`]. |
| Not the cause | The mode change itself: the gate reads the mode on every call [verified: `mode: () => ...`], and the agent's session took Auto (the notice comes after the agent confirmed it [verified: `workspaceRuntime.ts:302-326`]). |
| Owning layer | The mapping from the workspace's permission mode to kernl's tool gate (`workspaceRuntime.ts`), and the agent-request shortcut for kernl tools (`acpRunner.ts`). |
| Which agents | Auto exists for Claude Code ("decides for each tool call whether to ask") and Codex (auto review) [verified: `src/acp/agents.ts:85, 103`]. |
| Unverified | Whether Claude Code in Auto mode sends a permission request for MCP tools it judges risky [check: one live run with a kernl browser call in Auto]. |

### Other UX evidence from M's screenshot

- The card for a kernl browser call reads "Use tool browser_navigate" with raw JSON: every non-file, non-command kernl tool becomes `{kind: "tool"}` [verified: `src/ui/approvalCards.ts:21`].
- Tool rows show Claude Code's raw MCP title ("mcp: Kernl browser navigate").

## Options: one color system for the panel

### Inventory of the panel's accent and status colors [verified: grep of `media/panel.css`]

| Role in practice | Tokens used today | Where |
| --- | --- | --- |
| Primary / active | `button-background`, `progressBar-background`, `focusBorder`, `textLink-foreground` | send pill and primary buttons; working mark, running dots, plan step, context ring; approval card border and icon, checked mode; thinking borders, mentions, file badges, jobs, drop hint |
| Warning | `editorWarning-foreground`, `notificationsWarningIcon-foreground`, `orange` fallback | banner, waiting mark, context ring, setup chip, connection dots |
| Success | `testing-iconPassed`, `charts-green`, `#3fb950` fallback | plan done, added lines, connection dots |
| Error | `errorForeground` | failures, context full |

The colors come from VS Code themes (good), but one role is split over four tokens that themes set independently, so they differ (e.g. Dark Modern: button and progress `#0078D4`, links `#4daafc`).


## External findings (research agent, graded; copied from the session scratchpad)

### kernl chat panel: color system and UX research

Date: 2026-10-19. Time-boxed (~20 min). Read-only; no kernl files edited.
Grades: **verified** (read or ran it, source given), **inferred** (reasoned from verified facts), **unverified** (not checked; the check is named).

VS Code source citations refer to a sparse clone of `microsoft/vscode` at commit `113947563a38` (2026-10-19), cloned to `scratchpad/vscode-src/vscode`.

---

#### Bottom line

- The colors in kernl's panel do not match because the panel uses three different theme tokens for one job ("this is the active or primary thing"): `button.background`, `progressBar.background`, and `textLink.foreground`. Themes set each token on its own, so they only line up by coincidence. In Dark Modern, buttons and progress are both `#0078D4` but links are `#4daafc`. **verified** (theme JSON + kernl grep below)
- VS Code's own Chat view uses `button.background` as its one accent. It colors the send button, the animated "working" border around the input, and the checked item in the model picker. Everything else stays neutral, and warnings use semantic tokens only. **verified** (chat.css, chatColors.ts, modelPicker.css)
- The Webview UI Toolkit has been archived since 2025-01-06, with no official replacement. Plain `--vscode-*` CSS variables are the supported path. **verified**

---

#### 0. What kernl does today (the problem, quantified)

The kernl grep was read-only, covering `media/panel.css` and `src/webview/*.ts`.

| Role in the UI | Token kernl uses | Where | Grade |
| --- | --- | --- | --- |
| Primary action (send, `button.primary`) | `button.background` / `button.foreground` | panel.css:22, :236 | verified |
| "Working" mark, status dot, in-progress plan step, context ring fill | `progressBar.background` (fallback `focusBorder`) | panel.css:173, :282, :330, :336 | verified |
| Decorative accent: thinking icon and border, thought border, active jobs, @mention chip, file badge, plan-bar icon, drop hint | `textLink.foreground` (14 uses in total, roughly half on things that are not links) | panel.css:125, 156, 163, 188, 192, 196, 217, 222, 320, 353 | verified |
| Warning | `editorWarning.foreground` and `notificationsWarningIcon.foreground` (two different tokens), with hex fallbacks `#cca700` and `#e8912d` | panel.css:337-338 | verified |
| Success | `testing.iconPassed` / `gitDecoration.addedResourceForeground` / `charts.green`, with fallback `#3fb950` | panel.css:145, :369 | verified |
| Hex literals | They appear only as `var(..., #hex)` fallbacks, plus `orange` and some `rgba()` fallbacks. The comment in main.ts:137 (`#339036`) is an issue number, not a color. | panel.css:5-8, 78-85, 215, 273 | verified |

- **Inferred:** the "inconsistency" M sees is a token-role problem, not a hex problem. In themes where `textLink.foreground`, `progressBar.background` and `button.background` differ, the panel shows three accents. The structural fix is a small set of role variables on `:root` that every rule reads from, with each role mapped to exactly one VS Code token.

---

#### 1. VS Code official guidance

### 1.1 UX guidelines

- **Webviews:** Make every element themeable: "Ensure all elements in the view are themeable". Follow accessibility guidance (color contrast, ARIA labels, keyboard navigation). Use webviews only when needed. **verified**: https://code.visualstudio.com/api/ux-guidelines/webviews
- **Views:** "Limit the use of custom Webview Views". View progress can be shown by passing the view's ID to `ProgressLocation`. **verified**: https://code.visualstudio.com/api/ux-guidelines/views
- The overview, sidebars and panel pages say nothing about colors. **verified**: https://code.visualstudio.com/api/ux-guidelines/overview

### 1.2 Webview theming mechanics

**verified**: https://code.visualstudio.com/api/extension-guides/webview#theming-webview-content, plus VS Code source.

- Every registered theme color is exposed as `--vscode-<id>`, where the dot becomes a dash. Example: `editor.foreground` becomes `--vscode-editor-foreground`.
- **Gotcha (verified, `src/vs/workbench/contrib/webview/browser/themeing.ts:67`):** the code is `entry.id.replace('.', '-')`, which replaces only the *first* dot. A token with two dots, such as `chat.sessionStateIndicator.inProgressBorder`, therefore becomes `--vscode-chat-sessionStateIndicator.inProgressBorder` inside webviews.
- The `body` element gets one theme class: `vscode-light`, `vscode-dark`, `vscode-high-contrast`, or `vscode-high-contrast-light`. High-contrast light *also* gets `vscode-high-contrast`, for backwards compatibility. **verified**: `src/vs/workbench/contrib/webview/browser/pre/index.html:501-516`
- The `body` also gets `vscode-reduce-motion` and `vscode-using-screen-reader` when those settings are on, plus `data-vscode-theme-kind` and `data-vscode-theme-id` attributes. **verified**: same file
- The docs say: "always test your webview in high-contrast mode". **verified**: webview guide

### 1.3 Webview UI Toolkit status

- Deprecation was announced 2024-07-30 (issue #561). The repo was archived on 2025-01-06. **verified**: https://github.com/microsoft/vscode-webview-ui-toolkit/issues/561, and `gh api repos/microsoft/vscode-webview-ui-toolkit` returned `"archived": true`.
- Reason: FAST Foundation, the library it was built on, was deprecated, and nobody was funded to do the rewrite. **verified**: same issue
- There is no official replacement; webviews are now "the full responsibility of extension authors". The wrap-up names two community options: **VS Code Elements** (Lit web components) and **vscrui** (React, work in progress). **verified**: same issue
- VS Code Elements is active: last push 2026-10-18, latest release v2.5.1 (2026-02-22). **verified**: `gh api repos/vscode-elements/elements`

### 1.4 Which token is meant for what

Descriptions are quoted from https://code.visualstudio.com/api/references/theme-color. Defaults come from `src/vs/platform/theme/common/colors/*.ts`. Theme values are taken from `extensions/theme-defaults/themes/{dark,light}_modern.json`. All **verified**.

| Role | Tokens (use as a set) | Default (dark / light / HC dark) | Dark Modern / Light Modern | Notes |
| --- | --- | --- | --- | --- |
| Primary button | `button.background` + `button.foreground` + `button.hoverBackground` + `button.border` | bg `#0E639C` / `#007ACC` / **black**; fg white; border = `contrastBorder` | `#0078D4` / `#005FB8`; border `#ffffff1a` / `#0000001a` | In HC dark the fill is black, so only `button.border` makes it visible. |
| Secondary button | `button.secondaryBackground` + `button.secondaryForeground` + `button.secondaryHoverBackground` + `button.secondaryBorder` | bg = `list.hoverBackground`; border = 15% foreground, `contrastBorder` in HC | Dark Modern secondary bg `#00000000` (transparent), fg `#CCCCCC` | |
| Progress | `progressBar.background` | `#0E70C0`, `contrastBorder` in HC | `#0078D4` / `#005FB8` | The default differs from the button default, so the two can diverge in any theme. |
| Badge (counts) | `badge.background` + `badge.foreground` | `#4D4D4D` / `#C4C4C4` | `#616161` / `#CCCCCC` (neutral gray) | Badges are neutral, not accent. `activityBarBadge.background` is the accent-colored badge (`#0078D4`). |
| Links | `textLink.foreground` + `textLink.activeForeground` | `#3794FF` / `#006AB1` / `#21A6FF` | `#4daafc` / `#005FB8` | This is a *text* color tuned for reading on the background. It is lighter than the button color in dark themes. |
| Focus | `focusBorder` (outline) | `#007FD4` / `#0090F1` / `#F38518` | `#0078D4` / `#005FB8` | "only used if not overridden by a component" |
| High-contrast borders | `contrastBorder`, `contrastActiveBorder` | `null` in normal themes; HC: `#6FC3DF` and `focusBorder` | not set | "typically only set for high contrast themes" |
| Errors / warnings / info | `errorForeground`; `editorError/Warning/Info.foreground`; `inputValidation.{error,warning,info}{Background,Foreground,Border}` | — | errorForeground `#F85149` | Use one warning token, not two. |
| Inputs | `input.background` + `input.foreground` + `input.border` + `input.placeholderForeground`; toggles: `inputOption.activeBackground/Border/Foreground` | — | input.border `#3C3C3C` | |
| Lists | `list.hoverBackground`; `list.activeSelectionBackground` + `list.activeSelectionForeground` | — | — | Selection tokens pair with each other. |
| Toolbar or icon hover | `toolbar.hoverBackground`, `icon.foreground` | — | — | |
| Secondary text | `descriptionForeground`, `disabledForeground` | — | `#9D9D9D` | |
| Chat-specific | `chat.requestBorder`, `chat.requestBackground`, `chat.requestBubbleBackground`, `chat.thinkingShimmer`, `chat.linesAdded/RemovedForeground`, `chat.slashCommandBackground/Foreground`, `chat.inputWorkingBorderColor1` | `chat.inputWorkingBorderColor1` defaults to **`button.background`** | — | `chat.*` tokens are exported to webviews like any other token (inferred from themeing.ts:63-69). |

**Pairing rule (verified):** VS Code's own `defaultButtonStyles` binds background, foreground, hover and border as one set. See `src/vs/platform/theme/browser/defaultStyles.ts` (`defaultButtonStyles`). VS Code's internal theming guide flags `color: white` on a button and says to use `var(--vscode-button-foreground)`. See `.github/skills/ux-theming/SKILL.md` §7 in microsoft/vscode.

---

#### 2. How VS Code's own Chat view styles the composer

All paths are under `src/vs/workbench/contrib/chat/browser/`. The task named `browser/media/*.css`, but that folder now holds only 2 files. The main stylesheet is `widget/media/chat.css` (5132 lines). **verified**

| Element | Styling | Tokens | Source |
| --- | --- | --- | --- |
| Send button (idle) | A filled **circle** (`--vscode-cornerRadius-circle`) sized to the input control height, with a 12px "compact" arrow-up codicon. Hover changes only the fill. The focus ring sits on the wrapper with `outline-offset: 1px`. | `button.background`, `button.foreground`, `button.hoverBackground`, `focusBorder` | widget/media/chat.css:1418-1468 |
| Send button (disabled) | The fill is removed, keeping only the round shape. The filled rule applies only under `:not(.disabled)`. | — | chat.css:1427-1431, :1459 |
| Stop button (while working) | Neutral, not accent. | `icon.foreground` | chat.css:2191-2193 |
| "Working" indicator #1: input border | A conic-gradient "comet" spins around the input border while a request runs. A faint `input.border` ring stays visible underneath for accessibility. | `chat.inputWorkingBorderColor1`, which defaults to `button.background` (HC: `#FFFFFF` / `#000000`) | chat.css:1240-1330; common/widget/chatColors.ts (`chatInputWorkingBorderColor1`) |
| "Working" indicator #2: progress text | The progress label shimmers: a `descriptionForeground` gradient with a `chat.thinkingShimmer` highlight, over a 2s loop. Under reduced motion it becomes static `descriptionForeground` text. Only one shimmer is active per response. | `descriptionForeground`, `chat.thinkingShimmer` | chat.css:3576-3650 |
| Determinate progress ring (dictation download) | An SVG ring: the track uses `progressBar.background` at 25% opacity (100% in HC) and the arc uses `progressBar.background`. It spins only under `.monaco-enable-motion`. | `progressBar.background` | chat.css:5070-5132 |
| Tool confirmation (Allow / Skip) | Small `monaco-button`s built with `defaultButtonStyles`. **Allow** (or "Allow in this session") is the primary button and carries a dropdown of more options. **Skip** has `isSecondary: true`. Pattern: one primary, one secondary. | `button.*` and `button.secondary*` | widget/chatContentParts/toolInvocationParts/abstractToolConfirmationSubPart.ts:195-229; widget/chatContentParts/chatConfirmationWidget.ts:211, :447 |
| Confirmation card | Bordered card with a muted title. Its only colored text is the "see more" link and the diff counts. | `chat.requestBorder`, `descriptionForeground`, `foreground`, `textLink.foreground` (only on an actual link), `errorForeground`, `chat.linesAdded/RemovedForeground` | widget/chatContentParts/media/chatConfirmationWidget.css |
| Mode / model pickers | Transparent at rest. Hover uses `toolbar.hoverBackground`; the open state uses `toolbar.activeBackground`. In the menu, the checked row is `color-mix(button.background 18%, menu.background)` with a checkmark in `button.background`. Warning badges use `editorWarning.foreground` mixed to 14-22%. | `toolbar.hoverBackground`, `button.background` (tint only), `editorWarning.foreground` | widget/input/media/chatInputPicker.css:38-43; widget/input/modelPicker/media/modelPicker.css:34, 597-607, 814-817, 1085, 1177-1183 |
| Session state borders | In progress: `charts.yellow`. Unvisited: `charts.green`. Needs input: `errorForeground`. All three use `contrastActiveBorder` in HC. | semantic | common/widget/chatColors.ts |

- **Inferred conclusion:** in VS Code Chat, the single accent is `button.background`. It appears on the idle send button, the in-flight input border, and the checked-state tint and check in pickers. Links use `textLink.*` only on real links. Status uses semantic tokens. Everything else is `foreground`, `descriptionForeground` or `icon.foreground`.
- **Inferred, not fully checked:** I found no `.hc-black` rule for `.chat-submit-button`. Because `button.background` is black in HC dark, the send button may depend on a generic HC action-bar outline. Check by opening VS Code Chat under "Dark High Contrast".
- VS Code's internal design guide states the principles that drive this. It calls for UI that is "Quiet at rest, present on intent", and says "a hardcoded hex is a bug by construction". It also says motion must "do a job" and honor `prefers-reduced-motion`. **verified**: microsoft/vscode `.github/skills/design-philosophy/SKILL.md` (sections "Calm", "Color comes from the theme", "Delight earns its keep"). This is a repo-internal contributor guide, not public API docs.

---

#### 3. Claude Code (VS Code extension) and Cursor

### Claude Code VS Code extension

Docs: https://code.claude.com/docs/en/vs-code

- **verified (docs text):** a tab's status is shown by a dot on the spark icon: "blue means a permission request is pending, orange means Claude finished while the tab was hidden".
- **verified (docs text):** when the prompt-cache countdown runs out, "the icon turns red, or your theme's error color". This shows the extension maps status to theme semantic tokens.
- **verified (docs text):** the permission mode and model name appear as clickable indicators at the bottom of the prompt box. Edit permission uses a diff view with accept and reject actions.
- **verified (looked at the docs screenshot `images/vs-code-send-prompt.png`):** the prompt box has a rounded border in Anthropic's **orange/terracotta brand color**. The send button is a **rounded square** with an up-arrow, filled with a muted version of the same orange. The model and mode labels are neutral gray text, and message bullets are neutral gray dots.
- **Inferred:** Claude Code uses a fixed *brand* accent rather than `button.background`. This is a deliberate brand choice, and the opposite of what VS Code Chat does.
- **unverified:** whether that orange comes from a theme token or is hard-coded, and how it renders in HC themes. Check by inspecting the webview (Developer: Open Webview Developer Tools) with Claude Code installed.

### Cursor

- Cursor is a VS Code fork, not a webview extension, so it is not a like-for-like comparison. **inferred**
- **verified (forum, staff reply 2026-04-04, Dean Rie):** in Cursor 3, "Custom VS Code themes aren't fully supported", and the Chat Pane uses "a separate theme engine" that ignores `workbench.colorCustomizations`. Source: https://forum.cursor.com/t/cursor-3-styles-of-my-light-theme-got-messed-up/156668
- A later staff reply (2026-06-01) said "made some changes in this area". The current state is **unverified**.
- **unverified:** send button shape and accent use. I found no official Cursor docs on this. Community threads report low-contrast chat buttons (https://forum.cursor.com/t/invisible-action-buttons/148981) and links that are too dark in HC (https://forum.cursor.com/t/default-high-contrast-agents-chat-links-too-dark-gitlens-hover-differs-from-vs-code/162036).
- **Inferred lesson:** a chat UI on its own theme engine drifts from the user's theme, and users notice. That is an argument for kernl staying 100% on `--vscode-*` tokens.

---

#### 4. Accessibility

| Requirement | Rule | Applies to | Source | Grade |
| --- | --- | --- | --- | --- |
| Text contrast | 4.5:1 for normal text, 3:1 for large text | Button labels: `button.foreground` on `button.background` | WCAG 2.2 SC 1.4.3, https://www.w3.org/WAI/WCAG22/Understanding/contrast-minimum.html | verified (well-known SC) |
| Non-text contrast | 3:1 for "visual information required to identify user interface components and states" | An icon-only send glyph on its fill, the status dot, the progress ring arc, and the focus ring. A button *fill* needs 3:1 only when the fill is the only cue that the control exists. | WCAG 2.2 SC 1.4.11, https://www.w3.org/WAI/WCAG22/Understanding/non-text-contrast.html | verified |
| Focus visible | The focus indicator must contrast with what it sits next to | Use `focusBorder` with `:focus-visible` | Same page; VS Code ux-theming skill §5 | verified |

**Measured contrast for the default themes** (computed with the WCAG relative-luminance formula; **verified** by running the calculation):

- White on `#0078D4` (Dark Modern button) = 4.53:1. This passes AA for text, with almost no margin.
- White on `#005FB8` (Light Modern) = 6.31:1.
- `#0078D4` used as a *text or icon* color on `#181818` (Dark Modern sidebar) = 3.92:1. This **fails** 4.5:1 for text but passes 3:1 for icons and graphics. That is why `textLink.foreground` (`#4daafc`, 7.16:1) differs from `button.background`. Never use `button.background` or `progressBar.background` as the color of *text*.
- `#cccccc` on `#0078D4` = 2.82:1. Pairing `button.background` with any foreground other than `button.foreground` can fail.
- `errorForeground` `#F85149` on `#F8F8F8` (Light Modern sidebar) = 3.16:1. This is enough for icons, not for body text.

**High contrast (verified, from the defaults table above):**

- In HC dark, `button.background` is black, `contrastBorder` is `#6FC3DF`, and `progressBar.background` equals `contrastBorder`.
- Every filled accent element therefore needs `border: 1px solid var(--vscode-button-border, transparent)` or `var(--vscode-contrastBorder)`. Otherwise it disappears.
- Remove box-shadows in HC and use solid colors, not transparency (VS Code ux-theming skill §6).
- In webviews, select on `body.vscode-high-contrast`, which also matches HC light.

**Reduced motion (verified):**

- The webview body gets `vscode-reduce-motion` (pre/index.html:511-512). Honor both that class and `@media (prefers-reduced-motion: reduce)`.
- VS Code Chat's pattern: under reduced motion, the shimmer becomes static `descriptionForeground` text (chat.css:3631-3638), the ring stops spinning (chat.css:5115-5117 is gated on `.monaco-enable-motion`), and collapse transitions are set to `none` (chatConfirmationWidget.css).

---

#### 5. Principles for a single-accent chat panel (evidence-backed)

1. **One accent token: `button.background`.** **verified** (VS Code Chat precedent). Use it for the primary action (send), the in-flight state (the input border or working mark), the in-progress plan step, and checked or selected tints. Do not use `progressBar.background` or `textLink.foreground` as alternate accents.
   - Exception: a real progress *bar or ring* may use `progressBar.background`, as VS Code does. In Dark Modern and Light Modern it equals `button.background`; in other themes it may not. Pick one owner for "progress", and if parity is wanted, alias it to the accent.
2. **Accent fills always pair with their own foreground.** **verified**. Text or icons on `button.background` use `button.foreground`, hover uses `button.hoverBackground`, and the border uses `button.border`.
3. **Never use the accent as a text color.** **verified** by the 3.92:1 measurement. Use `textLink.foreground` *only for real links*. Accent-colored icons are acceptable (3:1), but neutral icons are better.
4. **Everything else is neutral:** `foreground`, `descriptionForeground`, `icon.foreground`, `widget.border` / `chat.requestBorder`, `toolbar.hoverBackground`, and `list.*` for menus. **verified** (VS Code Chat). Decorative uses in kernl today, such as the thinking border, file badge and mention chip, become neutral or a tint of the accent. **inferred**
5. **Semantic colors only for status, one token per meaning.**
   - error = `errorForeground`
   - warning = `editorWarning.foreground`, or the `notificationsWarningIcon.foreground` family, but not both
   - success = `testing.iconPassed` or `charts.green`
   - diff counts = `chat.linesAddedForeground` / `chat.linesRemovedForeground`

   **verified** (VS Code Chat's choices). Pair each color with an icon or text, so meaning never relies on color alone. **inferred** from WCAG 1.4.1.
6. **One primary button per decision.** Allow is primary; Skip or Deny is secondary (`button.secondary*`). **verified** (abstractToolConfirmationSubPart.ts).
7. **Quiet at rest, present on intent.** Controls are transparent until hover or focus, and the focus ring uses `:focus-visible` + `focusBorder`. Disabled send drops its fill. **verified** (design-philosophy skill; chat.css:1427-1468)
8. **Motion must do a job and must stop under reduced motion.** Keep at most one active "working" animation per response. **verified** (chat.css:3640)
9. **HC-proof every fill.** Add `button.border` / `contrastBorder` and drop shadows under `body.vscode-high-contrast`. **verified**
10. **Hex only as a `var()` fallback, and only for tokens a theme might leave undefined.** **verified** (VS Code reviewer rule: "a hardcoded hex is a bug by construction"). Most core tokens always resolve, so their fallbacks are dead code. **inferred**
11. **Define roles once on `:root`, for example `--k-accent`, `--k-accent-fg`, `--k-muted`, `--k-warn`, and map each to exactly one VS Code token.** Every rule reads the role variable, so a theme cannot split the roles. **inferred**. This is the structural fix for the drift M reported.

---

#### Open items (unverified)

- Whether VS Code's chat send button gets an HC border from a generic rule. Check by opening Chat in Dark High Contrast.
- How Claude Code's orange accent is sourced (theme token or hard-coded). Check with the Webview Developer Tools.
- Cursor's current chat theming after June 2026. Check by testing Cursor latest with a custom theme.

## Recommendation

RECOMMENDATION: one accent (the button color) for every primary or active thing, links only for links, neutral for the rest, one token per status, all named once as role variables on `:root`; Auto mode lets the agent decide for kernl's tools too. Details and parts in `docs/plans/2026-10-19-1510_panel-theme-and-auto-mode_plan.md`.

## Standardized review

- **Bottom line:** decision-grade; no blocking findings.
- **Criteria:** question fit pass; method pass (code traced, CSS grepped, VS Code source and docs read by the research agent); source quality pass (primary: VS Code source and docs; Claude Code and Cursor claims marked unverified where unsourced); coverage pass; traceability pass; uncertainty stated; recommendation proportionate.
- **Findings:**
  1. **must-verify:** Claude Code's Auto mode behavior for MCP tool permission requests (live run).
  2. **note:** contrast numbers are computed for Dark Modern; other themes rely on their authors' pairs.
