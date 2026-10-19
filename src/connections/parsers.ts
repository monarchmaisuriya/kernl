// Each CLI's status output as a connection state, matched against outputs recorded from Claude Code
// 2.1.303, Codex 0.163.0, and OpenCode 2.0.32 (test/unit/connectionParsers.test.ts). Output a parser
// can't read is "unknown", never "needsAction": a changed CLI must not lock anyone out.
import type { CommandResult } from "./statusCommands";
import type { ConnectionState } from "./types";

export interface Parsed {
  state: ConnectionState;
  detail: string;
}

/** A server or plugin line from an agent's list. */
export interface ListedItem extends Parsed {
  name: string;
}

const unreadable = (command: string, r: CommandResult): Parsed => ({
  state: "unknown",
  detail: r.timedOut ? `\`${command}\` didn't answer in time` : `couldn't read \`${command}\`${firstLine(r.output) ? `: ${firstLine(r.output)}` : ""}`,
});

const firstLine = (text: string) => text.trim().split("\n")[0]?.slice(0, 200) ?? "";

const CLAUDE_METHODS: Record<string, string> = {
  "claude.ai": "claude.ai login",
  api_key: "API key",
  api_key_helper: "API key from apiKeyHelper",
  oauth_token: "OAuth token",
  third_party: "cloud provider",
};

/**
 * Claude Code's login from `claude auth status --json` (method, plan) and `--text` (the only one
 * that says a stored login has expired: `--json` still reports an expired login as logged in).
 */
export function parseClaudeAuth(json: CommandResult, text: CommandResult): Parsed {
  let status: any;
  try {
    status = JSON.parse(json.output);
  } catch {
    return unreadable("claude auth status --json", json);
  }
  if (typeof status?.loggedIn !== "boolean") return unreadable("claude auth status --json", json);
  const expired = /Login:\s*Expired/i.test(text.output);
  if (!status.loggedIn || expired) {
    return { state: "needsAction", detail: expired ? "Claude Code's login has expired: log in again" : "Claude Code isn't logged in" };
  }
  const method = CLAUDE_METHODS[status.authMethod] ?? String(status.authMethod ?? "logged in");
  const extra = status.authMethod === "third_party" && status.apiProvider ? ` (${status.apiProvider})` : status.subscriptionType ? ` (${status.subscriptionType})` : "";
  return { state: "ready", detail: `Logged in: ${method}${extra}` };
}

/** `codex login status`: "Logged in using ChatGPT" (exit 0) or "Not logged in" (exit 1). */
export function parseCodexLogin(r: CommandResult): Parsed {
  const logged = /Logged in using (.+)/.exec(r.output);
  if (logged) return { state: "ready", detail: `Logged in using ${logged[1].trim().replace(/\s*-\s*$/, "")}` };
  if (/Not logged in/i.test(r.output)) return { state: "needsAction", detail: "Codex isn't logged in" };
  return unreadable("codex login status", r);
}

/**
 * `opencode auth list --format json`: the integrations OpenCode has logged in to. OpenCode also runs on
 * its own free models and on providers set up in its config, so no integrations is still usable.
 */
export function parseOpencodeAuth(r: CommandResult): Parsed {
  let list: unknown;
  try {
    list = JSON.parse(r.output);
  } catch {
    return unreadable("opencode auth list", r);
  }
  if (!Array.isArray(list)) return unreadable("opencode auth list", r);
  const names = list.map((i: any) => String(i?.label ?? i?.id ?? i?.integration ?? i?.name ?? "")).filter(Boolean);
  return { state: "ready", detail: names.length ? `Logged in to ${names.join(", ")}` : "No logins: uses OpenCode's own models and the providers in its config" };
}

const CLAUDE_MCP_STATES: [RegExp, ConnectionState][] = [
  [/^✔/, "ready"],
  [/^! Needs authentication/, "needsAction"],
  [/^!/, "failed"],
  [/^✘/, "failed"],
  [/^⏸/, "needsAction"],
  [/^⊘/, "off"],
];

