// What real runs report about connections, applied to the monitor. A run's answer is the strongest
// evidence there is: "authentication required" from an agent, a provider refusing a key, an MCP server
// that didn't start. These land at once, without waiting for the next status check.
import type { ConnectionSignal } from "../acp/acpRunner";
import { type CliAgentId, isCliAgentId } from "../acp/agents";
import { agentLabel } from "./agentChecks";
import type { ConnectionMonitor } from "./monitor";
import type { ConnectionState, ConnectionStatus } from "./types";

/** A run's connection news: an ACP agent's signals, kernl's provider answer, kernl's MCP connects. */
export type RuntimeConnectionSignal =
  | ConnectionSignal
  /** kernl's own agent heard from its model provider; `rejected`: the HTTP status when it refused the key. */
  | { type: "provider"; rejected?: number }
  /** kernl's agent connected its MCP servers: each one connected (with its tool count), needs a sign-in, failed, or wasn't allowed. */
  | { type: "kernlMcp"; servers: { name: string; origin: string; state: Extract<ConnectionState, "ready" | "needsAction" | "failed" | "off">; detail: string }[] };

export interface SignalContext {
  now(): number;
  /** kernl's current provider id ("anthropic", "custom:groq"). */
  provider: string;
  /** Check this agent's login again (a status push said it changed). */
  recheck(agent: CliAgentId): void;
}

const fromRun = (s: Omit<ConnectionStatus, "source" | "checkedAt">, now: number): ConnectionStatus => ({ ...s, source: "last run", checkedAt: now });

export function applySignal(m: ConnectionMonitor, signal: RuntimeConnectionSignal, harness: string, ctx: SignalContext) {
  const now = ctx.now();
  if (signal.type === "provider") {
    const id = `key:${ctx.provider}`;
    if (!signal.rejected) return m.clearRunFailure(id);
    return m.report(
      fromRun(
        { id, kind: "providerKey", owner: "kernl", label: `${ctx.provider} key`, state: "needsAction", detail: `${ctx.provider} refused the stored key (HTTP ${signal.rejected})`, fix: { label: "Set key", action: "setKey", target: ctx.provider } },
        now,
      ),
    );
  }
  if (signal.type === "kernlMcp") {
    const rows = signal.servers.map(
      (s): ConnectionStatus => ({ id: `mcp:kernl:${s.name}`, kind: "mcp", owner: "kernl", label: s.name, state: s.state, detail: `${s.detail} · ${s.origin}`, source: "kernl agent", checkedAt: now }),
    );
    return void m.check("mcp:kernl", async () => rows);
  }
  if (!isCliAgentId(harness)) return;
  const label = agentLabel(harness);
  const agentId = `agent:${harness}`;
  const login = { label: "Log in", action: "login" as const, target: harness };
  switch (signal.type) {
    case "authRequired":
      return m.report(fromRun({ id: agentId, kind: "agent", owner: label, label, state: "needsAction", detail: `${label} asked for a login when kernl ran it: ${signal.message}`, fix: login }, now));
    case "authStatus":
      if (signal.kind === "none") return m.report(fromRun({ id: agentId, kind: "agent", owner: label, label, state: "needsAction", detail: `${label} says it isn't logged in`, fix: login }, now));
      // Logged in by its account (claude-agent-acp builds this from `auth status --json`, which can't see
      // an expired login): check again with the status commands, which can.
      return ctx.recheck(harness);
    case "mcpStartupFailed":
      return m.report(
        fromRun({ id: `mcp:${harness}:${signal.server}`, kind: "mcp", owner: label, label: signal.server, state: "failed", detail: `Didn't start: ${signal.error}`, fix: { label: "Check now", action: "check", target: `mcp:${harness}` } }, now),
      );
    case "runSucceeded":
      return m.clearRunFailure(agentId);
  }
}
