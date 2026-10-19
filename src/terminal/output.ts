const ESCAPES = /\x1b\[[0-?]*[ -/]*[@-~]|\x1b\][^\x07\x1b]*(?:\x07|\x1b\\)|\x1b[@-Z\\-_]/g;

/**
 * Turns raw terminal bytes into what the model should read: no escape sequences, no carriage
 * returns (a bare \r redraws the line, so only the last segment counts), and no zsh "%"
 * partial-line marker. Keeps the last `maxChars` characters.
 */
export function cleanTerminalOutput(raw: string, maxChars = 30_000): { text: string; truncated: boolean } {
  const lines = raw
    .replace(ESCAPES, "")
    .replace(/\r\n/g, "\n")
    .split("\n")
    .map((line) => line.split("\r").pop() ?? "")
    .filter((line) => !/^%\s*$/.test(line));
  const text = lines.join("\n").trim();
  if (text.length <= maxChars) return { text, truncated: false };
  return { text: `[earlier output truncated]\n${text.slice(-maxChars)}`, truncated: true };
}

/** Agent commands run with no pager: `git log` or `man` would otherwise wait in `less` for a key the agent can't press. */
export const NO_PAGER = { PAGER: "cat", GIT_PAGER: "cat" };
