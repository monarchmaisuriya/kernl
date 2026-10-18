export type EditOutcome = { text: string; occurrences: number } | { error: string };

/**
 * The one function that turns (current text, old, new) into the new file text. Its output is
 * both what the user sees in the diff and what gets written, so the two cannot differ.
 * Same rules as Deep Agents' edit_file: exact match; 0 matches or (without replaceAll) several matches is an error.
 */
export function applyStringEdit(current: string, oldString: string, newString: string, replaceAll = false): EditOutcome {
  if (oldString === "") return { error: "Expected a non-empty old_string to replace" };
  const occurrences = current.split(oldString).length - 1;
  if (occurrences === 0) return { error: `String not found in file: ${JSON.stringify(oldString.slice(0, 80))}` };
  if (occurrences > 1 && !replaceAll) {
    return { error: `Found ${occurrences} matches of old_string; add surrounding context to make it unique, or set replace_all` };
  }
  return { text: current.split(oldString).join(newString), occurrences: replaceAll ? occurrences : 1 };
}
