import { randomUUID } from "node:crypto";
import { existsSync } from "node:fs";
import { mkdir, readFile, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import type { ExecuteResponse } from "deepagents";
import * as vscode from "vscode";
import { cleanTerminalOutput, looksLikePrompt, NO_PAGER } from "./output";

export const SHELL_INTEGRATION_MISSING =
  "Shell integration is not active in the kernl terminal, so the command did not run. " +
  "Enable the setting terminal.integrated.shellIntegration.enabled and use bash, zsh, fish, or PowerShell.";

/** Said once when kernl's terminal has no shell integration and commands run through the fallback instead. */
export const SHELL_INTEGRATION_FALLBACK =
  "Shell integration is not active in the kernl terminal: kernl runs commands through a small script there instead (output and exit code still come back). " +
  "For the full experience, enable terminal.integrated.shellIntegration.enabled and use bash, zsh, fish, or PowerShell.";

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
  /** Told once when the terminal has no shell integration (commands then run through the fallback, or, on Windows, not at all). */
  onShellIntegrationMissing: (message: string) => void;
  timeoutMs?: number;
  shellIntegrationWaitMs?: number;
  /** Characters of a command's output the agent gets (the end of it); read for every command. */
  outputLimit?: () => number;
  /** How long the output must be quiet, with a prompt-like last line, before a command counts as waiting for input. */
  inputQuietMs?: number;
}

/** A command in the terminal: its output so far, how it ends, how to interrupt it or type into it. */
interface Running {
  command: string;
  raw: string;
  dropped: boolean;
  lastOutputAt: number;
  ended: Promise<number | undefined>;
  done: boolean;
  /** Stops reading (the fallback's polling, and its files); the command itself is ended with Ctrl+C. */
  stop(): void;
}

/**
 * Runs agent commands one at a time in a visible, named terminal. With shell integration, through
 * executeCommand; without it, through a small script whose output and exit code land in files (not on
 * Windows). Commands are serialized because a new command would interrupt a running one; one that waits
 * for input is reported, stays running, and is answered with sendInput. The user sees every command.
 */
export class TerminalRunner implements vscode.Disposable {
  private terminal: vscode.Terminal | undefined;
  private queue: Promise<unknown> = Promise.resolve();
  /** A command that stopped to wait for input: it keeps the terminal until it's answered or stopped. */
  private waiting: Running | undefined;
  private toldFallback = false;
  private closeSub = vscode.window.onDidCloseTerminal((t) => {
    if (t !== this.terminal) return;
    this.terminal = undefined;
    this.waiting?.stop();
    this.waiting = undefined;
  });

  constructor(private options: TerminalRunnerOptions) {}

  /** `signal` interrupts this command (a CLI agent's tool call); without it, the current agent run's signal does. */
  run = (command: string, signal?: AbortSignal): Promise<ExecuteResponse> => {
    const next = this.queue.then(() => this.runOne(command, signal ?? this.options.currentSignal()));
    this.queue = next.catch(() => {});
    return next;
  };

  /**
   * Answers the command that is waiting for input: types `text` and Enter, or "ctrl-c" to stop it.
   * Returns what it printed after that, like run().
   */
  sendInput = (text: string, signal?: AbortSignal): Promise<ExecuteResponse> => {
    const next = this.queue.then(async () => {
      const running = this.waiting;
      if (!running || running.done || !this.terminal) return { output: "No command is waiting for input in the kernl terminal.", exitCode: null, truncated: false };
      this.waiting = undefined;
      const from = running.raw.length;
      const stop = text.trim().toLowerCase() === "ctrl-c";
      this.terminal.sendText(stop ? "\x03" : text, !stop);
      return this.watch(running, signal ?? this.options.currentSignal(), from, stop ? "stopped" : undefined);
    });
    this.queue = next.catch(() => {});
    return next;
  };

  private ensureTerminal(): vscode.Terminal {
    this.terminal ??= vscode.window.createTerminal({ name: this.options.name, cwd: this.options.cwd, env: NO_PAGER });
    return this.terminal;
  }

  private async runOne(command: string, signal: AbortSignal | undefined): Promise<ExecuteResponse> {
    if (signal?.aborted) return { output: "cancelled before start", exitCode: null, truncated: false };
    if (this.waiting && !this.waiting.done) {
      return {
        output: `A command is still waiting for input in the kernl terminal: ${this.waiting.command}\nAnswer it with terminal_send_input, or stop it with terminal_send_input "ctrl-c", before running another.`,
        exitCode: null,
        truncated: false,
      };
    }
    this.waiting = undefined;
    const terminal = this.ensureTerminal();
    terminal.show(true);
    let running: Running;
    try {
      const shell = await waitForShellIntegration(terminal, this.options.shellIntegrationWaitMs ?? 10_000);
      running = this.startIntegrated(shell, command);
    } catch {
      if (process.platform === "win32") {
        this.options.onShellIntegrationMissing(SHELL_INTEGRATION_MISSING);
        return { output: SHELL_INTEGRATION_MISSING, exitCode: null, truncated: false };
      }
      if (!this.toldFallback) (this.toldFallback = true), this.options.onShellIntegrationMissing(SHELL_INTEGRATION_FALLBACK);
      running = await this.startFallback(terminal, command);
    }
    return this.watch(running, signal, 0);
  }

  private startIntegrated(shell: vscode.TerminalShellIntegration, command: string): Running {
    const execution = shell.executeCommand(command);
    const running: Running = { command, raw: "", dropped: false, lastOutputAt: Date.now(), done: false, ended: undefined as any, stop: () => {} };
    running.ended = new Promise<number | undefined>((resolve) => {
      const sub = vscode.window.onDidEndTerminalShellExecution((e) => {
        if (e.execution !== execution) return;
        sub.dispose();
        running.done = true;
        resolve(e.exitCode);
      });
    });
    void (async () => {
      for await (const chunk of execution.read()) this.append(running, chunk);
    })().catch(() => {});
    return running;
  }

