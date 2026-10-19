// One status per connection kernl depends on: each CLI agent's login, kernl's provider keys and the
// agents' stored keys, every agent's MCP servers (claude.ai connectors arrive as Claude Code MCP
// servers), and Claude Code plugins. The connection monitor owns them; the agent chip, the agent menu,
// and the Connections view only read them.

export type ConnectionKind = "agent" | "providerKey" | "agentKey" | "mcp" | "plugin";

/**
 * ready: works as far as kernl can tell. needsAction: definitely not usable until the user does
 * something (log in, set a key). failed: tried and broke (a server that won't connect). unknown: kernl
 * can't tell (never blocks). off: turned off or disabled. A check in progress doesn't change the state
 * (see `checking`): decisions keep using the last known one.
 */
export type ConnectionState = "ready" | "needsAction" | "failed" | "unknown" | "off";

export type FixAction = "login" | "setKey" | "check" | "openSettings" | "showSources";

export interface ConnectionStatus {
  /** "agent:claude-code", "key:anthropic", "agentKey:codex", "mcp:claude-code:notion", "plugin:claude-code:render". */
  id: string;
  kind: ConnectionKind;
  /** Whose connection it is: "kernl", "Claude Code", "Codex", "OpenCode". */
  owner: string;
  label: string;
  state: ConnectionState;
  /** What the source said, in words. Never a secret. */
  detail: string;
  /** Where the status came from: "claude auth status", "last run", "key check", "claude mcp list". */
  source: string;
  /** When it was last checked (ms since epoch). */
  checkedAt: number;
  /** A check is running; `state` is still the last known one until it finishes. */
  checking?: boolean;
  fix?: { label: string; action: FixAction; target: string };
}

/** Not usable until the user acts: the states that make the agent chip warn. */
export const blocks = (s: Pick<ConnectionStatus, "state">) => s.state === "needsAction" || s.state === "failed";
