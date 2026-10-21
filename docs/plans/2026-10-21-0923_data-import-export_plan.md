# Export and import kernl data (conversations and settings, never API keys)

- Date: 2026-10-21 09:23
- Status: done (released as 0.11.0)
- Repos: kernl   Folders: `src/`, `test/`, `docs/guides/`
- Files: `src/dataTransfer.ts` (new), `src/controller.ts`, `src/providers/keys.ts`, `src/acp/credentials.ts`, `package.json`, `docs/guides/panel.md`, `docs/guides/help.md`, `CHANGELOG.md`, `test/unit/dataTransfer.test.ts` (new), `test/vscode/suite.ts`
- Subagents: none
- Sign-off: M asked (2026-10-21): "plan and implement a feature to import/export data - conversations, settings NO API KEYS", then approved "D1 A, D2 A, D3 A, D4 A, D5 A. Build it part by part with tests, then run both suites, package, and install. Don't release yet."

## Context and problem

kernl keeps conversations and settings on one machine, in one VS Code profile. There is no way to move them to another machine, back them up, or restore them. M wants an export and an import that cover conversations and settings and never contain an API key.

## Goals / Non-goals

Goals:

- **Export:** one command writes one file with the conversations of the folders open in this window and kernl's user settings.
- **Import:** one command reads that file, shows what it will add and change, and applies it after one confirmation.
- **No keys:** no API key, agent credential, or secret header value ever ends up in an export file.

Non-goals:

- API keys, agent credentials, and secret header values. They are set again with **kernl: Set API key** and **Agent logins**.
- Checkpoints (Restore points). They are git snapshots tied to this machine's checkouts.
- Tabs, drafts, queued messages, and permission modes. They are per-window state.
- `~/.kernl` files (rules, agents, `AGENTS.md`). They are the user's own files, copied like any other.
- CLI agents' own sessions (conversations opened from an agent's list). They live in the agent's storage.
- Workspace settings (`.vscode/settings.json`). They travel with the project.

## What is true today

