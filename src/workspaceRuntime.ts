import * as vscode from "vscode";
import type * as acp from "@agentclientprotocol/sdk";
import { AcpRunner } from "./acp/acpRunner";
import { CLI_AGENTS, type CliAgentId, isCliAgentId, type KernlToolUse, resolveLaunch, sessionMeta } from "./acp/agents";
import { AgentLifecycle, type BuiltParts } from "./agent/agentLifecycle";
import { buildAgent } from "./agent/createAgent";
import { assembleInstructions } from "./agent/instructions";
import { blockedTools, loadNamedAgents, type NamedAgent, toolGuard } from "./agent/namedAgents";
import { skillSources } from "./agent/skills";
import { BackgroundJobs, type JobView, jobTools } from "./agent/backgroundJobs";
import { BUILT_IN_AGENTS } from "./agent/builtInAgents";
import { ThinkingLog, thinkingTool } from "./agent/thinking";
import { type InputChange, needsRebuild } from "./agent/rebuildPolicy";
import type { Runner } from "./agent/runner";
import { AgentSession, type SessionEvents } from "./agent/session";
import { GatedBackend, ReadOnlyBackend } from "./backend/gatedBackend";
import { VscodeWorkspaceFiles } from "./backend/vscodeWorkspaceFiles";
import type { IntegratedBrowser } from "./browser/integratedBrowser";
import { browserTools } from "./browser/tools";
import { ApprovalGate, type GateRequest } from "./gate/approvalGate";
import { PendingApprovals } from "./gate/pendingApprovals";
import type { Rule } from "./gate/rules";
import type { Logger } from "./log";
import type { StructuredToolInterface } from "@langchain/core/tools";
import { KERNL_SERVER_NAME, type KernlServerAccess } from "./mcp/kernlServer";
import { loadMcpTools, type McpServer, mergeServers, SIGN_IN_REASON, settingServers, type SignInRequired } from "./mcp/servers";
import type { LoadedSources } from "./sources";
import { loginCommand } from "./connections/agentChecks";
import type { RuntimeConnectionSignal } from "./connections/signals";
import { createChatModel, type ProviderAuth, type ProviderSettings, type ResolvedProvider, resolveProvider } from "./providers/registry";
import { jobTerminal } from "./terminal/jobTerminal";
import { CommandMirror } from "./terminal/mirror";
import { TerminalRunner } from "./terminal/runner";
import type { CoreTerminalTools } from "./terminal/coreTools";
import type { TerminalHistory } from "./terminal/history";
import { terminalReadTools } from "./terminal/readTools";
import { runInTerminalTool, sendInputTool } from "./terminal/tool";
import { gatedTool } from "./gate/gatedTool";
import type { AgentOptionView, Attachment, HostToPanel, SendMode, WorkspaceView } from "./ui/protocol";
import type { Checkpoints } from "./checkpoints";
import { cutHistory, type QueuedMessage, replayTranscript, type SessionRecord, type SessionStore, type TranscriptEvent, turnsAfter } from "./sessions";
import { createHash, randomUUID } from "node:crypto";
import { isAbsolute, relative, sep } from "node:path";
import type { WorkspaceInfo } from "./workspaces/worktrees";
import { MODE_INFO, PERMISSION_MODES, type PermissionMode, PLAN_NOTE, KERNL_MODES } from "./modes";


/** Our own harness (Deep Agents with the user's keys) is shown as "kernl"; its settings value stays `deepagents`. */
export const HARNESSES = [
  { id: "deepagents", label: "kernl" },
  ...Object.values(CLI_AGENTS).map((a) => ({ id: a.id, label: a.label })),
];

/** A named agent from .kernl/agents runs in the Deep Agents harness as `deepagents:<name>`. */
export const NAMED_AGENT_PREFIX = "deepagents:";

/** Built-ins, or any well-formed named agent id; whether that agent's file exists is checked when the agent is built. */
export function isHarness(value: unknown): value is string {
  return HARNESSES.some((h) => h.id === value) || (typeof value === "string" && /^deepagents:[a-z0-9-]+$/.test(value));
}

/** Services a workspace borrows from the window-wide controller. */
export interface RuntimeHost {
  log: Logger;
  post(message: HostToPanel): void;
  showApproval(workspace: WorkspaceRuntime, id: string, request: GateRequest): void;
  closeApproval(id: string): void;
  /** Why Deep Agents can't start (settings, key), or undefined. */
  deepAgentsProblem(): Promise<string | undefined>;
  providerSettings(): ProviderSettings & {
    mcpServers: unknown;
    mcpToolTimeoutSeconds: number;
    agentCommands: unknown;
    sequentialThinking?: boolean;
    terminal: { cliAgents: "kernl" | "agent"; outputLimit: number };
    browser: { cliAgents: boolean; timeoutSeconds: number };
  };
  sessions: SessionStore;
  checkpoints: Checkpoints;
  /** Where the user's own customisation lives (~/.kernl): AGENTS.md, agents/, skills/. */
  userDir: string;
  /** What kernl's own agent reuses from Claude Code, Codex, and OpenCode for a folder (the Sources settings). */
  sources(root: string, trusted: boolean): Promise<LoadedSources>;
  /** Asked before a project's MCP server first starts. */
  allowProjectServer(server: McpServer): Promise<boolean>;
  /** Whether the user already allowed this project server (never asks). */
  projectServerAllowed(server: McpServer): boolean;
  /** Remote MCP servers that wanted a sign-in in this window: skipped, and listed in the Sources view. */
  signInRequired: SignInRequired;
  /** What a run learned about a connection: an agent's login, a provider's answer, kernl's MCP servers (see src/connections). */
  connectionSignal(signal: RuntimeConnectionSignal, harness: string): void;
  /** Makes a workspace's tools reachable by its CLI agents (kernl's MCP server); the access holds until unregister. */
  kernlTools(tools: () => readonly StructuredToolInterface[]): Promise<KernlServerAccess & { unregister: () => void }>;
  /** The user's approval rules (user settings only), read on every gate decision. */
  approvalRules(): readonly Rule[];
  /** The provider's key and secret header values from SecretStorage. */
  providerAuth(provider: string): Promise<ProviderAuth>;
  /** Launch env from the agent's stored credential; empty when none is stored. */
  agentEnv(id: CliAgentId): Promise<Record<string, string>>;
  trusted(): boolean;
  browser(): IntegratedBrowser;
  workspacesChanged(): void;
  /** The window's terminals and what ran in them (see src/terminal/history.ts). */
  terminalHistory(): TerminalHistory;
  /** VS Code's own active-terminal tools (screen and selection), when present. */
  coreTerminalTools(): CoreTerminalTools | undefined;
  /** Removes kernl's known secrets (stored keys, header values) from text an agent will read. */
  scrub(text: string): string;
  /** VS Code's per-window state (workspaceState): the CLI agents' remembered model, thinking, and fast-mode choices. */
  state: Pick<vscode.Memento, "get" | "update">;
}

/** How long Conversations waits for a CLI agent's list of its sessions. */
const LIST_TIMEOUT_MS = 10_000;

