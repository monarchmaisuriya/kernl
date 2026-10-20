// The window's terminals as an agent reads them: every command recorded from its start (output read in
// the same tick as the start event), with folder and exit code; terminals named by number, name, or
// "active"; limits; known secrets scrubbed; and a clear answer when a terminal has no shell integration.
import { strict as assert } from "node:assert";
import { test } from "node:test";
import { COMMANDS_KEPT, hideScreenCredentials, screenCommand, type ShellEvents, TerminalHistory } from "../../src/terminal/history";

function emitter<T>() {
  const listeners = new Set<(e: T) => void>();
  const event = (l: (e: T) => void) => (listeners.add(l), { dispose: () => listeners.delete(l) });
  return { event: event as any, fire: (e: T) => listeners.forEach((l) => l(e)) };
}

/** A fake command whose output arrives in chunks after start; read() only sees chunks pushed after its first call. */
function execution(commandLine: string, confidence = 2, cwd = "/repo") {
  const chunks: string[] = [];
  let wake: (() => void) | undefined;
  let done = false;
  let reading = false;
  return {
    exec: {
      commandLine: { value: commandLine, confidence },
      cwd: { fsPath: cwd },
      read() {
        reading = true;
        return (async function* () {
          while (!done || chunks.length) {
            if (chunks.length) yield chunks.shift()!;
            else await new Promise<void>((r) => (wake = r));
          }
        })();
      },
    },
    write(s: string) {
      if (reading) chunks.push(s);
      wake?.();
    },
    end() {
      done = true;
      wake?.();
    },
  };
}

function fixture() {
  const start = emitter<any>();
  const end = emitter<any>();
  const close = emitter<any>();
  const user = { name: "zsh - pushowl-backend", state: { shell: "zsh" }, shellIntegration: { cwd: { fsPath: "/repo" } } } as any;
  const plain = { name: "cmd", state: {}, shellIntegration: undefined } as any;
  let active = user;
  const events: ShellEvents = {
    onDidStartTerminalShellExecution: start.event,
    onDidEndTerminalShellExecution: end.event,
    onDidCloseTerminal: close.event,
    terminals: () => [user, plain],
    activeTerminal: () => active,
  };
  const history = new TerminalHistory(events, (t) => t.replaceAll("sk-secret-123", "[redacted]"));
  const run = async (terminal: any, line: string, output: string[], exitCode: number | undefined, confidence = 2) => {
    const x = execution(line, confidence);
    start.fire({ terminal, execution: x.exec });
    for (const o of output) x.write(o);
    x.end();
    await new Promise((r) => setTimeout(r, 5));
    end.fire({ terminal, execution: x.exec, exitCode });
    return x;
  };
  return { history, user, plain, run, start, close, setActive: (t: any) => (active = t) };
}

test("a command in the user's terminal is recorded from its start, with clean output, folder, and exit code", async () => {
  const f = fixture();
  await f.run(f.user, "npm test", ["\x1b[32m> kernl@0.3.0 test\x1b[0m\r\n", "progress 10%\rprogress 100%\r\n", "1 failing\r\n"], 1);
  const text = f.history.read(f.user);
  assert.match(text, /^Terminal 1: zsh - pushowl-backend/);
  assert.match(text, /\$ npm test\n\(in \/repo, started .*, exit code 1\)\n> kernl@0.3.0 test\nprogress 100%\n1 failing/);
  assert.ok(!text.includes("\x1b") && !text.includes("progress 10%"), "colors and redrawn progress are gone");
});

test("the list shows each terminal with its number, shell, folder, and what it ran or is running", async () => {
  const f = fixture();
  await f.run(f.user, "git status", ["clean\n"], 0);
  const x = execution("npm run dev");
  f.start.fire({ terminal: f.user, execution: x.exec });
  const [user, plain] = f.history.list();
  assert.deepEqual([user.index, user.active, user.shell, user.cwd, user.running, user.last], [1, true, "zsh", "/repo", "npm run dev", { commandLine: "git status", exitCode: 0 }]);
  assert.deepEqual([plain.index, plain.shellIntegration], [2, false]);
  assert.match(f.history.read(f.user), /\$ npm run dev\n\(.*still running\)/);
});

test("terminals are found by active, number, or name, with a clear answer when it's ambiguous or missing", () => {
  const f = fixture();
  assert.equal(f.history.find(undefined), f.user);
  assert.equal(f.history.find("2"), f.plain);
  assert.equal(f.history.find("pushowl"), f.user, "a unique part of the name");
  assert.match(f.history.find("9") as string, /no terminal 9; there are 2/);
  assert.match(f.history.find("python") as string, /No terminal matches "python"; use its number: 1: zsh - pushowl-backend, 2: cmd/);
});

test("a terminal without shell integration, or with nothing yet, says why there's nothing to read", () => {
  const f = fixture();
  assert.match(f.history.read(f.plain), /Shell integration is off in this terminal/);
  assert.match(f.history.read(f.user), /No commands recorded yet: kernl records commands from when VS Code started/);
});

test("limits: the last 30 commands per terminal; unknown exit codes and unsure command lines are said; secrets are scrubbed; closing forgets", async () => {
  const f = fixture();
  for (let i = 0; i < COMMANDS_KEPT + 2; i++) await f.run(f.user, `echo ${i}`, [`${i}\n`], 0);
  assert.ok(!f.history.read(f.user, 30).includes("$ echo 1\n"), "the oldest are dropped");
  assert.ok(f.history.read(f.user, 30).includes(`$ echo ${COMMANDS_KEPT + 1}`));
  await f.run(f.user, "curl -H 'x: sk-secret-123' api", ["sk-secret-123 accepted\n"], undefined, 0);
  const last = f.history.read(f.user, 1);
  assert.ok(!last.includes("sk-secret-123") && last.includes("[redacted]"));
  assert.match(last, /exit code unknown/);
  assert.match(last, /command line as VS Code read it from the screen/);
  f.close.fire(f.user);
  assert.match(f.history.read(f.user), /No commands recorded yet/);
});

