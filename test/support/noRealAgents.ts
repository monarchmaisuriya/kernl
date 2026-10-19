// The VS Code suites never start a real CLI agent (which would use the machine's logins and spend
// tokens): every kernl.agentCommands they set points each agent at a command that doesn't exist,
// unless the check gives it a fake.
const missing = (agent: string) => ({ command: `/nonexistent/kernl-tests-no-real-${agent}`, args: [] });

export const NO_REAL_AGENTS = { "claude-code": missing("claude"), codex: missing("codex"), opencode: missing("opencode") };

/** kernl.agentCommands for a check: its own commands, and missing ones for every other agent. */
export function agentCommands(commands: Record<string, unknown> = {}): Record<string, unknown> {
  return { ...NO_REAL_AGENTS, ...commands };
}
