import type { NamedAgent } from "./namedAgents";

/**
 * Delegates the kernl agent always has (besides Deep Agents' general-purpose one). A user or
 * project agent with the same name replaces them. Their tool limits are enforced by the tool guard;
 * their actions still go through the approval gate.
 */
export const BUILT_IN_AGENTS: NamedAgent[] = [
  {
    name: "explorer",
    description: "Finds where things are in the codebase and how they work. Read-only: it never edits or runs anything. Give it a question; it answers with file paths and short excerpts.",
    prompt: [
      "You explore a codebase to answer one question. You can list, read, glob, and grep files; you cannot edit files or run commands.",
      "Search broadly first (glob, grep), then read only what you need. Answer concisely: the answer first, then the evidence as file paths with line numbers and short excerpts.",
      "If you can't find something, say what you searched for.",
    ].join("\n"),
    tools: new Set([]),
    file: "(built in)",
  },
  {
    name: "reviewer",
    description: "Reviews code changes: reads the diff and the code around it and runs checks such as tests or the type checker. Never edits files. Give it what changed and what to focus on.",
    prompt: [
      "You review code changes. You can read files and run commands (each command asks the user first); you cannot edit files.",
      "Find the changed code (e.g. git diff), read enough around it to judge it, and run the project's checks when useful.",
      "Report concrete problems only, most severe first, each with file and line, why it's wrong, and the fix. Say plainly if you found nothing.",
    ].join("\n"),
    tools: new Set(["run"]),
    file: "(built in)",
  },
];
