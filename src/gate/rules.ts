import type { GateRequest } from "./approvalGate";

/**
 * Approval rules from the user's settings: `run(npm test *)`, `edit(src/**)`, `delete(tmp/**)`,
 * `read(.env*)`, `tool(browser_*)`. Deny beats ask beats allow; no match means ask. The only way to
 * skip a card is an allow rule, and an allow rule never matches a command with shell operators,
 * so a rule that fails to match (or a deny that misses another form of a command) can only lead to a card.
 */
export type Verdict = "allow" | "ask" | "deny";
type RuleKind = "run" | "edit" | "delete" | "read" | "tool";

export interface Rule {
  verdict: Verdict;
  kind: RuleKind;
  /** As written, e.g. `run(npm test *)`; shown when a deny refuses something. */
  text: string;
  matches(subject: string): boolean;
}

export interface RuleLists {
  allow?: unknown;
  ask?: unknown;
  deny?: unknown;
}

// Any of these lets one "allowed" command chain or redirect into another.
const SHELL_OPERATORS = /[;&|`<>\n\r]|\$\(/;
const RULE = /^(run|edit|delete|read|tool)\((.+)\)$/s;
const escape = (s: string) => s.replace(/[.+^${}()|[\]\\?]/g, "\\$&");

/** `*` is any text. A trailing ` *` also matches nothing at all, so `run(npm test *)` covers a bare `npm test`. */
function wildcard(pattern: string): RegExp {
  const optionalArgs = pattern.endsWith(" *");
  const body = (optionalArgs ? pattern.slice(0, -2) : pattern).split("*").map(escape).join(".*");
  return new RegExp(`^${body}${optionalArgs ? "(?: .*)?" : ""}$`, "s");
}

/** Workspace-relative path globs: `**` any depth, `*` within one segment. */
function pathGlob(pattern: string): RegExp {
  const clean = pattern.replace(/^\.?\//, "");
  let out = "";
  for (let i = 0; i < clean.length; i++) {
    if (clean.startsWith("**/", i)) (out += "(?:.*/)?"), (i += 2);
    else if (clean.startsWith("**", i)) (out += ".*"), (i += 1);
    else if (clean[i] === "*") out += "[^/]*";
    else out += escape(clean[i]);
  }
  return new RegExp(`^${out}$`);
}

/** Parses the three lists plus the deprecated exact-match command list. Bad entries are skipped and reported. */
export function parseRules(lists: RuleLists, legacyAllowList: unknown = []): { rules: Rule[]; problems: string[] } {
  const rules: Rule[] = [];
  const problems: string[] = [];
  for (const verdict of ["deny", "ask", "allow"] as const) {
    const list = lists[verdict] ?? [];
    if (!Array.isArray(list)) {
      problems.push(`Expected yourstack.approvals.${verdict} to be a list of rules, got ${JSON.stringify(list)}`);
      continue;
    }
    for (const entry of list) {
      const m = typeof entry === "string" ? RULE.exec(entry.trim()) : null;
      if (!m || !m[2].trim()) {
        problems.push(`Expected a rule like run(npm test *) or edit(src/**) in yourstack.approvals.${verdict}, got ${JSON.stringify(entry)}`);
        continue;
      }
      const kind = m[1] as RuleKind;
      const pattern = m[2].trim();
      const regex = kind === "run" || kind === "tool" ? wildcard(pattern) : pathGlob(pattern);
      rules.push({ verdict, kind, text: `${kind}(${pattern})`, matches: (s) => regex.test(s) });
    }
  }
  for (const command of Array.isArray(legacyAllowList) ? legacyAllowList : []) {
    if (typeof command !== "string" || !command.trim()) continue;
    const exact = command.trim();
    rules.push({ verdict: "allow", kind: "run", text: `run(${exact}) from yourstack.commandAllowList`, matches: (s) => s === exact });
  }
  return { rules, problems };
}

/** What a rule matches for this request, or undefined when rules don't apply (CLI agents ask through ACP). */
function subject(request: GateRequest): { kind: RuleKind; value: string } | undefined {
  switch (request.kind) {
    case "execute":
      return { kind: "run", value: request.command.trim() };
    case "edit":
    case "write":
      return { kind: "edit", value: request.path.replace(/^\/+/, "") };
    case "delete":
      return { kind: "delete", value: request.path.replace(/^\/+/, "") };
    case "read":
      return { kind: "read", value: request.path.replace(/^\/+/, "") };
    case "tool":
      return { kind: "tool", value: request.tool };
    case "agent":
      return undefined;
  }
}

export function decide(request: GateRequest, rules: readonly Rule[]): { verdict: Verdict; rule?: Rule } {
  const s = subject(request);
  if (!s) return { verdict: "ask" };
  for (const verdict of ["deny", "ask", "allow"] as const) {
    if (verdict === "allow" && s.kind === "run" && SHELL_OPERATORS.test(s.value)) continue;
    const rule = rules.find((r) => r.verdict === verdict && r.kind === s.kind && r.matches(s.value));
    if (rule) return { verdict, rule };
  }
  return { verdict: "ask" };
}
