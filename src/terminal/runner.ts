import type { ExecuteResponse } from "deepagents";
import * as vscode from "vscode";
import { cleanTerminalOutput } from "./output";

export const SHELL_INTEGRATION_MISSING =
  "Shell integration is not active in the kernl terminal, so the command did not run. " +
  "Enable the setting terminal.integrated.shellIntegration.enabled and use bash, zsh, fish, or PowerShell.";

function waitForShellIntegration(terminal: vscode.Terminal, timeoutMs: number): Promise<vscode.TerminalShellIntegration> {
  if (terminal.shellIntegration) return Promise.resolve(terminal.shellIntegration);
  return new Promise((resolve, reject) => {
    const timer = setTimeout(() => {
      sub.dispose();
      reject(new Error(`shell integration did not activate within ${timeoutMs} ms`));
    }, timeoutMs);
    const sub = vscode.window.onDidChangeTerminalShellIntegration((e) => {
      if (e.terminal !== terminal) return;
      clearTimeout(timer);
      sub.dispose();
      resolve(e.shellIntegration);
    });
  });
}

export interface TerminalRunnerOptions {
  cwd: string;
  /** Terminal tab name, e.g. "kernl" or "kernl: fix-login". */
  name: string;
  /** Signal of the agent run currently in progress; aborting it interrupts the command. */
  currentSignal: () => AbortSignal | undefined;
  onShellIntegrationMissing: (message: string) => void;
  timeoutMs?: number;
  shellIntegrationWaitMs?: number;
}

/**
 * Runs agent commands one at a time in a visible, named terminal through shell
 * integration. Commands are serialized because executeCommand interrupts a running command.
 * There is no hidden-process fallback: the user sees every command that runs.
 */
export class TerminalRunner implements vscode.Disposable {
  private terminal: vscode.Terminal | undefined;
  private queue: Promise<unknown> = Promise.resolve();
  private closeSub = vscode.window.onDidCloseTerminal((t) => {
    if (t === this.terminal) this.terminal = undefined;
  });

  constructor(private options: TerminalRunnerOptions) {}

  run = (command: string): Promise<ExecuteResponse> => {
    const next = this.queue.then(() => this.runOne(command));
    this.queue = next.catch(() => {});
    return next;
  };

  private ensureTerminal(): vscode.Terminal {
    this.terminal ??= vscode.window.createTerminal({ name: this.options.name, cwd: this.options.cwd });
    return this.terminal;
  }

  private async runOne(command: string): Promise<ExecuteResponse> {
    const signal = this.options.currentSignal();
    if (signal?.aborted) return { output: "cancelled before start", exitCode: null, truncated: false };
    const terminal = this.ensureTerminal();
    terminal.show(true);
    let shell: vscode.TerminalShellIntegration;
    try {
      shell = await waitForShellIntegration(terminal, this.options.shellIntegrationWaitMs ?? 10_000);
    } catch {
      this.options.onShellIntegrationMissing(SHELL_INTEGRATION_MISSING);
      return { output: SHELL_INTEGRATION_MISSING, exitCode: null, truncated: false };
    }

    const execution = shell.executeCommand(command);
    const ended = new Promise<number | undefined>((resolve) => {
      const sub = vscode.window.onDidEndTerminalShellExecution((e) => {
        if (e.execution !== execution) return;
        sub.dispose();
        resolve(e.exitCode);
      });
    });
    let raw = "";
    const reading = (async () => {
      for await (const chunk of execution.read()) raw += chunk;
    })();

    let interrupted: "timeout" | "stopped" | undefined;
    const interrupt = (why: "timeout" | "stopped") => {
      if (interrupted) return;
      interrupted = why;
      terminal.sendText("\x03", false);
    };
    const timer = setTimeout(() => interrupt("timeout"), this.options.timeoutMs ?? 120_000);
    const onAbort = () => interrupt("stopped");
    signal?.addEventListener("abort", onAbort);
    const exitCode = await Promise.race([ended, new Promise<undefined>((r) => signal?.addEventListener("abort", () => setTimeout(() => r(undefined), 2_000)))]);
    clearTimeout(timer);
    signal?.removeEventListener("abort", onAbort);
    await Promise.race([reading, new Promise((r) => setTimeout(r, 500))]);

    const { text, truncated } = cleanTerminalOutput(raw);
    const note = interrupted === "timeout" ? "\n[command timed out and was interrupted]" : interrupted === "stopped" ? "\n[stopped by user]" : "";
    return { output: text + note, exitCode: exitCode ?? null, truncated };
  }

  dispose() {
    this.closeSub.dispose();
    this.terminal?.dispose();
  }
}