/** A CLI agent's chips as last reported in this folder, and the user's own choices (option id -> value), applied to each new session. */
interface RememberedOptions {
  last?: AgentOptionView[];
  chosen?: Record<string, string | boolean>;
}

/**
 * One place the agent works: the main folder or a worktree workspace. Owns its harness choice,
 * its runner, its approvals, and its terminal; nothing here is shared with other workspaces
 * except the window's browser and keys.
 */
export class WorkspaceRuntime {
  readonly approvals: PendingApprovals;
  readonly gate: ApprovalGate;
  private runner: Runner | undefined;
  /** The live CLI session's chips, once it has reported them (cleared when the runner goes). */
  private liveOptions: AgentOptionView[] | undefined;
  /** The conversation shown in this workspace (kept in the session store). */
  private session: SessionRecord;
  /** History to continue from when the runner is created (a reopened or cut-back session). */
  private pendingHistory: unknown;
  /** Set while the pre-message snapshot is taken; counts as running. */
  private starting = false;
  /** Stop was pressed while the snapshot was being taken: the agent doesn't start. */
  private stopBeforeStart = false;
  /** Sequential thinking for the current conversation (kernl agent). */
  private thinking = new ThinkingLog();
  /** Long-running commands the kernl agent started; each has its own terminal. */
  private jobs: BackgroundJobs | undefined;
  private jobTerminals = new Map<string, vscode.Terminal>();
  /** Set while a runner is being built (it reads SecretStorage); counts as running. */
  private creating: Promise<Runner> | undefined;
  /** A send is waiting for its runner to be built (counts as running; building alone doesn't). */
  private awaitingRunner = false;
  /** A stored CLI session is loading (openAgentSession): messages sent meanwhile wait, then send. */
  private loadingSession = false;
  /** While an agent replays a stored session: its events, shown together once it ends (see openAgentSession). */
  private replayBuffer: TranscriptEvent[] | undefined;
  private lifecycle: AgentLifecycle | undefined;
  private terminal: TerminalRunner | undefined;
  /** Commands a CLI agent runs in its own shell (Codex), shown read-only. */
  private mirror: CommandMirror | undefined;
  /** This workspace's tools on kernl's MCP server, for its CLI agents. */
  private toolAccess: Promise<KernlServerAccess & { unregister: () => void }> | undefined;
  /** The gate for kernl's tools when a CLI agent calls them: the agent's Bypass mode skips the card; every other mode asks (deny rules always apply). */
  private readonly toolGate: ApprovalGate;
  /** Inputs changed during a run; rebuild once the run ends (never interrupt it). */
  private staleHarness: string | undefined;
  /** Messages to send after the current run, oldest first; also kept in the session store. */
  private queue: QueuedMessage[] = [];
  /** Queue writes, in order (each writes the queue as it was when it changed). */
  private queueSaving: Promise<void> = Promise.resolve();
  /** Set when a run was stopped or failed, or the conversation changed: the queue waits for Send now. */
  private queuePaused = false;
  /** How much the agent may do without asking (see modes.ts); checked against the agent's supported modes. */
  private permissionMode: PermissionMode = "ask";
  /** Edits the agent proposed or made, by tool call id, for a tool row's "View diff". */
  private toolDiffs = new Map<string, { path: string; before: string | null; after: string }>();
  /** How the last run ended; decides whether the queue carries on. */
  private lastFinish: "done" | "stopped" | "error" | undefined;

  constructor(
    readonly id: string,
    readonly label: string,
    readonly root: string,
    public harness: string,
    private host: RuntimeHost,
    readonly info?: WorkspaceInfo,
    /** Whether a change to kernl.harness switches this workspace's agent (a single folder's does; worktrees and multi-root folders keep their own). */
    private followsHarnessSetting = info === undefined,
  ) {
    this.approvals = new PendingApprovals(
      (approvalId, request) => host.showApproval(this, approvalId, request),
      (approvalId) => host.closeApproval(approvalId),
    );
    this.session = host.sessions.create(harness);
    void this.restoreQueue();
    // The first snapshot of a large workspace takes seconds; take it now so messages only pay the small increments.
    if (host.trusted()) void host.checkpoints.snapshot(root, "baseline").catch((err) => host.log.error(`[${label}] baseline snapshot failed`, err));
    this.gate = new ApprovalGate(this.approvals, {
      rules: () => host.approvalRules(),
      denied: (_request, rule) => this.post({ type: "notice", workspace: this.id, text: `Refused by your approval rule deny: ${rule}` }),
      // CLI agents enforce their own mode (their permission requests, like leaving plan mode, still ask here).
      mode: () => (isCliAgentId(this.harness) ? "ask" : this.permissionMode),
      refusedInPlan: (request) => this.post({ type: "notice", workspace: this.id, text: `Plan mode: refused ${request.kind === "execute" ? `running ${request.command}` : request.kind === "edit" || request.kind === "write" || request.kind === "delete" ? `changing ${request.path}` : "a change"}. Switch modes to make changes.` }),
    });
    this.toolGate = new ApprovalGate(this.approvals, {
      rules: () => host.approvalRules(),
      denied: (_request, rule) => this.post({ type: "notice", workspace: this.id, text: `Refused by your approval rule deny: ${rule}` }),
      // kernl's tools called by a CLI agent: no kernl card in Bypass (no prompts) or Auto (the agent
      // decides, and its own permission request becomes the card; see agentDecidesKernlTools).
      mode: () => (this.permissionMode === "bypass" || this.agentDecidesKernlTools() ? "bypass" : "ask"),
    });
  }

  /** Each part of "running" (the integration tests' failure timeline reads them), and the queue. */
  runState() {
    return {
      starting: this.starting,
      awaitingRunner: this.awaitingRunner,
      loadingSession: this.loadingSession,
      creating: this.creating !== undefined,
      runner: this.runner?.running ?? false,
      queue: this.queue.map((q) => q.text),
      queuePaused: this.queuePaused,
    };
  }

  /**
   * Whether a run is in progress: a send (taking its restore point, waiting for its runner, or the
   * agent replying) or a stored session loading. Building a runner on its own isn't a run (the early
   * start, prepareAgent). Each state counted here drains the queue when it ends.
   */
  get running() {
    const s = this.runState();
    return s.starting || s.awaitingRunner || s.loadingSession || s.runner;
  }

  view(): WorkspaceView {
    const modes = this.modeDisclosures();
    const disclosure = modes[this.permissionMode] ?? modes.ask!;
    const queue = this.queue.map((q) => ({ id: q.id, text: q.text, attachments: q.attachments.length }));
    const modeList = PERMISSION_MODES.filter((m) => modes[m]).map((m) => ({ id: m, label: MODE_INFO[m].label, icon: MODE_INFO[m].icon, description: modes[m]! }));
    const forkLimit = this.forkLimit();
    const agentOptions = this.agentOptions();
    return { id: this.id, label: this.label, harness: this.harness, branch: this.info?.branch, running: this.running, waiting: this.approvals.size, disclosure, queue, queuePaused: this.queuePaused, mode: this.permissionMode, modes: modeList, ...(forkLimit ? { forkLimit } : {}), ...(agentOptions ? { agentOptions } : {}) };
  }

