// Every command run in this window's terminals, the user's own included, with its output, folder, and
// exit code, so an agent can answer "what's in my terminal". VS Code has no stable API that reads a
// terminal's screen or scrollback; it reports each command through shell integration as it runs, and a
// command's output can be read only from its start (read() must be called in the same tick as the start
// event, or the first output is missed). So kernl records from activation (VS Code startup) onward;
// earlier output, and terminals without shell integration, can't be read.
import type * as vscode from "vscode";
import { isSensitivePath } from "../gate/approvalGate";
import { cleanTerminalOutput } from "./output";

/** The VS Code events and state the recorder needs; tests pass fakes. */
export interface ShellEvents {
  onDidStartTerminalShellExecution: vscode.Event<vscode.TerminalShellExecutionStartEvent>;
  onDidEndTerminalShellExecution: vscode.Event<vscode.TerminalShellExecutionEndEvent>;
  onDidCloseTerminal: vscode.Event<vscode.Terminal>;
  terminals(): readonly vscode.Terminal[];
  activeTerminal(): vscode.Terminal | undefined;
}

export interface RecordedCommand {
  commandLine: string;
  /** VS Code is sure of the command line only when the shell reported it (confidence High). */
  commandLineSure: boolean;
  cwd?: string;
  startedAt: number;
  endedAt?: number;
  /** undefined while running; null when the shell didn't report one (Ctrl+C, a sub-shell). */
  exitCode?: number | null;
  /** Raw output (escape codes and all), its last RAW_LIMIT characters. */
  raw: string;
  cutStart: boolean;
}

/** Commands kept per terminal, and raw output kept per command (cleaned to a quarter of it or less when read). */
export const COMMANDS_KEPT = 30;
const RAW_LIMIT = 40_000;
/** Characters of one command's output an agent gets, and of one read in total. */
export const OUTPUT_PER_COMMAND = 10_000;
export const OUTPUT_PER_READ = 30_000;

/**
 * The credential-like file a command line names (`cat .env`), by the same rule that makes reading such a
 * file ask first; its output isn't handed to an agent through the terminal instead.
 */
