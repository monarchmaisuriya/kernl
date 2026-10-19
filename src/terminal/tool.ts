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
        "Run a shell command in the workspace's terminal in VS Code (the user sees it run) and return its output and exit code. Use it for every command: builds, tests, git, package managers. For a dev server, watcher, or anything that keeps running, use start_background_job instead. If the command stops to ask something, the result says it's waiting for input: answer with terminal_send_input.",
      schema: z.object({ command: z.string().describe("The shell command, run in the workspace folder") }) as any,
    },
  );
}

/**
 * Answers a command in the kernl terminal that stopped to wait for input (run_in_terminal said so):
 * a line of text and Enter, or "ctrl-c" to stop it. Asks first, like a command.
 */
export function sendInputTool(gate: ApprovalGate, sendInput: (text: string, signal?: AbortSignal) => Promise<ExecuteResponse>) {
  return tool(
    async ({ text }: { text: string }, config) => {
      if (!(await gate.request({ kind: "tool", tool: "terminal_send_input", args: { text } }))) return "rejected by user";
      return executeResult(await sendInput(text, config?.signal));
    },
    {
      name: "terminal_send_input",
      description:
        'Answer a command in the kernl terminal that is waiting for input (run_in_terminal or execute said "waiting for input"): type a line of text followed by Enter, or "ctrl-c" to stop the command. Returns what the command printed after that.',
      schema: z.object({ text: z.string().describe('The line to type, or "ctrl-c" to stop the command') }) as any,
    },
  );
}