  private optionsKey(harness = this.harness) {
    return `kernl.agentOptions.${this.root}.${harness}`;
  }

  private remembered(): RememberedOptions {
    return this.host.state.get<RememberedOptions>(this.optionsKey()) ?? {};
  }

  /**
   * A CLI agent's chips: the live session's, or before it starts, its last session's in this folder
   * with the user's choices shown (they're applied when the session starts). Undefined for kernl, or
   * before the agent has ever reported any.
   */
  private agentOptions(): AgentOptionView[] | undefined {
    if (!isCliAgentId(this.harness)) return undefined;
    if (this.liveOptions) return this.liveOptions;
    const { last, chosen = {} } = this.remembered();
    return last?.map((o) => (o.id in chosen ? { ...o, value: chosen[o.id] } : o));
  }

  /** The agent reported its options: shown now, and kept as this folder's "last" for the next start. */
  private agentReportedOptions(options: AgentOptionView[]) {
    this.liveOptions = options;
    void this.host.state.update(this.optionsKey(), { ...this.remembered(), last: options });
    this.host.workspacesChanged();
  }

  /**
   * The user picked a model, thinking level, or fast mode on a chip: remembered for this folder and
   * agent, and set on the live session now (or on the next one, before its first message).
   */
  async setAgentOption(id: string, value: string | boolean) {
    const harness = this.harness;
    const r = this.remembered();
    await this.host.state.update(this.optionsKey(harness), { ...r, chosen: { ...r.chosen, [id]: value } });
    try {
      if (!(this.runner instanceof AcpRunner && (await this.runner.setOption(id, value)))) this.host.workspacesChanged();
    } catch (err: any) {
      const name = this.agentOptions()?.find((o) => o.id === id)?.name ?? id;
      this.post({ type: "notice", workspace: this.id, text: `${CLI_AGENTS[harness as CliAgentId]?.label ?? harness} didn't change ${name}: ${err?.message ?? err}` });
    }
  }

  /** A CLI agent copies its whole session to fork (ACP session/fork), so only the latest turn can fork. */
  private forkLimit(): string | undefined {
    return isCliAgentId(this.harness) ? `${CLI_AGENTS[this.harness].label.replace(/ \(experimental\)$/, "")} can fork only from the last message` : undefined;
  }

  /** The current agent's supported modes, each with what it means for this agent. */
  private modeDisclosures(harness = this.harness): Partial<Record<PermissionMode, string>> {
    if (!isCliAgentId(harness)) return KERNL_MODES;
    return Object.fromEntries(Object.entries(CLI_AGENTS[harness].modes).map(([m, spec]) => [m, spec!.disclosure]));
  }

  get mode(): PermissionMode {
    return this.permissionMode;
  }

  /** A mode the current agent supports, else "ask" (after an agent change, or a stored mode it no longer offers). */
  private supportedMode(mode: PermissionMode, harness = this.harness): PermissionMode {
    return this.modeDisclosures(harness)[mode] ? mode : "ask";
  }

  /**
   * Switches the permission mode. kernl applies it at its gate at once; a CLI agent's live
   * session is switched and confirmed (refused: the previous mode stays). A mode that needs a
   * different launch environment (OpenCode's edit permissions) relaunches the agent and reloads
   * the conversation.
   */
  async setMode(mode: PermissionMode): Promise<void> {
    if (this.supportedMode(mode) !== mode || mode === this.permissionMode) return;
    const previous = this.permissionMode;
    if (isCliAgentId(this.harness)) {
      const spec = CLI_AGENTS[this.harness];
      const relaunch = JSON.stringify(spec.modes[previous]?.env ?? {}) !== JSON.stringify(spec.modes[mode]?.env ?? {});
      if (relaunch && this.running) throw new Error(`Stop ${spec.label} before switching to ${MODE_INFO[mode].label}: it restarts the agent.`);
      this.permissionMode = mode;
      if (relaunch) {
        this.pendingHistory = (await this.runner?.exportHistory()) ?? this.pendingHistory;
        this.reset();
      } else {
        try {
          await this.runner?.applyMode?.();
        } catch (err) {
          this.permissionMode = previous;
          // Put the session back in the mode it was in; if even that can't be confirmed, start over.
          await this.runner?.applyMode?.().catch(() => this.reset());
          this.host.workspacesChanged();
          throw err;
        }
      }
    } else this.permissionMode = mode;
    this.post({ type: "notice", workspace: this.id, text: `Permission mode: ${MODE_INFO[mode].label}.` });
    this.host.workspacesChanged();
  }

  /** `path` relative to this workspace when it's inside it; otherwise as given. */
  private workspacePath(path: string): string {
    const inside = relative(this.root, path);
    return isAbsolute(path) && inside && !inside.startsWith("..") && !isAbsolute(inside) ? inside.split(sep).join("/") : path;
  }

  /** A tool call's edit, for "View diff" (undefined once the conversation changed). */
  toolDiff(id: string) {
    return this.toolDiffs.get(id);
  }

  /**
   * The agent changed its own options (e.g. Claude Code leaving plan mode once the plan is
   * approved): the mode chip follows, so it never claims a mode the agent isn't in.
   */
  private agentChangedConfig(values: Record<string, string>) {
    if (!isCliAgentId(this.harness)) return;
    const modes = CLI_AGENTS[this.harness].modes;
    const matches = (m: PermissionMode) => {
      const session = modes[m]?.session;
      if (!session) return false;
      const wanted = session.kind === "configOption" ? [session] : session.kind === "configOptions" ? session.options : [];
      return wanted.length > 0 && wanted.every((o) => values[o.optionId] === undefined || values[o.optionId] === o.value) && wanted.some((o) => values[o.optionId] !== undefined);
    };
    if (matches(this.permissionMode)) return;
    const now = PERMISSION_MODES.find(matches);
    if (!now) return;
    this.permissionMode = now;
    this.post({ type: "notice", workspace: this.id, text: `${CLI_AGENTS[this.harness].label} switched to ${MODE_INFO[now].label}.` });
    this.host.workspacesChanged();
  }

  /**
   * In Auto mode the CLI agent judges each call, kernl's tools included: kernl adds no card of its own,
   * and the agent's permission request for a kernl tool is shown as the card. Read on every call, so a
   * mode change applies mid-run.
   */
  private agentDecidesKernlTools(): boolean {
    return this.permissionMode === "auto";
  }

  /** The mode kept for this workspace, applied before any session starts. */
  restoreMode(mode: PermissionMode) {
    this.permissionMode = this.supportedMode(mode);
  }

  /**
   * The composer's send actions. "now" sends, or queues while the agent runs (or while earlier
   * messages wait); "queue" always waits its turn; "fork" sends in a fork of this conversation.
   */
  async submit(text: string, attachments: readonly Attachment[], mode: SendMode = "now") {
    const trimmed = text.trim();
    if (!trimmed) return;
    if (mode === "fork") return this.sendForked(trimmed, attachments);
    const waiting = this.running || (mode === "queue" && this.queue.length > 0);
    if (!waiting) return this.send(trimmed, attachments);
    this.queue.push({ id: randomUUID(), text: trimmed, attachments: [...attachments] });
    this.queueChanged();
  }