test("a command that names a credential-like file (cat .env) has its output hidden, like reading that file asks first", async () => {
  const f = fixture();
  await f.run(f.user, "cat .env", ["API_KEY=abc123\n"], 0);
  await f.run(f.user, "docker run --env-file='config/.env.local' app", ["TOKEN=zzz\n"], 0);
  await f.run(f.user, "ls", ["environment.ts\n"], 0);
  const text = f.history.read(f.user);
  assert.ok(!text.includes("abc123") && !text.includes("TOKEN=zzz"), text);
  assert.match(text, /\$ cat \.env\n.*\n\[output hidden: this command names a credential-like file \(\.env\)/);
  assert.match(text, /credential-like file \(config\/\.env\.local\)/);
  assert.match(text, /\$ ls\n.*\nenvironment\.ts/, "other commands keep their output");
});

test("with nothing recorded in the active terminal, terminal_read adds VS Code's own view of its screen; the selection comes from VS Code too", async () => {
  const { terminalReadTools } = await import("../../src/terminal/readTools");
  const { ApprovalGate } = await import("../../src/gate/approvalGate");
  const f = fixture();
  const gate = new ApprovalGate({ ask: async () => assert.fail("reading asks nothing") }, { rules: () => [] });
  const core = { lastCommand: async () => "$ make build\nsk-secret-123 ok", selection: async () => "selected line" };
  const scrub = (t: string) => t.replaceAll("sk-secret-123", "[redacted]");
  const [, read, selection] = terminalReadTools(f.history, gate, core, scrub);
  const text = String(await read.invoke({}));
  assert.match(text, /No commands recorded yet[\s\S]*VS Code's view of this terminal's last command \(from its screen\):\n\$ make build\n\[redacted\] ok/);
  assert.match(String(await selection.invoke({})), /UNTRUSTED TERMINAL OUTPUT[\s\S]*selected line/);
  await f.run(f.user, "ls", ["a\n"], 0);
  assert.ok(!String(await read.invoke({})).includes("VS Code's view"), "recorded commands come first; no screen fallback needed");
  const [, , missing] = terminalReadTools(f.history, gate, { lastCommand: async () => undefined, selection: async () => undefined }, scrub);
  assert.match(String(await missing.invoke({})), /isn't available in this VS Code/);
});

// VS Code 1.142's terminal_last_command text, as its tool writes it (lines joined with "\n").
const vsCodeLast = (command: string, output: string) => ["The following is the last command run in the terminal:", command, "It was run in the directory:", "/repo", "It exited with code: 0", "It has the following output:", output].join("\n");

test("VS Code's own view of the last command: its command line is read, and a credential-like file hides the output", () => {
  assert.equal(screenCommand(vsCodeLast("cat .env", "API_KEY=abc123")), "cat .env");
  assert.equal(screenCommand(["The following command is currently executing in the terminal:", "tail -f log", "It is running in the directory:", "/repo"].join("\n")), "tail -f log");
  assert.equal(screenCommand("No command has been run in the active terminal."), undefined);
  const hidden = hideScreenCredentials(vsCodeLast("cat .env", "API_KEY=abc123"));
  assert.ok(!hidden.includes("abc123"), hidden);
  assert.match(hidden, /^The last command was: cat \.env\n\[output hidden: this command names a credential-like file \(\.env\)/);
  const plain = vsCodeLast("ls", "environment.ts");
  assert.equal(hideScreenCredentials(plain), plain, "other commands keep their output");
});

test("the terminal selection is hidden when it shares a line with a credential file's output, recorded or on VS Code's screen", async () => {
  const f = fixture();
  await f.run(f.user, "cat .env", ["API_KEY=abc123\nDEBUG=1\n"], 0);
  await f.run(f.user, "ls", ["environment.ts\n"], 0);
  assert.match(f.history.selectionHidden("API_KEY=abc123") ?? "", /credential-like file \(\.env\)/);
  assert.equal(f.history.selectionHidden("environment.ts"), undefined, "a selection from other output is fine");
  assert.equal(f.history.selectionHidden("ok"), undefined, "too short to match on");
  f.setActive(f.plain);
  assert.match(f.history.selectionHidden("anything", vsCodeLast("cat id_rsa", "-----KEY-----")) ?? "", /credential-like file \(id_rsa\)/, "nothing recorded: VS Code's last command decides");
  assert.equal(f.history.selectionHidden("anything", vsCodeLast("ls", "x")), undefined);
});

test("terminal_read and terminal_selection apply the credential rule to VS Code's own view", async () => {
  const { terminalReadTools } = await import("../../src/terminal/readTools");
  const { ApprovalGate } = await import("../../src/gate/approvalGate");
  const f = fixture();
  const gate = new ApprovalGate({ ask: async () => assert.fail("reading asks nothing") }, { rules: () => [] });
  const core = { lastCommand: async () => vsCodeLast("cat .env", "API_KEY=abc123"), selection: async () => "API_KEY=abc123" };
  const [, read, selection] = terminalReadTools(f.history, gate, core);
  const text = String(await read.invoke({}));
  assert.ok(!text.includes("abc123"), text);
  assert.match(text, /output hidden/);
  const selected = String(await selection.invoke({}));
  assert.ok(!selected.includes("abc123"), selected);
  assert.match(selected, /output hidden/);
});
