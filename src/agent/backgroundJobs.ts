import { type ChildProcess, spawn } from "node:child_process";
import { tool } from "@langchain/core/tools";
import { z } from "zod";
import type { ApprovalGate } from "../gate/approvalGate";
import { gatedTool } from "../gate/gatedTool";

/**
 * Long-running commands the YourStack agent starts and keeps going between messages: dev servers,
 * watchers, slow builds. Starting one asks exactly like running a command (the same approval rules
 * apply); each job shows in its own terminal; the agent can read its output and stop it. Jobs end
 * when their workspace closes.
 */
export interface JobDisplay {
  write(text: string): void;
  exited(code: number | null): void;
  dispose(): void;
}

export interface JobView {
  id: string;
  name: string;
  command: string;
  status: "running" | "exited" | "stopped";
  exitCode: number | null;
}

interface Job extends JobView {
  child: ChildProcess;
  output: string;
  display: JobDisplay;
}

const KEEP = 200_000; // characters of output kept per job

export class BackgroundJobs {
  private jobs = new Map<string, Job>();
  private next = 1;

  constructor(private cwd: string, private display: (job: JobView) => JobDisplay, private changed: () => void = () => {}) {}

  start(command: string, name?: string): JobView {
    const id = `job-${this.next++}`;
    const shell = process.env.SHELL || "/bin/sh";
    // Its own process group, so stopping it also stops whatever it started (npm -> node, etc.).
    const child = spawn(shell, ["-lc", command], { cwd: this.cwd, detached: true, stdio: ["ignore", "pipe", "pipe"], env: process.env });
    const view: JobView = { id, name: name?.trim() || command.slice(0, 40), command, status: "running", exitCode: null };
    const job: Job = { ...view, child, output: "", display: this.display(view) };
    const take = (chunk: Buffer) => {
      const text = String(chunk);
      job.output = (job.output + text).slice(-KEEP);
      job.display.write(text);
    };
    child.stdout?.on("data", take);
    child.stderr?.on("data", take);
    child.on("error", (err) => take(Buffer.from(`could not start: ${err.message}\n`)));
    child.on("exit", (code) => {
      if (job.status === "running") job.status = "exited";
      job.exitCode = code;
      job.display.exited(code);
      this.changed();
    });
    this.jobs.set(id, job);
    this.changed();
    return this.view(job);
  }

  private view(j: Job): JobView {
    return { id: j.id, name: j.name, command: j.command, status: j.status, exitCode: j.exitCode };
  }

  check(id: string, tail = 4000): (JobView & { output: string }) | undefined {
    const j = this.jobs.get(id);
    return j && { ...this.view(j), output: j.output.slice(-Math.max(0, tail)) };
  }

  list(): JobView[] {
    return [...this.jobs.values()].map((j) => this.view(j));
  }

  /** Stops the job's whole process group: SIGTERM, then SIGKILL after 3 s. */
  stop(id: string): boolean {
    const j = this.jobs.get(id);
    if (!j || j.status !== "running") return false;
    j.status = "stopped";
    const kill = (signal: NodeJS.Signals) => {
      try {
        process.kill(-j.child.pid!, signal);
      } catch {
        // already gone
      }
    };
    kill("SIGTERM");
    setTimeout(() => j.exitCode === null && kill("SIGKILL"), 3000).unref();
    this.changed();
    return true;
  }

  get running(): number {
    return [...this.jobs.values()].filter((j) => j.status === "running").length;
  }

  dispose() {
    for (const j of this.jobs.values()) {
      this.stop(j.id);
      j.display.dispose();
    }
    this.jobs.clear();
  }
}

/** The agent's job tools. Starting asks through the gate as a command; checking, listing, and stopping don't change anything new. */
export function jobTools(jobs: BackgroundJobs, gate: ApprovalGate) {
  const describe = (j: JobView) => `${j.id} "${j.name}": ${j.status}${j.exitCode !== null ? ` (exit code ${j.exitCode})` : ""}`;
  const start = tool(
    async ({ command, name }: { command: string; name?: string }) => {
      if (!(await gate.request({ kind: "execute", command }))) return "rejected by user";
      return `${describe(jobs.start(command, name))}. Check it with check_background_job.`;
    },
    {
      name: "start_background_job",
      description: "Start a long-running command in the background (a dev server, a watcher, a slow build) and keep working. It runs in its own visible terminal. Use the execute tool instead for commands that finish quickly.",
      schema: z.object({ command: z.string().describe("The shell command"), name: z.string().optional().describe("A short name for the job") }) as any,
    },
  );
  const check = tool(
    async ({ id, tail }: { id: string; tail?: number }) => {
      const j = jobs.check(id, tail ?? 4000);
      return j ? `${describe(j)}\n--- last output ---\n${j.output || "(no output yet)"}` : `No job ${id}. Jobs: ${jobs.list().map(describe).join("; ") || "none"}`;
    },
    { name: "check_background_job", description: "Status and the latest output of a background job.", schema: z.object({ id: z.string(), tail: z.number().int().min(0).optional().describe("Characters of output to return (default 4000)") }) as any },
  );
  const stop = tool(async ({ id }: { id: string }) => (jobs.stop(id) ? `Stopping ${id}.` : `${id} isn't running.`), {
    name: "stop_background_job",
    description: "Stop a background job (and everything it started).",
    schema: z.object({ id: z.string() }) as any,
  });
  const list = tool(async () => jobs.list().map(describe).join("\n") || "No background jobs.", {
    name: "list_background_jobs",
    description: "List background jobs and their status.",
    schema: z.object({}) as any,
  });
  return [start, check, stop, list].map((t) => gatedTool(t as any, gate, "allow"));
}