  unqueue(id: string) {
    this.queue = this.queue.filter((q) => q.id !== id);
    if (!this.queue.length) this.queuePaused = false;
    this.queueChanged();
  }

  /** Sends a queued message now; while the agent runs, it goes next. Either way the queue carries on. */
  sendQueued(id: string) {
    const item = this.queue.find((q) => q.id === id);
    if (!item) return;
    this.queue = [item, ...this.queue.filter((q) => q !== item)];
    this.queuePaused = false;
    this.queueChanged();
    this.sendNextQueued();
  }

  private sendNextQueued() {
    if (this.queuePaused || this.running) return;
    const next = this.queue.shift();
    if (!next) return;
    this.queueChanged();
    void this.send(next.text, next.attachments);
  }

  /** Saves the queue and shows it. */
  private queueChanged() {
    const items = [...this.queue];
    this.queueSaving = this.queueSaving.then(() => this.host.sessions.saveQueue(this.sessionKey, items)).catch((err) => this.host.log.error(`[${this.label}] could not save the queued messages`, err));
    this.host.workspacesChanged();
  }

  /** Messages queued before the window reloaded come back paused: they were written for a conversation that is no longer on screen. */
  private async restoreQueue() {
    try {
      const saved = await this.host.sessions.loadQueue(this.sessionKey);
      if (!saved.length) return;
      this.queue = [...saved, ...this.queue];
      this.queuePaused = true;
      this.queueChanged();
    } catch (err) {
      this.host.log.error(`[${this.label}] could not read the queued messages`, err);
    }
  }

  /** Queued messages were written for the conversation on screen; when it changes they wait for Send now. */
  private holdQueue() {
    if (this.queue.length) this.queuePaused = true;
  }

  /** Forks this conversation at its last message, then sends `text` there. With no messages yet it just sends. */
  private async sendForked(text: string, attachments: readonly Attachment[]) {
    if (this.running) throw new Error("Stop the agent before sending in a forked session.");
    const last = [...this.session.events].reverse().find((e) => e.type === "userMessage" && e.id !== undefined) as Extract<TranscriptEvent, { type: "userMessage" }> | undefined;
    if (last?.id) await this.fork(last.id);
    await this.send(text, attachments);
  }

  async send(text: string, attachments: readonly Attachment[] = []) {
    const trimmed = text.trim();
    if (!trimmed || this.running) return;
    this.starting = true;
    this.stopBeforeStart = false;
    // The message and the running state show at once: the restore point below can take a while on a
    // large folder, and the agent waits for it (Restore must reflect the files before the agent ran).
    const turn = this.session.events.filter((e) => e.type === "userMessage").length;
    const message: Extract<TranscriptEvent, { type: "userMessage" }> = { type: "userMessage", workspace: this.id, text: trimmed, attachments: attachments.length ? [...attachments] : undefined, id: randomUUID(), turn };
    this.post(message);
    this.host.workspacesChanged();
    let checkpoint: string | undefined;
    try {
      checkpoint = this.host.trusted() ? await this.host.checkpoints.snapshot(this.root, `before: ${trimmed.slice(0, 60)}`) : undefined;
    } catch (err) {
      this.host.log.error(`[${this.label}] snapshot failed; this message can't be restored`, err);
    } finally {
      this.starting = false;
    }
    if (checkpoint) {
      message.checkpoint = checkpoint; // the session keeps this same message
      this.host.post({ type: "checkpoint", workspace: this.id, messageId: message.id!, checkpoint });
    }
    if (this.stopBeforeStart) {
      this.post({ type: "finished", workspace: this.id, reason: "stopped" });
      this.holdQueue();
      await this.saveSession();
      this.host.workspacesChanged();
      return;
    }
    let runner: Runner;
    try {
      // Building a runner reads SecretStorage; hold the promise so a second Send can't start a second agent.
      this.creating ??= this.createRunner().finally(() => (this.creating = undefined));
      this.awaitingRunner = true;
      runner = this.runner ??= await this.creating;
    } catch (err: any) {
      this.awaitingRunner = false;
      this.post({ type: "finished", workspace: this.id, reason: "error", message: err?.message ?? String(err) });
      this.holdQueue();
      if (this.staleHarness !== undefined) this.rebuild(this.staleHarness);
      this.host.workspacesChanged();
      return;
    }
    // From here to runner.send() nothing waits, so the runner reports running before this clears.
    this.awaitingRunner = false;
    this.lastFinish = undefined;
    // The kernl agent is told it's in plan mode (its gate refuses changes either way).
    const forAgent = !isCliAgentId(this.harness) && this.permissionMode === "plan" ? PLAN_NOTE + trimmed : trimmed;
    const sending = runner.send(forAgent, attachments);
    this.host.workspacesChanged();
    await sending;
    await this.saveSession();
    // Only a run that finished normally carries on with the queue; after Stop or an error the user decides.
    if (this.lastFinish !== "done") this.holdQueue();
    if (this.staleHarness !== undefined) this.rebuild(this.staleHarness);
    this.host.workspacesChanged();
    this.sendNextQueued();
  }

  get isMain() {
    return this.followsHarnessSetting;
  }

  /**
   * Something this workspace's agent may be built from changed. Unaffected workspaces ignore it;
   * a running one finishes its run first and rebuilds afterwards.
   */
  inputsChanged(change: InputChange) {
    if (!needsRebuild({ harness: this.harness, isMain: this.isMain }, change)) return;
    const harness = change.kind === "settings" && this.isMain && change.affects("kernl.harness") ? change.mainHarness : this.harness;
    if (this.running) this.staleHarness = harness;
    else this.rebuild(harness);
  }

  private rebuild(harness: string) {
    this.staleHarness = undefined;
    this.holdQueue();
    this.reset();
    this.harness = isHarness(harness) ? harness : this.harness;
    this.permissionMode = this.supportedMode(this.permissionMode);
    this.post({ type: "notice", workspace: this.id, text: "Settings changed: the next message starts a new conversation." });
  }

  stop() {
    if (this.starting) this.stopBeforeStart = true;
    this.runner?.stop();
  }

  /** New chat: the current conversation stays in the history; a new one starts. */
  newThread() {
    void this.saveSession();
    this.holdQueue();
    this.thinking.reset();
    this.session = this.host.sessions.create(this.harness);
    this.pendingHistory = undefined;
    this.runner?.newThread();
    this.host.post({ type: "cleared", workspace: this.id });
  }

  setHarness(harness: string) {
    if (harness === this.harness) return;
    void this.saveSession();
    this.holdQueue();
    this.reset();
    this.harness = harness;
    this.permissionMode = this.supportedMode(this.permissionMode);
    this.session = this.host.sessions.create(harness);
    this.host.post({ type: "cleared", workspace: this.id });
  }

