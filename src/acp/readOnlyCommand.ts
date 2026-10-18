// Whether a shell command only looks things up (reads files, searches, lists), so the panel can fold
// it in with the agent's other reads and searches. Strict on purpose: anything that could write a
// file or run another program makes it a plain command. Quotes are respected, so `grep "a|b"` is
// one command.

export type Lookup = "read" | "search";

/** Read-only commands, each with the arguments that would make it write or run something. */
const READ_ONLY: Record<string, { lookup: Lookup; allows(args: string[]): boolean }> = {
  grep: { lookup: "search", allows: () => true },
  rg: { lookup: "search", allows: (a) => !a.some((x) => x === "--pre" || x.startsWith("--pre=")) },
  find: { lookup: "search", allows: (a) => !a.some((x) => /^-(delete|exec|execdir|ok|okdir|fprint|fprint0|fprintf|fls)$/.test(x)) },
  ls: { lookup: "search", allows: () => true },
  cat: { lookup: "read", allows: () => true },
  head: { lookup: "read", allows: () => true },
  tail: { lookup: "read", allows: () => true },
  wc: { lookup: "read", allows: () => true },
  // sed only prints with -n; -i edits in place, and a script's w or e command writes a file or runs one.
  sed: {
    lookup: "read",
    allows: (a) =>
      a.some((x) => /^-[a-zA-Z]*n[a-zA-Z]*$/.test(x)) &&
      !a.some((x) => /^-[a-zA-Z]*i/.test(x) || x.startsWith("--in-place")) &&
      !a.some((x) => /(^|[;{}\s\d/])[wWe](\s|$)/.test(x)),
  },
};

/**
 * The simple commands in a command line (split at |, ||, &&, ;, and newlines), each as its unquoted
 * words; undefined when the line does anything a plain lookup doesn't: redirecting output anywhere
 * but /dev/null (2>&1 is fine), reading a redirect, command substitution, or running in the background.
 */
function simpleCommands(line: string): string[][] | undefined {
  const commands: string[][] = [];
  let words: string[] = [];
  let word = "";
  let inWord = false;
  let quote: "'" | '"' | undefined;
  const endWord = () => {
    if (inWord) words.push(word);
    word = "";
    inWord = false;
  };
  const endCommand = () => {
    endWord();
    if (words.length) commands.push(words);
    words = [];
  };
  for (let i = 0; i < line.length; i++) {
    const c = line[i];
    if (quote) {
      if (c === quote) quote = undefined;
      else if (quote === '"' && (c === "`" || (c === "$" && line[i + 1] === "("))) return undefined;
      else if (quote === '"' && c === "\\") word += line[++i] ?? "";
      else word += c;
      continue;
    }
    if (c === "'" || c === '"') {
      quote = c;
      inWord = true;
    } else if (c === "\\") {
      word += line[++i] ?? "";
      inWord = true;
    } else if (c === "`" || c === "<" || (c === "$" && line[i + 1] === "(")) {
      return undefined;
    } else if (c === ">" || (c === "&" && line[i + 1] === ">")) {
      // Only throwing output away: 2>/dev/null, >/dev/null, &>/dev/null, 2>&1.
      if (inWord && !/^\d$/.test(word)) return undefined;
      word = "";
      inWord = false;
      if (c === "&") i++;
      if (line[i + 1] === ">") i++;
      const target = /^\s*(\/dev\/null|&[12])(?=$|[\s;|&])/.exec(line.slice(i + 1));
      if (!target) return undefined;
      i += target[0].length;
    } else if (c === "&") {
      if (line[i + 1] !== "&") return undefined; // a lone & runs in the background
      endCommand();
      i++;
    } else if (c === "|") {
      endCommand();
      if (line[i + 1] === "|") i++;
    } else if (c === ";" || c === "\n") {
      endCommand();
    } else if (c === " " || c === "\t") {
      endWord();
    } else {
      word += c;
      inWord = true;
    }
  }
  if (quote) return undefined;
  endCommand();
  return commands;
}

/** Harmless between lookups but not lookups themselves: changing folder, printing a separator. */
const PASSIVE = new Set(["cd", "echo"]);

/**
 * "read" or "search" when every command in the line is a read-only lookup (a `cd` or `echo` between
 * them is fine); the first lookup decides which. Undefined for anything else.
 */
export function lookupKind(line: string): Lookup | undefined {
  const commands = simpleCommands(line);
  let lookup: Lookup | undefined;
  for (const [name, ...args] of commands ?? []) {
    if (PASSIVE.has(name)) continue;
    const known = READ_ONLY[name];
    if (!known?.allows(args)) return undefined;
    lookup ??= known.lookup;
  }
  return lookup;
}
