import type { RunnableConfig } from "@langchain/core/runnables";
import { LangChainTracer } from "@langchain/core/tracers/tracer_langchain";

// Accepts runs and sends them nowhere.
const discardingClient = { createRun: async () => {}, updateRun: async () => {} };

/**
 * Run config that keeps an agent run untraced, whatever the user's environment says.
 *
 * With LANGSMITH_TRACING / LANGCHAIN_TRACING_V2 set, LangChain attaches a LangSmith tracer to
 * every step unless one named "langchain_tracer" is already present. This config supplies that
 * tracer with a client that discards runs, so nothing leaves the machine. Callbacks are inherited
 * by every nested step and subagent. We never change process.env: the extension host is shared.
 * Guarded by test/unit/tracing.test.ts (control run must trace, untraced run must not).
 */
export function untracedRunConfig(): Pick<RunnableConfig, "callbacks"> {
  return { callbacks: [new LangChainTracer({ client: discardingClient })] };
}
