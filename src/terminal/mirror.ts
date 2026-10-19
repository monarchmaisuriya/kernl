import * as vscode from "vscode";
import type { CommandOutputEvent } from "../acp/acpRunner";

/**
 * A read-only terminal showing the commands an agent runs in its own shell (Codex), with their
 * output as it streams. Nothing typed here reaches the agent. Created on the first command.
 */
export class CommandMirror implements vscode.Disposable {
  private terminal: vscode.Terminal | undefined;
  private writes = new vscode.EventEmitter<string>();
  /** Text written before VS Code opened the terminal. */
  private pending: string[] | undefined;

  constructor(private name: string) {}

  show(event: CommandOutputEvent) {
    if (event.command !== undefined) {
      this.ensureTerminal().show(true);
      this.print(`\r\n\x1b[1m$ ${event.command}\x1b[0m\r\n`);
    }
    if (event.data) this.print(event.data.replace(/\r?\n/g, "\r\n"));
    if (event.exitCode !== undefined) this.print(`\r\n\x1b[2m[exit code ${event.exitCode ?? "unknown"}]\x1b[0m\r\n`);
  }

  private ensureTerminal(): vscode.Terminal {
    if (this.terminal) return this.terminal;
    this.pending = [];
    const pty: vscode.Pseudoterminal = {
      onDidWrite: this.writes.event,
      open: () => {
        for (const text of this.pending ?? []) this.writes.fire(text);
        this.pending = undefined;
      },
      close: () => {
        this.terminal = undefined;
      },
    };
    this.terminal = vscode.window.createTerminal({ name: this.name, pty });
    return this.terminal;
  }

  private print(text: string) {
    if (!this.terminal) this.ensureTerminal();
    if (this.pending) this.pending.push(text);
    else this.writes.fire(text);
  }

  dispose() {
    this.terminal?.dispose();
    this.writes.dispose();
  }
}
