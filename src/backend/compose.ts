import { type AnyBackendProtocol, CompositeBackend, StateBackend } from "deepagents";

/** Where Deep Agents keeps its own scratch files (offloaded tool output, evicted history). */
export const HARNESS_SCRATCH_PREFIXES = ["/large_tool_results/", "/conversation_history/"];

/**
 * Scratch paths live in agent memory: never on disk, never shown for approval. `extraRoutes` adds
 * other folders under a path prefix (the user's skill folders, read-only). Everything else is the workspace.
 */
export function composeBackend(workspace: AnyBackendProtocol, extraRoutes: Record<string, AnyBackendProtocol> = {}) {
  const routes = Object.fromEntries(HARNESS_SCRATCH_PREFIXES.map((prefix) => [prefix, new StateBackend()]));
  return new CompositeBackend(workspace, { ...routes, ...extraRoutes });
}