function credentialFile(commandLine: string): string | undefined {
  return commandLine
    .split(/[\s|;&<>()=]+/)
    .map((t) => t.replace(/^['"]|['"]$/g, ""))
    .find((t) => t && isSensitivePath(t));
}

/** What an agent gets instead of the output of a command that names a credential-like file. */
const hiddenOutput = (file: string) => `[output hidden: this command names a credential-like file (${file}). Read that file itself: kernl asks the user before its contents go to the model.]`;

/**
 * The command line in VS Code's own view of a terminal's last command (its terminal_last_command tool, as
 * VS Code 1.142 writes it: a fixed line, then the command); undefined when the text isn't in that form.
 */
export function screenCommand(text: string): string | undefined {
  const lines = text.split("\n");
  const at = lines.findIndex((l) => /^The following (?:is the last command run|command is currently executing) in the terminal:$/.test(l.trim()));
  return at < 0 ? undefined : lines[at + 1]?.trim() || undefined;
}

/** VS Code's view of the last command, with its output hidden when the command names a credential-like file. */
export function hideScreenCredentials(text: string): string {
  const command = screenCommand(text);
  const file = command && credentialFile(command);
  return file ? `The last command was: ${command}\n${hiddenOutput(file)}` : text;
}

export interface TerminalSummary {
  /** 1-based, in the window's terminal order: how an agent names a terminal when names repeat. */
  index: number;
  name: string;
  active: boolean;
  shell?: string;
  cwd?: string;
  shellIntegration: boolean;
  running?: string;
  last?: { commandLine: string; exitCode?: number | null };
}

export class TerminalHistory implements vscode.Disposable {
  private commands = new Map<vscode.Terminal, RecordedCommand[]>();
  private subs: vscode.Disposable[];

  constructor(private events: ShellEvents, private scrub: (text: string) => string = (t) => t) {
    const running = new Map<vscode.TerminalShellExecution, RecordedCommand>();
    this.subs = [
      events.onDidStartTerminalShellExecution((e) => {
        const entry: RecordedCommand = {
          commandLine: e.execution.commandLine.value,
          commandLineSure: e.execution.commandLine.confidence === 2,
          cwd: e.execution.cwd?.fsPath,
          startedAt: Date.now(),
          raw: "",
          cutStart: false,
        };
        const list = this.commands.get(e.terminal) ?? [];
        list.push(entry);
        if (list.length > COMMANDS_KEPT) list.shift();
        this.commands.set(e.terminal, list);
        running.set(e.execution, entry);
        // In the same tick as the start event: read() only sees output written after its first call.
        const stream = e.execution.read();
        void (async () => {
          for await (const chunk of stream) {
            entry.raw += chunk;
            if (entry.raw.length > RAW_LIMIT) (entry.raw = entry.raw.slice(-RAW_LIMIT)), (entry.cutStart = true);
          }
        })().catch(() => {});
      }),
      events.onDidEndTerminalShellExecution((e) => {
        const entry = running.get(e.execution);
        if (!entry) return;
        running.delete(e.execution);
        entry.endedAt = Date.now();
        entry.exitCode = e.exitCode ?? null;
        // VS Code often reports the folder only after the command started.
        entry.cwd ??= e.execution.cwd?.fsPath ?? e.terminal.shellIntegration?.cwd?.fsPath;
      }),
      events.onDidCloseTerminal((t) => this.commands.delete(t)),
    ];
  }

  /** The window's terminals, in order, with what each last ran. */
  list(): TerminalSummary[] {
    const active = this.events.activeTerminal();
    return this.events.terminals().map((t, i) => {
      const cmds = this.commands.get(t) ?? [];
      const running = [...cmds].reverse().find((c) => c.exitCode === undefined);
      const last = [...cmds].reverse().find((c) => c.exitCode !== undefined);
      return {
        index: i + 1,
        name: t.name,
        active: t === active,
        shell: t.state.shell,
        cwd: t.shellIntegration?.cwd?.fsPath ?? cmds.at(-1)?.cwd,
        shellIntegration: t.shellIntegration !== undefined,
        ...(running ? { running: this.scrub(running.commandLine) } : {}),
        ...(last ? { last: { commandLine: this.scrub(last.commandLine), exitCode: last.exitCode } } : {}),
      };
    });
  }

  /**
   * A terminal by "active", its 1-based index, or its name (exact, then the only one containing it);
   * an error message when none or several match.
   */
  find(which: string | undefined): vscode.Terminal | string {
    const terminals = this.events.terminals();
    if (!terminals.length) return "There are no terminals open in this window.";
    const w = (which ?? "active").trim();
    if (w === "" || w.toLowerCase() === "active") return this.events.activeTerminal() ?? terminals.at(-1)!;
    if (/^\d+$/.test(w)) return terminals[Number(w) - 1] ?? `There is no terminal ${w}; there are ${terminals.length}.`;
    const exact = terminals.filter((t) => t.name === w);
    if (exact.length === 1) return exact[0];
    const near = terminals.filter((t) => t.name.toLowerCase().includes(w.toLowerCase()));
    if (near.length === 1) return near[0];
    const names = terminals.map((t, i) => `${i + 1}: ${t.name}`).join(", ");
    return `${exact.length + near.length ? "Several terminals match" : "No terminal matches"} "${w}"; use its number: ${names}.`;
  }

  /** Whether this is the window's active terminal, and whether kernl recorded anything in it. */
  isActive(terminal: vscode.Terminal): boolean {
    return this.events.activeTerminal() === terminal;
  }
  hasRecords(terminal: vscode.Terminal): boolean {
    return (this.commands.get(terminal)?.length ?? 0) > 0;
  }

  /**
   * Why the user's selection in the active terminal isn't handed to an agent, or undefined: it shares a
   * line with the output of a command that names a credential-like file. With nothing recorded there,
   * `screen` (VS Code's view of the last command) decides.
   */
  selectionHidden(selection: string, screen?: string): string | undefined {
    const terminal = this.events.activeTerminal();
    const recorded = terminal ? (this.commands.get(terminal) ?? []) : [];
    if (!recorded.length) {
      const command = screen && screenCommand(screen);
      const file = command && credentialFile(command);
      return file ? hiddenOutput(file) : undefined;
    }
    const lines = selection.split("\n").map((l) => l.trim()).filter((l) => l.length >= 4);
    for (const c of recorded) {
      const file = credentialFile(c.commandLine);
      if (!file) continue;
      const output = cleanTerminalOutput(c.raw, RAW_LIMIT).text;
      if (lines.some((l) => output.includes(l))) return hiddenOutput(file);
    }
    return undefined;
  }

  /** The terminal's last `count` commands with their output, oldest first, as text for an agent. */
  read(terminal: vscode.Terminal, count = 5): string {
    const cmds = (this.commands.get(terminal) ?? []).slice(-Math.max(1, Math.min(count, COMMANDS_KEPT)));
    const index = this.events.terminals().indexOf(terminal) + 1;
    const head = `Terminal ${index}: ${terminal.name}`;
    if (!cmds.length) {
      return terminal.shellIntegration
        ? `${head}\nNo commands recorded yet: kernl records commands from when VS Code started; output from before isn't available.`
        : `${head}\nShell integration is off in this terminal, so its commands can't be read (VS Code reports commands only through shell integration). It's on by default for bash, zsh, fish, and PowerShell: check the setting terminal.integrated.shellIntegration.enabled, or open a new terminal.`;
    }
    let room = OUTPUT_PER_READ;
    const parts: string[] = [];
    // Newest first for the budget, shown oldest first.
    for (const c of [...cmds].reverse()) {
      const secret = credentialFile(c.commandLine);
      const { text, truncated } = secret
        ? { text: hiddenOutput(secret), truncated: false }
        : cleanTerminalOutput(c.raw, Math.min(OUTPUT_PER_COMMAND, Math.max(room, 200)));
      room -= text.length;
      const status = c.exitCode === undefined ? "still running" : c.exitCode === null ? "exit code unknown" : `exit code ${c.exitCode}`;
      const when = new Date(c.startedAt).toLocaleTimeString();
      const line = `$ ${c.commandLine}${c.commandLineSure ? "" : "   (command line as VS Code read it from the screen)"}`;
      const meta = [c.cwd ? `in ${c.cwd}` : undefined, `started ${when}`, status].filter(Boolean).join(", ");
      parts.unshift([line, `(${meta})`, (c.cutStart || truncated) && text ? `[earlier output not kept]\n${text.replace(/^\[earlier output truncated\]\n/, "")}` : text || "(no output)"].join("\n"));
      if (room <= 0) break;
    }
    return this.scrub(`${head}\n\n${parts.join("\n\n")}`);
  }

  dispose() {
    for (const s of this.subs) s.dispose();
    this.commands.clear();
  }
}