  /** Where this workspace's sessions are stored: one folder per workspace root. */
  get sessionKey() {
    return createHash("sha256").update(this.root).digest("hex").slice(0, 16);
  }

  get sessionId() {
    return this.session.id;
  }

  /**
   * Keeps a conversation (and what the agent needs to continue it) in the session store. Everything
   * is read when the save starts, before any await: New Chat and an agent switch replace
   * `this.session` and the runner's thread right after starting a save of the one they leave.
   * Only the conversation on screen takes the runner's history and harness; another one (a preview
   * that arrived after New Chat) is saved as it is.
   */
  async saveSession(session = this.session) {
    const current = session === this.session;
    const exporting = current ? this.runner?.exportHistory() : undefined;
    const harness = this.harness;
    const key = this.sessionKey;
    try {
      const history = await exporting;
      if (history !== undefined) session.history = history;
    } catch (err) {
      this.host.log.error(`[${this.label}] could not read the conversation to save it`, err);
    }
    if (current) session.harness = harness;
    await this.host.sessions.save(key, session).catch((err) => this.host.log.error(`[${this.label}] could not save the conversation`, err));
  }

  /** Shows a stored conversation and continues it with its agent (the caller switched the harness to match). */
  async openSession(record: SessionRecord) {
    if (this.running) return;
    await this.saveSession();
    this.session = record;
    this.thinking.reset();
    this.pendingHistory = record.history;
    if (this.runner) {
      this.runner.newThread(record.history);
      this.pendingHistory = undefined;
    }
    this.replay();
    const agentSession = (record.history as { sessionId?: unknown } | undefined)?.sessionId;
    if (isCliAgentId(this.harness) && !record.importedFrom && typeof agentSession === "string") await this.addTurnsFromAgent(record);
  }

  /**
   * kernl's own CLI conversation, reopened: the agent loads the session now, and the turns it has after
   * kernl's last message (added in a terminal or another app since) are added below kernl's transcript,
   * which keeps its Restore points. If the session can't be loaded now, it's loaded on the next send, as before.
   */
  private async addTurnsFromAgent(record: SessionRecord) {
    this.loadingSession = true;
    this.replayBuffer = [];
    let failed: string | undefined;
    try {
      this.creating ??= this.createRunner().finally(() => (this.creating = undefined));
      const runner = (this.runner ??= await this.creating);
      failed = runner instanceof AcpRunner ? await runner.loadNow() : "not an ACP agent";
      if (failed) runner.newThread(record.history);
    } catch (err: any) {
      failed = err?.message ?? String(err);
    } finally {
      this.loadingSession = false;
    }
    const replayed = this.replayBuffer;
    this.replayBuffer = undefined;
    if (failed) this.host.log.info(`[${this.label}] couldn't load the agent's session to look for turns added elsewhere: ${failed}`);
    else {
      const lastUser = [...record.events].reverse().find((e) => e.type === "userMessage") as Extract<TranscriptEvent, { type: "userMessage" }> | undefined;
      const added = turnsAfter(replayed, lastUser?.text);
      if (added === undefined) this.host.log.info(`[${this.label}] the agent's session doesn't contain kernl's last message (changed elsewhere?); nothing added`);
      else if (added.length) {
        this.post({ type: "notice", workspace: this.id, text: "Added in another app since this conversation was last open in kernl:" });
        for (const e of replayTranscript(added, this.id)) this.post(e);
        await this.saveSession();
      }
    }
    this.host.workspacesChanged();
    this.sendNextQueued();
  }

  /** Shows this session's transcript again (after switching or cutting it). */
  private replay() {
    this.holdQueue();
    this.host.post({ type: "cleared", workspace: this.id });
    for (const e of this.session.events) this.host.post(e);
  }

  /**
   * A new conversation with this one's history up to and including `messageId`'s reply; files
   * are not touched. The kernl agent can fork from any message; a CLI agent that supports
   * ACP session/fork copies its whole session, so only from the last message.
   */
  async fork(messageId: string): Promise<void> {
    if (this.running) throw new Error("Stop the agent before forking.");
    const at = this.session.events.findIndex((e) => e.type === "userMessage" && e.id === messageId);
    if (at < 0) return;
    const nextUser = this.session.events.findIndex((e, i) => i > at && e.type === "userMessage");
    const turn = (this.session.events[at] as Extract<TranscriptEvent, { type: "userMessage" }>).turn ?? 0;
    let history: unknown;
    if (isCliAgentId(this.harness)) {
      const label = CLI_AGENTS[this.harness].label;
      if (nextUser >= 0) throw new Error(`${this.forkLimit()}: it copies its whole conversation.`);
      history = await this.runner?.forkSession?.();
      if (history === undefined) throw new Error(`${label} can't fork conversations${this.runner ? "" : " yet (send a message first)"}.`);
    } else {
      history = cutHistory((await this.runner?.exportHistory().catch(() => undefined)) ?? this.session.history, turn + 1);
    }
    await this.saveSession();
    const forked = this.host.sessions.create(this.harness);
    forked.events = this.session.events.slice(0, nextUser < 0 ? undefined : nextUser);
    forked.history = history;
    forked.forkOf = this.session.id;
    this.session = forked;
    this.thinking.reset();
    if (!isCliAgentId(this.harness)) {
      // The CLI runner already continues in its forked session; the kernl agent starts from the cut history.
      this.pendingHistory = history;
      if (this.runner) {
        this.runner.newThread(history);
        this.pendingHistory = undefined;
      }
    }
    this.replay();
    this.post({ type: "notice", workspace: this.id, text: "Forked: this is a new conversation; the original is in Conversations." });
    await this.saveSession();
  }

  /** The user message with `messageId`, and its checkpoint, for Restore. */
  checkpointOf(messageId: string) {
    const index = this.session.events.findIndex((e) => e.type === "userMessage" && e.id === messageId);
    const event = this.session.events[index] as Extract<TranscriptEvent, { type: "userMessage" }> | undefined;
    return event?.checkpoint ? { index, event, checkpoint: event.checkpoint } : undefined;
  }

  /**
   * Puts the files back to before `messageId`. With `cutConversation`, the conversation also goes
   * back to before it: later messages are removed and the message text returns to the composer.
   * Returns a checkpoint of the files as they were just before restoring (for Undo).
   */
  async restore(messageId: string, cutConversation: boolean): Promise<string> {
    const at = this.checkpointOf(messageId);
    if (!at) throw new Error("That message has no checkpoint.");
    if (this.running) throw new Error("Stop the agent before restoring.");
    const undo = await this.host.checkpoints.snapshot(this.root, "before restore");
    await this.host.checkpoints.restore(this.root, at.checkpoint);
    if (cutConversation) {
      const history = (await this.runner?.exportHistory().catch(() => undefined)) ?? this.session.history;
      this.session.events = this.session.events.slice(0, at.index);
      this.thinking.reset();
      this.session.history = cutHistory(history, at.event.turn ?? 0);
      this.pendingHistory = this.session.history;
      if (this.runner) {
        this.runner.newThread(this.session.history);
        this.pendingHistory = undefined;
      }
      this.replay();
      this.host.post({ type: "setInput", workspace: this.id, text: at.event.text });
      await this.saveSession();
    }
    return undo;
  }

