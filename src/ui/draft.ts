// The unsent message, kept per window so a restart or reload doesn't lose it (see the panel's saveDraft).
import type { Attachment } from "./protocol";

/** Text attachments (pasted or dropped file contents) beyond this many characters in total aren't kept in the draft. */
export const DRAFT_TEXT_LIMIT = 50_000;

export interface Draft {
  text: string;
  attachments: Attachment[];
}

/**
 * What to keep of a draft: undefined when there's nothing to keep (sent or cleared); text attachments
 * that would push the total past DRAFT_TEXT_LIMIT are left out (`dropped` says how many).
 */
export function draftToKeep(text: string, attachments: readonly Attachment[]): { draft?: Draft; dropped: number } {
  let room = DRAFT_TEXT_LIMIT;
  let dropped = 0;
  const kept = attachments.filter((a) => {
    if (a.kind !== "text") return true;
    const size = a.text?.length ?? 0;
    if (size > room) return void dropped++, false;
    room -= size;
    return true;
  });
  if (!text.trim() && !kept.length) return { dropped };
  return { draft: { text, attachments: kept }, dropped };
}