  /**
   * Without shell integration: the command runs from a script in the same terminal, which copies its
   * output to a file and writes its exit code to another; kernl polls them. POSIX shells only.
   */
  private async startFallback(terminal: vscode.Terminal, command: string): Promise<Running> {
    const dir = join(tmpdir(), "kernl-terminal");
    await mkdir(dir, { recursive: true });
    const id = randomUUID();
    const [script, log, exit] = ["sh", "log", "exit"].map((ext) => join(dir, `${id}.${ext}`));
    const quote = (s: string) => `'${s.replace(/'/g, `'\\''`)}'`;
    await writeFile(script, `cd ${quote(this.options.cwd)} 2>/dev/null\n{ (\n${command}\n) 2>&1; echo $? > ${quote(exit)}; } | tee ${quote(log)}\n`);
    const running: Running = { command, raw: "", dropped: false, lastOutputAt: Date.now(), done: false, ended: undefined as any, stop: () => {} };
    let timer: ReturnType<typeof setInterval> | undefined;
    let offset = 0;
    // The script holds the command and the log its output: removed however the command ends.
    const removeFiles = () => void Promise.all([script, log, exit].map((f) => rm(f, { force: true })));
    running.ended = new Promise<number | undefined>((resolve) => {
      timer = setInterval(async () => {
        const out = await readFile(log, "utf8").catch(() => "");
        if (out.length > offset) this.append(running, out.slice(offset)), (offset = out.length);
        if (!existsSync(exit)) return;
        clearInterval(timer);
        const code = Number.parseInt(await readFile(exit, "utf8").catch(() => ""), 10);
        running.done = true;
        removeFiles();
        resolve(Number.isNaN(code) ? undefined : code);
      }, 200);
    });
    running.stop = () => (clearInterval(timer), removeFiles());
    terminal.sendText(`sh ${quote(script)}`, true);
    return running;
  }

  private append(running: Running, chunk: string) {
    const limit = this.options.outputLimit?.() ?? 30_000;
    running.raw += chunk;
    running.lastOutputAt = Date.now();
    // Only the end is kept (raw, twice the limit: escapes and redraws are removed later).
    if (running.raw.length > limit * 2) (running.raw = running.raw.slice(-limit * 2)), (running.dropped = true);
  }

  /**
   * Waits for the command to end, to wait for input (quiet output with a prompt-like last line), to time
   * out, or to be stopped; returns its output from `from` on. A command waiting for input keeps running.
   */
  private async watch(running: Running, signal: AbortSignal | undefined, from: number, already?: "stopped"): Promise<ExecuteResponse> {
    const limit = this.options.outputLimit?.() ?? 30_000;
    const quietMs = this.options.inputQuietMs ?? 3_000;
    let interrupted = already as "timeout" | "stopped" | undefined;
    const interrupt = (why: "timeout" | "stopped") => {
      if (interrupted || running.done) return;
      interrupted = why;
      this.terminal?.sendText("\x03", false);
    };
    const timer = setTimeout(() => interrupt("timeout"), this.options.timeoutMs ?? 120_000);
    const onAbort = () => interrupt("stopped");
    signal?.addEventListener("abort", onAbort);
    let waitingFor: string | undefined;
    const waitingForInput = new Promise<"input">((resolve) => {
      const poll = setInterval(() => {
        if (running.done) return clearInterval(poll);
        if (interrupted || Date.now() - running.lastOutputAt < quietMs) return;
        const last = cleanTerminalOutput(running.raw.slice(from), 2_000).text.split("\n").pop() ?? "";
        if (!looksLikePrompt(last)) return;
        clearInterval(poll);
        waitingFor = last.trim();
        resolve("input");
      }, 250);
      void running.ended.then(() => clearInterval(poll));
    });
    const stopped = new Promise<undefined>((r) => signal?.addEventListener("abort", () => setTimeout(() => r(undefined), 2_000)));
    const outcome = await Promise.race([running.ended, waitingForInput, stopped]);
    clearTimeout(timer);
    signal?.removeEventListener("abort", onAbort);
    if (outcome !== "input") {
      running.stop();
      // The last output can trail the end event by a moment.
      await new Promise((r) => setTimeout(r, 300));
    }

    const cleaned = cleanTerminalOutput(running.raw.slice(from), limit);
    const truncated = cleaned.truncated || (from === 0 && running.dropped);
    const text = from === 0 && running.dropped && !cleaned.truncated ? `[earlier output truncated]\n${cleaned.text}` : cleaned.text;
    if (outcome === "input") {
      this.waiting = running;
      return {
        output: `${text}\n[waiting for input: ${waitingFor}]\nThe command is still running in the kernl terminal. Answer it with terminal_send_input (a line of text), or stop it with terminal_send_input "ctrl-c".`,
        exitCode: null,
        truncated,
      };
    }
    const note = interrupted === "timeout" ? "\n[command timed out and was interrupted]" : interrupted === "stopped" ? "\n[stopped]" : "";
    // kernl's own Ctrl+C ends the command with 130 (or no code): that's "stopped", not a failure of the command.
    const exitCode = interrupted ? null : (outcome ?? null);
    return { output: text + note, exitCode, truncated };
  }

  dispose() {
    this.closeSub.dispose();
    this.waiting?.stop();
    this.terminal?.dispose();
  }
}
