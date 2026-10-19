import { type StructuredToolInterface, tool } from "@langchain/core/tools";
import type { ApprovalGate } from "./approvalGate";

export type ToolRule = "ask" | "allow";
const RULE = Symbol.for("kernl.toolRule");

/**
 * The only way custom tools (browser, MCP) are handed to the agent. "ask" tools call the gate
 * before running; "allow" tools are read-only. Tool failures come back to the model as the
 * tool's result. The rule is stamped on the tool so a registry test can prove no custom tool
 * skipped this function. `shownArgs` adds what the user should see on the approval card beyond the
 * agent's own arguments (the element a browser ref really names on the page).
 */
export function gatedTool(inner: StructuredToolInterface, gate: ApprovalGate, rule: ToolRule, shownArgs?: (args: any) => unknown) {
  const wrapped = tool(
    async (args: unknown, config) => {
      if (rule === "ask" && !(await gate.request({ kind: "tool", tool: inner.name, args: shownArgs ? shownArgs(args) : args }))) return "rejected by user";
      try {
        return await inner.invoke(args as any, config);
      } catch (err: any) {
        if (config?.signal?.aborted) throw err;
        // A failing tool (missing element, page timeout, MCP server error) is the tool's result:
        // the model sees it and can adjust, instead of the whole run crashing.
        return `Error from ${inner.name}: ${err?.message ?? String(err)}`;
      }
    },
    { name: inner.name, description: inner.description, schema: inner.schema as any },
  );
  (wrapped as any)[RULE] = rule;
  return wrapped;
}

export function toolRule(t: unknown): ToolRule | undefined {
  return (t as any)?.[RULE];
}
