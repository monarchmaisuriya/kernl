import { tool } from "@langchain/core/tools";
import type { ExecuteResponse } from "deepagents";
import { z } from "zod";
import type { ApprovalGate } from "../gate/approvalGate";

/** A command's result as the agent reads it (the same wording as Deep Agents' execute tool). */
export function executeResult(result: ExecuteResponse): string {
  const parts = [result.output];
  if (result.exitCode !== null) parts.push(`\n[Command ${result.exitCode === 0 ? "succeeded" : "failed"} with exit code ${result.exitCode}]`);
  if (result.truncated) parts.push("\n[Output was truncated due to size limits]");
  return parts.join("");
}

/**
 * The CLI agents' command tool: asks through the gate like every kernl command, then runs in the
 * workspace's kernl terminal in VS Code. Cancelling the tool call interrupts the command.
 */
export function runInTerminalTool(gate: ApprovalGate, run: (command: string, signal?: AbortSignal) => Promise<ExecuteResponse>) {
  return tool(
    async ({ command }: { command: string }, config) => {
      if (!(await gate.request({ kind: "execute", command }))) return "rejected by user";
      return executeResult(await run(command, config?.signal));
    },
    {
      name: "run_in_terminal",
      description:
        "Run a shell command in the workspace's terminal in VS Code (the user sees it run) and return its output and exit code. Use it for every command: builds, tests, git, package managers. For a dev server, watcher, or anything that keeps running, use start_background_job instead.",
      schema: z.object({ command: z.string().describe("The shell command, run in the workspace folder") }) as any,
    },
  );
}
