import * as vscode from "vscode";
import type { JobDisplay, JobView } from "../agent/backgroundJobs";

/** A visible terminal for a background job: shows its output; closing it calls `onClose` (which stops the job). */
export function jobTerminal(job: JobView, onClose: () => void): JobDisplay & { terminal: vscode.Terminal } {
  const write = new vscode.EventEmitter<string>();
  const pending: string[] = [];
  let open = false;
  const terminal = vscode.window.createTerminal({
    name: `kernl job: ${job.name}`,
    pty: {
      onDidWrite: write.event,
      // Output that arrives before the terminal opens is held, not lost.
      open: () => ((open = true), pending.splice(0).forEach((t) => write.fire(t))),
      close: onClose,
    },
  });
  terminal.show(true);
  const out = (text: string) => (open ? write.fire(text) : pending.push(text));
  return {
    terminal,
    write: (text) => out(text.replace(/\r?\n/g, "\r\n")),
    exited: (code) => out(`\r\n[job ended${code === null ? "" : ` with exit code ${code}`}]\r\n`),
    dispose: () => terminal.dispose(),
  };
}