  /** Drop the runner; the next message builds a fresh one. */
  private reset() {
    this.runner?.dispose();
    this.runner = undefined;
    this.liveOptions = undefined;
    void this.lifecycle?.invalidate();
  }

  dispose() {
    this.reset();
    this.approvals.denyAll();
    this.terminal?.dispose();
    this.mirror?.dispose();
    this.jobs?.dispose();
    void this.toolAccess?.then((a) => a.unregister());
  }

  /** Background jobs, for the footer's jobs menu. */
  jobList(): JobView[] {
    return this.jobs?.list() ?? [];
  }

  showJob(id: string) {
    this.jobTerminals.get(id)?.show();
  }

  stopJob(id: string) {
    this.jobs?.stop(id);
  }

  /** Each job gets a terminal showing its output; closing the terminal stops the job. */
  private backgroundJobs(): BackgroundJobs {
    this.jobs ??= new BackgroundJobs(
      this.root,
      (job) => {
        const display = jobTerminal(job, () => this.jobs?.stop(job.id));
        this.jobTerminals.set(job.id, display.terminal);
        return display;
      },
      () => this.host.post({ type: "jobs", workspace: this.id, running: this.jobs?.running ?? 0, total: this.jobs?.list().length ?? 0 }),
    );
    return this.jobs;
  }

  /**
   * A tool's image is saved as a file (not inside the conversation) and the conversation keeps its
   * path, so the preview comes back after a reload without the conversation growing by megabytes.
   */
  private async savePreview(callId: string, image: { mimeType: string; data: string }) {
    const session = this.session;
    const file = await this.host.sessions.savePreview(session.id, callId, image).catch((err) => {
      this.host.log.error(`[${this.label}] couldn't save a tool image`, err);
      return undefined;
    });
    if (!file) return;
    // The preview belongs to the conversation the image came from: shown only if that's still the
    // one on screen, and saved either way (it usually arrives after the run's own save).
    const preview = { type: "toolPreview" as const, workspace: this.id, id: callId, file };
    if (this.session === session) this.post(preview);
    else session.events.push(preview);
    await this.saveSession(session);
  }

  /** Everything shown for this workspace is also kept in its session ("cleared" only resets the view). */
  private post(m: TranscriptEvent) {
    // An agent's replay of a stored session is collected first, then shown (see openAgentSession).
    if (this.replayBuffer && m.type !== "cleared") return void this.replayBuffer.push(m);
    this.host.post(m);
    if (m.type !== "cleared") this.session.events.push(m);
  }

  /** A user message of a replayed session; consecutive parts of one message are joined. */
  private replayedUserMessage(text: string) {
    const events = this.replayBuffer ?? this.session.events;
    const last = events.at(-1);
    if (last?.type === "userMessage") return void (last.text += text);
    const turn = events.filter((e) => e.type === "userMessage").length;
    this.post({ type: "userMessage", workspace: this.id, text, id: randomUUID(), turn });
  }

  /**
   * Opens a CLI agent's stored session (`record.importedFrom`): the agent loads it (ACP session/load)
   * and its replay becomes the transcript, so turns added in a terminal or another app show; sending
   * continues it. A record opened before is loaded again. The caller switched the harness to the agent.
   * `notice`: shown above it (e.g. the session is open in another app).
   */
  async openAgentSession(record: SessionRecord, notice?: string) {
    if (this.running || !record.importedFrom || !isCliAgentId(this.harness)) return;
    this.loadingSession = true;
    try {
      await this.loadAgentSession(record, notice);
    } finally {
      this.loadingSession = false;
      this.host.workspacesChanged();
      this.sendNextQueued();
    }
  }

  private async loadAgentSession(record: SessionRecord, notice?: string) {
    if (!record.importedFrom || !isCliAgentId(this.harness)) return;
    await this.saveSession();
    this.session = record;
    record.events = [];
    this.thinking.reset();
    this.holdQueue();
    this.host.post({ type: "cleared", workspace: this.id });
    if (notice) this.post({ type: "notice", workspace: this.id, text: notice });
    let failed: string | undefined;
    const label = CLI_AGENTS[this.harness].label;
    this.replayBuffer = [];
    try {
      this.creating ??= this.createRunner().finally(() => (this.creating = undefined));
      const runner = (this.runner ??= await this.creating);
      runner.newThread({ sessionId: record.importedFrom.sessionId });
      failed = runner instanceof AcpRunner ? await runner.loadNow() : "not an ACP agent";
    } catch (err: any) {
      failed = err?.message ?? String(err);
    }
    const replayed = this.replayBuffer;
    this.replayBuffer = undefined;
    for (const e of replayTranscript(replayed, this.id)) this.post(e);
    if (failed) this.post({ type: "notice", workspace: this.id, text: `${label} couldn't load this session (${failed}). Sending starts a new one.` });
    await this.saveSession();
    this.host.workspacesChanged();
  }

  /**
   * Starts this workspace's CLI agent session now, before any message, so its model, thinking, and
   * fast chips show and can be chosen first; the first message uses it. Only for a CLI agent in a
   * trusted workspace, while idle. A failure is logged: the first message reports it as usual.
   */
  async prepareAgent() {
    if (!isCliAgentId(this.harness) || !this.host.trusted() || this.running || this.starting) return;
    try {
      this.creating ??= this.createRunner().finally(() => (this.creating = undefined));
      const runner = (this.runner ??= await this.creating);
      const failed = runner instanceof AcpRunner ? await runner.prepare() : undefined;
      if (failed) this.host.log.info(`[${this.label}] ${CLI_AGENTS[this.harness].label} didn't start before the first message: ${failed}`);
    } catch (err: any) {
      this.host.log.info(`[${this.label}] ${CLI_AGENTS[this.harness]?.label ?? this.harness} didn't start before the first message: ${err?.message ?? err}`);
    }
  }

  /**
   * A CLI agent's stored sessions for this folder (ACP session/list), or undefined when it can't list
   * them or doesn't start. The agent runs briefly on its own, apart from this workspace's session.
   */
  async listAgentSessions(agent: CliAgentId): Promise<acp.SessionInfo[] | undefined> {
    if (!this.host.trusted()) return undefined;
    const settings = this.host.providerSettings();
    const launch = resolveLaunch(agent, settings.agentCommands, await this.host.agentEnv(agent), "ask", { tools: false, terminal: false });
    if ("error" in launch) return undefined;
    const quiet = { text() {}, toolCall() {}, toolResult() {}, usage() {}, finished() {} };
    const runner = new AcpRunner({ agentLabel: CLI_AGENTS[agent].label, launch, mode: () => ({ kind: "environment" }), cwd: this.root, gate: this.gate, events: quiet, log: (line) => this.host.log.info(line) });
    let timer: NodeJS.Timeout | undefined;
    // Conversations waits for the lists: an agent that doesn't answer is left out, not waited for.
    const timeout = new Promise<never>((_, reject) => (timer = setTimeout(() => reject(new Error(`no answer in ${LIST_TIMEOUT_MS / 1000} s`)), LIST_TIMEOUT_MS)));
    try {
      return await Promise.race([runner.listSessions(), timeout]);
    } catch (err: any) {
      this.host.log.info(`[${this.label}] ${CLI_AGENTS[agent].label} couldn't list its sessions: ${err?.message ?? err}`);
      return undefined;
    } finally {
      clearTimeout(timer);
      runner.dispose();
    }
  }

