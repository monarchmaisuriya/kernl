# Archive and unarchive conversations

- Date: 2026-10-24 06:40
- Status: handed to plan
- Mode: explore options
- Repos: kernl   Folders: `src/sessions.ts`, `src/controller.ts`, `src/ui/conversationRows.ts`, `src/webview/conversations.ts`, `src/dataTransfer.ts`
- Question / problem: How should kernl let people archive a conversation (hide it from Conversations without deleting it) and unarchive it again?

## Options: hide finished conversations from Conversations, keep them, and bring them back on demand

- **Bottom line:** Use the pattern VS Code, ChatGPT and Cursor share. Each conversation row in Conversations gets an Archive button. Archived conversations go to an "Archived" group at the bottom, where Unarchive puts them back. Store the state as an `archivedAt` time on the conversation's own file, so Export and Import carry it with no extra work.
- **Where we are:** Framing is done, the code paths are read, and 3 products were compared. The next step is the plan.
- **Need from M:** Pick an option (and answer the plan's open questions).

### The problem, framed

- **What:** A per-conversation Archive and Unarchive action in kernl's Conversations view.
- **Why:** The list grows with every conversation, and today the only way to shorten it is **Delete conversations**, which deletes all of them [verified: `src/controller.ts` `clearHistory`]. There's no per-conversation delete or hide [verified: no `remove` caller outside `clear`; `grep -rn "sessions.remove" src` finds none].
- **Who:** Anyone with many conversations in a folder.
- **When:** Whenever a conversation is finished but worth keeping.
- **Where:** The Conversations view (the clock icon) [verified: `src/webview/conversations.ts`], its rows (`src/ui/conversationRows.ts`), and the store (`src/sessions.ts`).
- **Which:** The existing conversation files, one JSON file per conversation per workspace [verified: `src/sessions.ts:143-151`].
- **How:** Hover a row and click Archive. The row moves to "Archived". Unarchive moves it back.
- **How much:** About 6 files, plus tests and docs. Nothing is deleted.

### What must be true

- **Hard constraint:** archiving never deletes or edits the transcript [verified as the shared behavior: [VS Code docs](https://code.visualstudio.com/docs/chat/chat-sessions) say archiving "does not delete it"].
- **Hard constraint:** a conversation's order (`updatedAt`) doesn't change on archive. `save()` sets `updatedAt = Date.now()` [verified: `src/sessions.ts:148`], so archiving can't go through `save()`.
- **Hard constraint:** an open conversation's tab keeps its record in memory and saves it again after each run [verified: `src/workspaceRuntime.ts` `saveSession`]. Any flag written behind its back would be overwritten. The tab must let go of the conversation first.
- **Hard constraint:** an archived conversation that continues a CLI agent's session must still hide that session from "sessions not opened in kernl" [verified: `src/ui/conversationRows.ts:58` builds `linked` from kept conversations].
- **Convention:** the panel uses `createElement` and `textContent` only [verified: `src/webview/conversations.ts:1-4`]. A row is a `<button>` today, so a second button can't sit inside it. The row needs a container.
- **Unverified:** whether one conversation can be open in two tabs at once. `openConversation` only refuses the same tab [verified: `src/controller.ts:1166`]. Check: a suite test opening one conversation in two tabs.

### What others do

| Aspect | VS Code chat | ChatGPT | Cursor |
| --- | --- | --- | --- |
| Where the action is | Hover a session, Archive | Chat's menu, Archive | Hover or right-click |
| Where archived ones go | Out of the list; an Archived filter shows them | Settings, Data controls, Archived chats | Archived filter or a collapsed Archived section at the bottom |
| Unarchive | Same hover action | Unarchive in that list | Restore on hover |
| Deleted? | No | No | No |
| Other features | "Archived sessions are excluded from listings unless explicitly requested" | Archived chats stay searchable (secondary source) | Users reported "Archive All" hiding everything, and search not finding it |
| Evidence | [primary: VS Code docs](https://code.visualstudio.com/docs/chat/chat-sessions) | [secondary: OpenAI help, via search; the page returned 403 to a direct fetch](https://help.openai.com/en/articles/8809935-deleting-and-archiving-chats-in-chatgpt) | [tertiary: Cursor forum](https://forum.cursor.com/t/how-to-unarchive-a-chat-in-the-newest-agents-interface/157523), [forum](https://forum.cursor.com/t/archive-all-caused-all-agent-chats-to-disappear-from-the-agents-sidebar/167312) |

What this means for kernl: all three keep the data, hide it from the main list, and restore it with the same action. Cursor's complaint is the risk: an archived item you can't find feels deleted. So the Archived group should be visible in the same view, and search should find archived conversations.

### Options

| | A: `archivedAt` on the conversation's file (recommended) | B: a separate archived list per workspace |
| --- | --- | --- |
| How it works | `SessionRecord.archivedAt?: number`, written by a new `SessionStore.setArchived` that keeps `updatedAt`. `list()` returns it in the summary | `archived/<workspace>.json` maps conversation id to time. `list()` joins it in |
| Codebase fit | Same pattern as `forkOf` and `agentTitle` [verified: `src/sessions.ts:22-26`]. Export copies records as they are, and Import already passes extra fields through [verified: `src/dataTransfer.ts:160-172`] | A second file to keep in step: `clear()`, Export and Import all need new code |
| Cost and blast radius | One field and one store method. Import validates the field's type | New file format, a join, and export and import changes |
| When it fails | If a tab still holds the record, its next save drops the flag. Avoided by letting the tab go first (a constraint above) | A conversation deleted without the list being updated leaves a stale id (harmless) |
| Single source of truth | Yes: the conversation's own file | Two places describe one conversation |
| Completeness | 9/10 | 7/10 |

### Flow of the recommended option

```
Conversations row  ──Archive──>  panel sends { archiveConversation, workspace, id }
host: every tab showing that conversation ──> (working? ask, stop) ──> starts a new conversation   <-- lets go of the record
host: sessions.setArchived(key, id, now)   (updatedAt unchanged)
host: re-sends the rows ──> row moves to "Archived" at the bottom
Archived row ──Unarchive──> setArchived(key, id, undefined) ──> back in place by updatedAt
```

### Recommendation

RECOMMENDATION: A, because the conversation's own file stays the single source of truth, and Export and Import already carry its fields.

### Sources

- [Work with chat sessions in VS Code](https://code.visualstudio.com/docs/chat/chat-sessions)
- [Deleting and archiving chats in ChatGPT (OpenAI Help)](https://help.openai.com/en/articles/8809935-deleting-and-archiving-chats-in-chatgpt)
- [How to unarchive a chat in the newest agents interface? (Cursor forum)](https://forum.cursor.com/t/how-to-unarchive-a-chat-in-the-newest-agents-interface/157523)
- [Archive All caused all Agent chats to disappear from the Agents sidebar (Cursor forum)](https://forum.cursor.com/t/archive-all-caused-all-agent-chats-to-disappear-from-the-agents-sidebar/167312)

## Standardized review

**Bottom line:** research, approve with notes. The options are compared on the same criteria, and the recommendation follows from verified code facts. The product comparison is used only for the expected interaction, and its evidence tiers are labeled.

| Criterion | Verdict | Evidence |
| --- | --- | --- |
| Question and decision fit | pass | One question; it feeds the plan's storage and UI decision |
| Method | pass | Code first (6 files read), then 3 products |
| Source quality | pass with note | One primary source (VS Code docs, fetched). ChatGPT's page returned 403, so its row rests on a search summary, labeled secondary. Cursor is forum only, labeled tertiary |
| Coverage and alternatives | pass | Two storage options; the status quo (Delete conversations only) is stated as the problem |
| Claim traceability | pass | Each code claim cites file:line |
| Evidence handling | pass | The two-tabs question is marked unverified, with a check |
| Analysis quality | pass | Same criteria for A and B |
| Codebase fit | pass | Export, Import, CLI-session dedupe and the save race are covered |
| Uncertainty and limits | pass | Source tiers are stated |
| Recommendation proportionality | pass | A rests on verified store and import behavior, not on the product survey |
| Reproducibility | pass | Files and URLs are listed |

Findings:
- **Note, source quality:** the ChatGPT "searchable" claim is secondary, but it only supports a UI choice (search includes archived), which M decides anyway.
- **Note, must-verify in the plan:** whether one conversation can be open in two tabs. Archive must handle every tab showing it either way.