- **Where conversations live:** one JSON file per conversation, `globalStorage/local.kernl/sessions/<key>/<id>.json` [verified: `src/controller.ts:189`, `src/sessions.ts` `SessionStore.save`].
- **The folder key:** the first 16 hex characters of the SHA-256 of the folder's full path [verified: `src/workspaceRuntime.ts:766-767`]. It can't be turned back into a name, and the same project at another path or on another machine gets a different key.
- **What a conversation holds:** title, agent (`harness`), times, the transcript `events`, and `history`. For kernl's agent, `history` is its message history; for a CLI agent, it is `{ sessionId }` [verified: `src/sessions.ts:14-29`].
- **Tool images:** saved under `sessions/previews/<session>/<file>`. Transcripts point to them through `toolPreview` events' `file` field, at most 5 MB each [verified: `src/sessions.ts` `savePreview`, `src/ui/protocol.ts:243`].
- **Keys:** provider keys and secret header values live only in SecretStorage, the OS keychain [verified: `src/providers/keys.ts:15-16`]. So do CLI agents' API keys [verified: `src/acp/credentials.ts:43-49`]. Provider key names are listed in `kernl.apiKeyIndex` [verified: `src/providers/keys.ts:11`, `:83`].
- **The redactor:** it replaces every key it knows with `[redacted]`, but it only knows keys read or stored in this window so far [verified: `src/log.ts:2-25`; `src/providers/keys.ts:49-51`]. A key that was never loaded this session, or a token pasted into a chat, is not caught today.
- **Settings that can hold secrets:**
  - `kernl.agentCommands` (`env`) and `kernl.mcpServers` (`env`, `headers`) can hold tokens. Both are machine-scoped [verified: `package.json` configuration].
  - VS Code's own Settings Sync syncs "User settings, except settings with the `machine` or `machine-overridable` scope" ([Settings Sync](https://code.visualstudio.com/docs/configure/settings-sync)).
  - For `machine` scope, the API reference says: "The value of these settings will not be synchronized" ([contribution points](https://code.visualstudio.com/api/references/contribution-points)).
  - `kernl.customProviders` holds no secrets by design: its `headers` are "Not for secrets", and secret headers are stored by name only [verified: `package.json`].
- **A CLI-agent conversation on another machine:** when its saved session can't be found, kernl says "couldn't reload the earlier conversation; this message starts a new one" and carries on [verified: `src/acp/acpRunner.ts:375-381`].
- **Patterns to mirror:**
  - **kernl: Delete conversations and checkpoints** (`clearHistory`, `src/controller.ts:1172`) asks through the `Prompts` interface (`src/workspaces/commands.ts:9-14`), which the suite replaces with scripted answers.
  - The panel's kernl menu holds settings actions in its `3_settings` group (`package.json`, `kernl.panelMenu`).

```
Export                                          Import
------                                          ------
pick what (conversations / settings)            pick file
  -> read this window's folders' conversations   -> parse + validate (format, version, shapes,
     (+ worktree workspaces) and previews            sizes, preview paths, setting keys)  <-- new
  -> read user kernl.* settings, minus           -> place conversations by folder name
     machine-scoped ones                  <-- new     (ask when unmatched)               <-- new
  -> load every stored key into the redactor     -> show: N conversations to add, M skipped
  -> scrub stored keys + key-shaped text  <-- new     (already here), settings before/after
  -> assert no stored key remains (fail)  <-- new   -> one confirmation
  -> save dialog -> write one .json file           -> write conversations, previews, settings
```

## Options considered

| Aspect | A: one JSON file, built and checked by a pure module (recommended) | B: copy the storage folder as a zip | C: VS Code Settings Profiles |
| --- | --- | --- | --- |
| How it works | `src/dataTransfer.ts` builds and parses a versioned JSON document; the controller only does dialogs and storage | Zip `globalStorage/local.kernl/sessions` as is | Ask users to export a VS Code profile |
| Fits our code | Mirrors `clearHistory` and `Prompts`; pure functions are unit-testable like `sessions.ts` helpers | Folder keys are path hashes: on another machine nothing matches | Profiles carry settings, not kernl's conversations |
| Keys | Scrubbed and asserted at the one boundary that writes the file | Copies whatever is on disk unscrubbed | Settings only; machine settings excluded by VS Code |
| Cost and blast radius | 1 new module, 2 commands, small key-store additions | Small, but imports land in the wrong folders | No code, but no conversations |
| When it fails | Very large exports (images); mitigated by size caps | Every import to another path | Conversations never move |
| Completeness | 9/10 | 3/10 | 2/10 |

RECOMMENDATION: A, because it is the only option where the export boundary can guarantee "no keys" and where conversations land in the right folder on another machine.

## Decision

Option A. The export boundary (the function that produces the file's text) owns the "no keys" guarantee: it scrubs, then checks, then refuses to write if a stored key survives. Import is the other boundary: it validates everything before writing anything.

Decisions for M (recommended first):

- **D1, what to export:** A: the folders open in this window, with their worktree workspaces (recommended; the store's keys can't be turned back into names). B: everything in the store, with unnamed folders that the importer must place by hand.
- **D2, a conversation that already exists (same id):** A: skip it, never overwrite (recommended; nothing here is lost). B: keep whichever was updated last.
- **D3, secrets beyond kernl's stored keys:** A: also replace key-shaped text with `[redacted]` (prefixes `sk-`, `sk-ant-`, `ghp_`, `gho_`, `github_pat_`, `AKIA`, `xoxb-`, `xoxp-`, and `-----BEGIN ... PRIVATE KEY-----` blocks) and report how many (recommended). B: stored keys only.
- **D4, tool images:** A: include them, base64 in the file (recommended; transcripts otherwise show broken previews). B: leave them out for a smaller file.
- **D5, applying settings:** A: show every change (setting, current value, imported value) and ask once (recommended). B: pick setting by setting.

## Design

### File format (version 1)

```json
{
  "format": "kernl-data",
  "version": 1,
  "exportedAt": "2026-10-21T09:30:00.000Z",
  "kernlVersion": "0.11.0",
  "settings": { "kernl.model": "claude-sonnet-5-5", "kernl.tabs.max": 8 },
  "folders": [
    {
      "name": "kernl",
      "workspaces": [
        { "name": "Main", "conversations": [ { "id": "...", "title": "...", "harness": "...", "createdAt": 0, "updatedAt": 0, "events": [], "history": [] } ] },
        { "name": "ui-ws", "branch": "kernl/ui-ws", "conversations": [] }
      ],
      "previews": { "<session>/<file>": "<base64>" }
    }
  ],
  "redacted": { "storedKeys": 0, "keyShaped": 0 }
}
```

### Export (`kernl.exportData`, "kernl: Export data…")

1. Ask what to include: conversations, settings, or both (multi-select pick through `Prompts`).
2. **Conversations:**
   - For each open folder's main workspace and worktree workspaces, list and load the conversations (`SessionStore.list` and `load`).
   - Leave out records with `importedFrom`, which belong to the agent, and empty ones.
   - Collect the `toolPreview` files they point to (D4).
3. **Settings:**
   - Take every `kernl.*` setting from the manifest with a user (`globalValue`) value, minus machine-scoped ones (`kernl.agentCommands`, `kernl.mcpServers`).
   - Derive the list from `package.json` scopes, not a hard-coded list, so a new machine setting is excluded automatically.
4. **Keys:**
   - Load every stored key into the redactor. New `KeyStore.registerAll()` reads each name in `kernl.apiKeyIndex`; new `AgentCredentials.registerAll()` reads each CLI agent's key.
   - Values are only registered, never returned to the caller.
5. **Scrub, then check:**
   - `buildExport()` runs `redactor.scrub` and the key-shaped patterns (D3) over every string in the document except the `previews` image data, and counts replacements. Image data is skipped because base64 can contain key-like letter runs by chance, and replacing them would corrupt the image.
   - It then serializes the document and checks the whole text, image data included, for every registered key. If one occurs, it throws "Export stopped: a stored key was still in the data" and nothing is written.
6. Ask where to save (`showSaveDialog`, default name `kernl-data-YYYY-MM-DD.json`), write the file, and say what was exported, including the redaction counts.

### Import (`kernl.importData`, "kernl: Import data…")

1. Pick the file (`showOpenDialog`). Refuse a file over 500 MB before reading it (a chosen limit, a named constant: about 100 conversations with full image previews).
2. **`parseImport()` validates everything, or stops with an exact message**, for example "Not a kernl data file: format is 'x'" or "conversations[3].events must be an array":
   - format and version (unsupported version: "made by a newer kernl, update kernl to import it");
   - each conversation's shape and id (UUID-like, safe as a file name);
   - each preview path, matched against kernl's existing rule `PREVIEW_FILE` (`src/ui/protocol.ts:91`: one `<session>/<file>` pair, an allowed image type, so no `..`), with a decoded size of at most `PREVIEW_MAX_BYTES` (5 MB);
   - each setting key (a known `kernl.*` setting, not machine-scoped) and its type against the manifest's `type`.
3. **Place conversations:**
   - A folder goes to the open folder with the same name. With no match or several, ask which open folder (or skip).
   - A worktree workspace goes to the open worktree with the same branch; otherwise to that folder's main workspace.
4. **Plan the changes:**
   - conversations to add;
   - conversations skipped because they already exist (D2);
   - settings with their current and imported values (D5);
   - unknown or refused settings, listed.
5. One confirmation through `Prompts.confirm`, listing those counts and the settings changes.
   - Settings that let more run without asking (`kernl.approvals.allow`, `kernl.commandAllowList`) are marked "lets more run without asking".
   - The message says to import only files you made yourself: a conversation's agent history becomes the agent's context when you continue it.
6. **Write:**
   - Previews first, then conversations, through `SessionStore`'s atomic write. Each conversation is saved under the target workspace's key without changing `updatedAt` (a new `SessionStore.saveImported`, since `save` resets `updatedAt` and the title).
   - Settings through `config.update(key, value, ConfigurationTarget.Global)`.
   - Then refresh the Conversations view, and say what was imported.

### Contracts touched

- `SessionStore`: a new `saveImported(workspaceKey, record)` that writes a record as is (validated by the importer).
- `KeyStore` and `AgentCredentials`: new `registerAll()`.
- `package.json`: two commands, placed in the Command Palette and the panel's kernl menu (`3_settings` group).
- No change to existing storage formats.

## Risks and mitigations

| Risk | Likelihood | Impact | Mitigation | How it would be noticed |
| --- | --- | --- | --- | --- |
| A key in the export | Low | High: a leaked credential | Every stored key loaded and scrubbed; key-shaped patterns (D3); a hard check that refuses to write | Unit tests with planted keys; the export summary's counts |
| A secret that matches no pattern (a custom token pasted into a chat) | Medium | Medium | The summary says only stored keys and known key shapes are removed; the guide says to review before sharing | Stated in the confirmation and the guide |
| Pattern redaction changes code in a transcript (false positive) | Low | Low: a transcript shows `[redacted]` | Only fixed, specific prefixes with minimum lengths | Unit tests on near-miss strings |
| A crafted import file writes outside the store | Low | High | Ids and preview paths validated; written only through `SessionStore` paths built with `safeName` | Unit tests with `../` paths and odd ids |
| A crafted import changes a dangerous setting | Low | High (`agentCommands` could run a program) | Machine-scoped settings refused on import too; every change shown before applying | Unit test: a machine setting in the file is refused |
| A huge file | Low | Medium: memory, slow import | 500 MB cap before reading; 5 MB per image | Error message names the size |
| An imported file widens approvals (`kernl.approvals.allow`, `kernl.commandAllowList`) | Low | High: more runs without a card | Those settings are marked in the confirmation | Unit test: the plan marks them |
| An imported agent history carries instructions from someone else's file | Low | Medium | The confirmation says to import only your own files; histories load only when that conversation is continued | Stated in the confirmation and the guide |
| Import while an agent runs | Medium | Low | Only adds new conversation files; the running conversation's file is never touched (D2 skips existing ids) | Suite check imports while idle; unit test for skip |

## Acceptance criteria

- **Export, no stored keys:** given a provider key stored in SecretStorage and that key's text inside a conversation, when M exports, then the file contains `[redacted]` and not the key.
- **Export, no machine settings:** given `kernl.mcpServers` with a header token, when M exports settings, then the file has no `kernl.mcpServers` and no `kernl.agentCommands`.
- **Export, hard check:** given a key the scrub misses (simulated in a test), then the export stops with "Export stopped: a stored key was still in the data" and writes nothing.
- **Import, placement:** given an export from folder "kernl", when M imports into a window with folder "kernl" open at another path, then the conversations show in Conversations for that folder, with their titles and dates.
- **Import, no overwrite:** given a conversation with the same id already present, then it is skipped and counted as skipped (D2 A).
- **Import, settings:** given settings in the file, then M sees each change and nothing is applied before confirming; a machine-scoped or unknown setting is refused and listed.
- **Import, bad file:** given a file with a wrong format, a newer version, a bad id, or a `../` preview path, then the import stops with a message that names the problem, and nothing is written.

## Rollout and rollback

- Ships as 0.11.0 (a new feature). The commands only add files and settings when the user runs them.
- Abort: any failed validation writes nothing.
- Undo an import: imported conversations can be deleted like any other. The confirmation lists the previous value of every changed setting, so it can be set back.

## Parts

### Part 1: export and import core (`src/dataTransfer.ts`)

- [x] `buildExport(input, secrets)`: document, scrub, counts, hard check. Done: unit tests pass for stored-key scrub, patterns, near misses, the hard check, and machine settings left out.
- [x] `parseImport(text, manifest)` and `planImport(doc, here)`: validation and placement plan. Done: unit tests pass for every bad-file case, placement by name, worktree fallback, and the D2 skip.

### Part 2: storage and key-store additions

- [x] `SessionStore.saveImported`, `KeyStore.registerAll`, `AgentCredentials.registerAll`. Done: unit tests show `updatedAt` kept and every stored key registered.

### Part 3: commands, menu, docs

- [x] `kernl.exportData` and `kernl.importData` in the controller (through `Prompts` and the dialogs), the Command Palette, and the panel's kernl menu. Done: suite round-trip check (export, then import into a fresh store, then the conversation is listed; settings applied only after confirm; SecretStorage unchanged).
- [x] Guide (`docs/guides/panel.md`), help page (`docs/guides/help.md`), changelog. Done: both guides describe Export data and Import data with an example; the guide link test passes (the help page test covers slash commands only, `test/unit/helpPage.test.ts:20-22`, and these are palette and menu commands).

### Part 4: real window and release

- [x] Export and import in a real test window with the fake agent. Done: the conversation shows after import, and the file contains no planted key.
- [x] Release 0.11.0 after M's go-ahead.

## Standardized review

### Review: export and import of kernl data (plan)

- **Typed bottom line:** usable after fixes; six findings, four fixed in this plan, two notes kept.
- **Intended outcome:** M can move conversations and settings between machines or back them up, and no export file ever contains an API key.
- **Scope:** this plan file; the code it names (`src/sessions.ts`, `src/providers/keys.ts`, `src/acp/credentials.ts`, `src/log.ts`, `src/acp/acpRunner.ts:375-381`, `src/ui/protocol.ts:90-91`, `test/unit/helpPage.test.ts`, `package.json` settings); VS Code's Settings Sync and contribution-points pages. Not reviewed: VS Code's `showSaveDialog` behavior in remote windows [unverified: a Remote SSH window would save on the remote host].

### Criterion coverage

| Criterion | Verdict | Evidence |
| --- | --- | --- |
| Goal fidelity | pass | Conversations, settings, and "no keys" each have a goal, a design step, and an acceptance criterion |
| Current-system accuracy | violation, fixed | The help page test covers slash commands only (`test/unit/helpPage.test.ts:20-22`); the done condition was corrected. Other claims checked against the cited lines |
| Scope and cohesion | pass | Non-goals exclude keys, checkpoints, per-window state, and agents' own sessions |
| Architecture and dependency direction | pass | A pure module owns building, scrubbing, and validation; the controller only does dialogs and storage, as `clearHistory` does |
| Sequencing and dependencies | pass | Core, then storage additions, then commands, then the real window |
| Completeness | violation, fixed | Preview validation now reuses `PREVIEW_FILE` (`src/ui/protocol.ts:91`) instead of a second rule |
| Failure and recovery | violation, fixed | Pattern redaction over base64 image data could corrupt images; the scrub now skips image data and the hard check still covers it |
| Verification | pass | Each part has an observable done condition; the "no keys" check is a hard failure, not a log line |
| Feasibility and precision | pass | New contracts (`saveImported`, `registerAll`) are named and marked new; `save` resets `title` and `updatedAt` (`src/sessions.ts:147-148`), so the new method is needed |
| Decision readiness | pass | D1 to D5 are open for M with recommendations and completeness |

### Findings

- **Fixed, failure and recovery:** key-shaped pattern redaction would also run over base64 image data, and a chance match (for example `AKIA` plus 16 capitals and digits) would corrupt an image. The scrub now walks the document's strings and skips image data; the stored-key check still covers the whole file.
- **Fixed, current-system accuracy:** "help page test passes (every command is on the page)" was wrong; that test covers slash commands only. The done condition now names what the guides must say.
- **Fixed, single source of truth:** preview paths are validated with the existing `PREVIEW_FILE` rule and `PREVIEW_MAX_BYTES`, not a new pattern.
- **Fixed, security:** an imported `kernl.approvals.allow` or `kernl.commandAllowList` lets more run without a card; the confirmation now marks those settings.
- **Note:** an imported kernl-agent history becomes the agent's context when the conversation is continued; a file from someone else could carry instructions. The confirmation and guide say to import only your own files.
- **Note:** the 500 MB file limit is a chosen number, kept as a named constant.

## Changes made

- `src/dataTransfer.ts` (new): `settingSpecs`, `exportableSettings`, `KEY_SHAPES`, `buildExport` (scrub, counts, hard check), `parseImport`, `matchFolders`, `planImport`, `settingsChanges`.
- `src/log.ts`: `Redactor.leaks()`, the same rule as `scrub()`.
- `src/providers/keys.ts`: `KeyStore.registerAll()`, sharing `clearAll()`'s list of names (`storedNames()`). `src/acp/credentials.ts`: `AgentCredentials.registerAll()`.
- `src/sessions.ts`: `saveImported()` (title and times kept) and `saveImportedPreview()` (checks `PREVIEW_FILE` and the size where it writes).
- `src/controller.ts`: `exportData`, `importData`, `dataFolders`, `exportFolders`; replaceable save and open dialogs for the suite; `testing.sessions` and `testing.useFileDialogs`.
- `src/extension.ts`: the two commands pass on an argument only when it is a `vscode.Uri` (`fileLocation`).
- `package.json`: the two commands, and a `4_data` section in the panel's menu.
- Docs: `docs/guides/panel.md` (section "Moving conversations and settings"), `docs/guides/help.md`, `CHANGELOG.md`.
- Tests: `test/unit/dataTransfer.test.ts` (9), one each in `redaction`, `providers`, `agents`, `sessions`; two suite checks (round trip; started from the menu).
- Deviation: the commands sit in their own menu section (`4_data`, after a divider) instead of the settings section: exporting isn't a setting.
- Deviation: a defect found in the real window. kernl's panel menu passes `{ preserveFocus: false }` to its commands (probe log), which the commands took for a file location; fixed at registration, with a suite check and a recurrence test (reverted, that check failed; restored, it passed).
- Code review (M asked for it before committing): one blocking finding, fixed. A saved event names the workspace it was first shown in, and the panel files events by that name, so an imported conversation opened under another workspace id (a multi-folder window, a tab) showed empty. `WorkspaceRuntime.replay()` now re-labels saved events with the showing workspace; this also fixes the same gap for a conversation from Main opened in a tab. Suite check added; recurrence test: reverted, the check failed on the tab case; restored, it passed.
- Review notes applied: Google's key shape (`AIza…`) added to `KEY_SHAPES`; settings with a fixed list of values (`enum`) refuse other values on import; setting changes compare with object keys sorted. Kept as is: a disk error in the middle of an import leaves the files written so far (all validation happens first).
- Real window (two-folder workspace, fresh profile): importing the single-folder export matched `ws-data` by name, and the conversation (saved as `main`) shows in `folder:ws-data`.
- Verified: unit 427/427; single-folder 103/103; multi-root 7/7.
- Real window (fresh profile): export from the menu wrote the conversation with its token as `[redacted]`, its date kept, and no `kernl.agentCommands`; import from the menu showed "1 conversation to add" and "kernl.tabs.max: 9 → 6", then restored both; Conversations lists it.

## Open questions

- D1 to D5 above.