  private events(): SessionEvents {
    const ws = this.id;
    return {
      text: (delta) => this.post({ type: "text", workspace: ws, delta }),
      toolCall: (id, name, args, info) =>
        this.post({
          type: "toolCall",
          workspace: ws,
          id,
          name,
          args: JSON.stringify(args).slice(0, 2000),
          ...info,
          // Paths inside the workspace are shown relative to it, like everything else in the panel.
          ...(info?.locations ? { locations: info.locations.map((l) => ({ ...l, path: this.workspacePath(l.path) })) } : {}),
          ...(info?.diff ? { diff: { ...info.diff, path: this.workspacePath(info.diff.path) } } : {}),
        }),
      toolDiff: (id, diff) => this.toolDiffs.set(id, diff),
      thinking: (delta) => delta && this.post({ type: "thinking", workspace: ws, delta }),
      plan: (entries) => this.post({ type: "plan", workspace: ws, entries }),
      context: (usage) => this.post({ type: "context", workspace: ws, ...usage }),
      commands: (items) => this.post({ type: "commands", workspace: ws, items }),
      title: (title) => {
        this.session.agentTitle = title;
        this.host.workspacesChanged();
      },
      configChanged: (values) => this.agentChangedConfig(values),
      agentOptions: (options) => this.agentReportedOptions(options),
      replayedUserMessage: (text) => this.replayedUserMessage(text),
      toolResult: (id, name, output, failed) => this.post({ type: "toolResult", workspace: ws, id, name, output: output.slice(0, 4000), ...(failed ? { failed: true } : {}) }),
      toolImage: (id, image) => void this.savePreview(id, image),
      usage: (inputTokens, outputTokens) => this.post({ type: "usage", workspace: ws, inputTokens, outputTokens }),
      subagentText: (id, delta) => this.post({ type: "subagentText", workspace: ws, id, delta }),
      providerAnswered: (result) => this.host.connectionSignal({ type: "provider", rejected: result.rejected }, this.harness),
      finished: (reason, message) => {
        this.lastFinish = reason;
        if (message) this.host.log.error(`[${this.label}] run ${reason}`, message);
        this.post({ type: "finished", workspace: ws, reason, message });
      },
    };
  }

  private async createRunner(): Promise<Runner> {
    if (!isCliAgentId(this.harness)) {
      this.lifecycle ??= new AgentLifecycle(() => this.buildDeepAgent());
      const lifecycle = this.lifecycle;
      return this.withHistory(new AgentSession(() => lifecycle.get(), this.events(), () => this.approvals.denyAll()));
    }
    const spec = CLI_AGENTS[this.harness];
    if (!this.host.trusted()) {
      throw new Error(`${spec.label} can't run in Restricted Mode: its read-only limits can't be enforced on an external agent. Trust the workspace, or use Deep Agents.`);
    }
    const settings = this.host.providerSettings();
    const use: KernlToolUse = { tools: settings.terminal.cliAgents === "kernl" || settings.browser.cliAgents, terminal: settings.terminal.cliAgents === "kernl" };
    const launch = resolveLaunch(spec.id, settings.agentCommands, await this.host.agentEnv(spec.id), this.permissionMode, use);
    if ("error" in launch) throw new Error(launch.error);
    return this.withHistory(new AcpRunner({
      notice: (text) => this.post({ type: "notice", workspace: this.id, text }),
      agentLabel: spec.label,
      launch,
      mode: () => (spec.modes[this.permissionMode] ?? spec.modes.ask).session,
      cwd: this.root,
      gate: this.gate,
      events: this.events(),
      onStop: () => this.approvals.denyAll(),
      log: (line) => this.host.log.info(line),
      sessionSetup: async () => {
        if (!use.tools) return { mcpServers: [] };
        const access = await (this.toolAccess ??= this.host.kernlTools(() => this.cliAgentTools()));
        const headers = Object.entries(access.headers).map(([name, value]) => ({ name, value }));
        return { mcpServers: [{ type: "http" as const, name: KERNL_SERVER_NAME, url: access.url, headers }], meta: sessionMeta(spec.id, use) };
      },
      connection: (signal) => this.host.connectionSignal(signal, spec.id),
      rememberedOptions: () => this.host.state.get<RememberedOptions>(this.optionsKey(spec.id))?.chosen ?? {},
      agentDecidesKernlTools: () => this.agentDecidesKernlTools(),
      loginHint: `Run \`${loginCommand(spec.id)}\` in a terminal, or use Log in in kernl: Show connections.`,
      commandOutput: (event) => (this.mirror ??= new CommandMirror(`${spec.label.replace(/ \(.*\)$/, "")}: ${this.label}`)).show(event),
    }));
  }

  /** The kernl terminal for this workspace: one visible VS Code terminal that runs the agents' commands. */
  private kernlTerminal(): TerminalRunner {
    this.terminal ??= new TerminalRunner({
      cwd: this.root,
      // A single folder's is "kernl"; each folder of a multi-root window and each worktree gets its own name.
      name: this.id === "main" ? "kernl" : `kernl: ${this.label}`,
      currentSignal: () => (this.runner as AgentSession | undefined)?.signal,
      outputLimit: () => this.host.providerSettings().terminal.outputLimit,
      onShellIntegrationMissing: (message) =>
        void vscode.window.showWarningMessage(message, "Open setting").then((pick) => pick && vscode.commands.executeCommand("workbench.action.openSettings", "terminal.integrated.shellIntegration.enabled")),
    });
    return this.terminal;
  }

  /** kernl's tools for this workspace's CLI agent (Terminal and Browser settings), read on every request so a settings change applies at once. */
  private cliAgentTools(): StructuredToolInterface[] {
    const s = this.host.providerSettings();
    const tools: StructuredToolInterface[] = [];
    if (s.terminal.cliAgents === "kernl") {
      tools.push(gatedTool(runInTerminalTool(this.toolGate, (command, signal) => this.kernlTerminal().run(command, signal)) as any, this.toolGate, "allow"));
      tools.push(gatedTool(sendInputTool(this.toolGate, (text, signal) => this.kernlTerminal().sendInput(text, signal)) as any, this.toolGate, "allow"));
      tools.push(...jobTools(this.backgroundJobs(), this.toolGate));
    }
    if (s.browser.cliAgents) tools.push(...browserTools(this.host.browser(), this.toolGate));
    tools.push(...terminalReadTools(this.host.terminalHistory(), this.toolGate, this.host.coreTerminalTools(), this.host.scrub));
    return tools;
  }