/**
 * `claude mcp list` (it connects to each server): one line per server,
 * `<name>: <url> (HTTP) - ✔ Connected` or `<name>: <command> <args> - ✘ Failed to connect — <issue>`.
 */
export function parseClaudeMcpList(r: CommandResult): ListedItem[] | Parsed {
  if (/No MCP servers configured/.test(r.output)) return [];
  const items: ListedItem[] = [];
  for (const line of r.output.split("\n")) {
    const m = /^(.+?): (.*) - ([✔!✘⏸⊘-] .+)$/.exec(line.trim());
    if (!m) continue;
    const status = m[3];
    const state = CLAUDE_MCP_STATES.find(([re]) => re.test(status))?.[1] ?? "unknown";
    items.push({ name: m[1], state, detail: status.replace(/^[✔!✘⏸⊘-]\s*/, "").replace(/\s+—\s+/, ": ") });
  }
  return items.length || /Checking MCP server health/.test(r.output) ? items : unreadable("claude mcp list", r);
}

/** `codex mcp list --json`: configured servers only (Codex starts them when a session opens). */
export function parseCodexMcpList(r: CommandResult): ListedItem[] | Parsed {
  let list: unknown;
  try {
    list = JSON.parse(r.output);
  } catch {
    return unreadable("codex mcp list --json", r);
  }
  if (!Array.isArray(list)) return unreadable("codex mcp list --json", r);
  return list.map((s: any) =>
    s?.enabled === false
      ? { name: String(s?.name), state: "off" as const, detail: `Turned off${s?.disabled_reason ? `: ${s.disabled_reason}` : ""}` }
      : { name: String(s?.name), state: "unknown" as const, detail: "Configured; Codex starts it when a session opens" },
  );
}

const OPENCODE_MCP: [RegExp, ConnectionState][] = [
  [/^✓\s+(\S+)\s*(.*)$/, "ready"],
  [/^⚠\s+(\S+)\s*(.*)$/, "needsAction"],
  [/^✗\s+(\S+)\s*(.*)$/, "failed"],
  [/^○\s+(\S+)\s*(.*)$/, "unknown"],
];

/** `opencode mcp list`: `✓ name connected`, `⚠ name needs authentication`, `✗ name failed: <error>`, `○ name <status>`. */
export function parseOpencodeMcpList(r: CommandResult): ListedItem[] | Parsed {
  if (/No MCP servers configured/.test(r.output)) return [];
  const items: ListedItem[] = [];
  for (const line of r.output.split("\n")) {
    for (const [re, state] of OPENCODE_MCP) {
      const m = re.exec(line.trim());
      if (m) {
        items.push({ name: m[1], state, detail: m[2].trim() || state });
        break;
      }
    }
  }
  return items.length ? items : unreadable("opencode mcp list", r);
}

/** `claude plugin list --json`: installed plugins, enabled or not. */
export function parseClaudePlugins(r: CommandResult): (ListedItem & { installPath?: string })[] | Parsed {
  let list: unknown;
  try {
    list = JSON.parse(r.output);
  } catch {
    return unreadable("claude plugin list --json", r);
  }
  if (!Array.isArray(list)) return unreadable("claude plugin list --json", r);
  return list.map((p: any) => {
    const servers = p?.mcpServers && typeof p.mcpServers === "object" ? Object.keys(p.mcpServers) : [];
    const what = [p?.version ? `version ${p.version}` : "", servers.length ? `MCP: ${servers.join(", ")}` : ""].filter(Boolean).join(" · ");
    return {
      name: String(p?.id ?? "plugin"),
      state: p?.enabled === false ? ("off" as const) : ("ready" as const),
      detail: `${p?.enabled === false ? "Installed, turned off" : "Enabled"}${what ? ` · ${what}` : ""}`,
      installPath: typeof p?.installPath === "string" ? p.installPath : undefined,
    };
  });
}