  private withHistory<R extends Runner>(runner: R): R {
    if (this.pendingHistory !== undefined) runner.newThread(this.pendingHistory);
    this.pendingHistory = undefined;
    return runner;
  }

  /**
   * kernl.mcpServers, then the imported servers; one that can't connect is a notice, and the rest
   * still load. One that wants a sign-in (OAuth) is a log line, remembered for the window, and listed
   * in the Sources view instead. Every server's outcome goes to the connection monitor.
   * `check`: for the Connections view's Check now: never asks to start a project server (one not
   * allowed yet is listed as such), and posts no notices.
   */
  private async loadMcp(s: ReturnType<RuntimeHost["providerSettings"]>, imported: LoadedSources["imports"]["mcpServers"], options: { check?: boolean } = {}) {
    const { servers } = mergeServers(settingServers(s.mcpServers), imported);
    const signIn = this.host.signInRequired;
    const allow = options.check ? async (server: McpServer) => this.host.projectServerAllowed(server) : (server: McpServer) => this.host.allowProjectServer(server);
    const mcp = await loadMcpTools(servers.filter((server) => !signIn.has(server)), this.gate, { timeoutMs: s.mcpToolTimeoutSeconds * 1000, allowProjectServer: allow, log: (line) => this.host.log.info(`[${this.label}] ${line}`) });
    this.host.connectionSignal(
      {
        type: "kernlMcp",
        servers: [
          ...mcp.connected.map((c) => ({ name: c.server.name, origin: c.server.origin, state: "ready" as const, detail: `Connected · ${c.tools} tool${c.tools === 1 ? "" : "s"}` })),
          ...mcp.failures.map((f) => ({
            name: f.server.name,
            origin: f.server.origin,
            state: f.signIn ? ("needsAction" as const) : f.reason === "not allowed to start in this workspace" ? ("off" as const) : ("failed" as const),
            detail: f.reason === "not allowed to start in this workspace" && options.check ? "A project server: asks before it first starts" : f.reason,
          })),
          // Servers that wanted a sign-in earlier in this window aren't tried again; they stay listed.
          ...servers.filter((server) => signIn.has(server)).map((server) => ({ name: server.name, origin: server.origin, state: "needsAction" as const, detail: SIGN_IN_REASON })),
        ],
      },
      "deepagents",
    );
    for (const f of mcp.failures) {
      this.host.log.info(`[${this.label}] MCP server ${f.server.name} (${f.server.origin}) not loaded: ${f.reason}`);
      if (f.signIn) signIn.add(f.server);
      else if (!options.check) this.post({ type: "notice", workspace: this.id, text: `The MCP server ${f.server.name} (${f.server.origin}) isn't available: ${f.reason}` });
    }
    return mcp;
  }

  /** For the Connections view: connects to kernl's MCP servers, reports each one, and closes them again. */
  async checkMcp() {
    if (!this.host.trusted()) return this.host.connectionSignal({ type: "kernlMcp", servers: [] }, "deepagents");
    const { imports } = await this.host.sources(this.root, true);
    const mcp = await this.loadMcp(this.host.providerSettings(), imports.mcpServers, { check: true });
    await mcp.close();
  }

  private async buildDeepAgent(): Promise<BuiltParts> {
    const problem = await this.host.deepAgentsProblem();
    if (problem) throw new Error(problem);
    const s = this.host.providerSettings();
    const auth = await this.host.providerAuth(s.provider);
    const model = createChatModel(s, auth);
    const trusted = this.host.trusted();
    const { imports, commandsDir } = await this.host.sources(this.root, trusted);
    const instructions = await assembleInstructions({ userDir: this.host.userDir, projectRoot: this.root, trusted, imported: imports.instructions });
    const named = await loadNamedAgents({ userDir: this.host.userDir, claudeFolders: imports.agentFolders, projectRoot: this.root, trusted });
    const skills = skillSources({ userDir: this.host.userDir, imported: imports.skillFolders, commandsDir, projectRoot: this.root, trusted, gate: this.gate });
    for (const p of [...instructions.problems, ...named.problems]) this.post({ type: "notice", workspace: this.id, text: `Skipped a customisation file: ${p}` });
    const selected = this.harness.startsWith(NAMED_AGENT_PREFIX) ? named.agents.find((a) => NAMED_AGENT_PREFIX + a.name === this.harness) : undefined;
    if (this.harness.startsWith(NAMED_AGENT_PREFIX) && !selected) {
      this.post({ type: "notice", workspace: this.id, text: `The ${this.harness.slice(NAMED_AGENT_PREFIX.length)} agent's file is gone; using the plain kernl agent.` });
    }
    const modelFor = (a: NamedAgent) => (a.model ? createChatModel({ ...s, model: a.model }, auth) : model);
    // Restricted Mode: read-only backend, no browser or MCP tools, only the user's own agents.
    const browser = trusted ? browserTools(this.host.browser(), this.gate) : [];
    const mcp = trusted ? await this.loadMcp(s, imports.mcpServers) : { tools: [], close: async () => {} };
    const present = { browser: browser.map((t) => t.name), mcp: mcp.tools.map((t) => t.name) };
    // Built-in delegates (explorer, reviewer) unless a user or project agent takes the name.
    const delegates = [...BUILT_IN_AGENTS.filter((b) => !named.agents.some((a) => a.name === b.name)), ...named.agents];
    const subagents = delegates
      .filter((a) => a !== selected)
      .map((a) => ({ name: a.name, description: a.description, systemPrompt: a.prompt, model: modelFor(a), middleware: [toolGuard(a.name, blockedTools(a, present))] }));
    const role = selected ? `\n\n## You are the ${selected.name} agent\n\n${selected.prompt}` : "";
    const common = {
      model: selected ? modelFor(selected) : model,
      instructions: instructions.prompt + role,
      subagents,
      middleware: selected ? [toolGuard(selected.name, blockedTools(selected, present))] : undefined,
      skills,
    };
    const thinking = s.sequentialThinking === false ? [] : [thinkingTool(this.thinking, this.gate)];
    if (!trusted) {
      const agent = buildAgent({ ...common, workspaceBackend: new ReadOnlyBackend(this.root, this.gate), tools: thinking, loadProjectRules: false });
      return { agent, close: async () => {} };
    }
    const agent = buildAgent({
      ...common,
      workspaceBackend: new GatedBackend(this.root, this.gate, new VscodeWorkspaceFiles(), this.kernlTerminal().run),
      tools: [
        ...thinking,
        ...jobTools(this.backgroundJobs(), this.gate),
        gatedTool(sendInputTool(this.gate, (text, signal) => this.kernlTerminal().sendInput(text, signal)) as any, this.gate, "allow"),
        ...terminalReadTools(this.host.terminalHistory(), this.gate, this.host.coreTerminalTools(), this.host.scrub),
        ...browser,
        ...mcp.tools,
      ],
      loadProjectRules: true,
    });
    this.host.log.info(`[${this.label}] Deep Agents ready: ${s.provider}/${(resolveProvider(s) as ResolvedProvider).model}, ${mcp.tools.length} MCP tool(s)`);
    return { agent, close: mcp.close };
  }
}
