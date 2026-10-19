import { createHash } from "node:crypto";
import { mkdir } from "node:fs/promises";
import { homedir } from "node:os";
import { basename, dirname, isAbsolute, join } from "node:path";
import * as vscode from "vscode";
import { CLI_AGENT_IDS, type CliAgentId, isCliAgentId } from "./acp/agents";
import { resolveCommand } from "./acp/commands";
import { AgentCredentials, CREDENTIAL_ENV, credentialEnv } from "./acp/credentials";
import { loadNamedAgents } from "./agent/namedAgents";
import type { InputChange } from "./agent/rebuildPolicy";
import { listSkills } from "./agent/skills";
import { outsideMessage, resolveUris, searchWorkspace, toAttachment } from "./attachmentSearch";
import { IntegratedBrowser } from "./browser/integratedBrowser";
import { Checkpoints } from "./checkpoints";
import type { GateRequest } from "./gate/approvalGate";
import { parseRules } from "./gate/rules";
import { GitHubApi, type GitHubKind, type GitHubSource, parseGitHubRemote } from "./github";
import { cliReadiness, type Readiness, runQuiet } from "./harnesses";
import { addCustomProvider, type KeyTargets, promptForApiKey, useDeepSeekForClaudeCode } from "./keyCommands";
import { Logger, Redactor } from "./log";
import { isPermissionMode } from "./modes";
import { agentLogins, manageProviders, pickModel } from "./providerManager";
import { KeyStore } from "./providers/keys";
import { createChatModel, isProviderId, type ProviderId, resolveProvider, settingsProblem } from "./providers/registry";
import { SessionStore, transcriptText } from "./sessions";
import { loadSources, sourceRoots, sourceSettings, sourcesReport } from "./sources";
import { KernlToolServer } from "./mcp/kernlServer";
import { type McpServer, settingServers } from "./mcp/servers";
import { panelSnapshot, toApprovalCard } from "./ui/approvalCards";
import { AgentPanel } from "./ui/panel";
import { PanelPrompts } from "./ui/panelPrompts";
import { type HarnessView, httpUrl, type MenuAnchor, type PanelToHost } from "./ui/protocol";
import { ProposalDiffs } from "./ui/proposalDiffs";
import { HARNESSES, isHarness, NAMED_AGENT_PREFIX, type RuntimeHost, WorkspaceRuntime } from "./workspaceRuntime";
import { type Prompts, vscodePrompts, WorkspaceCommands } from "./workspaces/commands";
import { git, isNotARepository } from "./workspaces/git";
import { currentWorkspaceScope } from "./workspaceScope";
import { listWorkspaces, repoRoot, type WorkspaceInfo } from "./workspaces/worktrees";

const MAIN = "main";

/** ~/.kernl, or KERNL_USER_DIR (the integration tests point it at a temp folder). */
function userCustomisationDir() {
  return process.env.KERNL_USER_DIR || join(homedir(), ".kernl");
}

/** A URL's host, for a prompt (the path or query can carry a token). */
function hostOf(url: string) {
  try {
    return new URL(url).host;
  } catch {
    return "an address that isn't a valid URL";
  }
}

function approvalRules() {
  const s = readSettings();
  return parseRules(s.approvals, s.allowList);
}

function readSettings() {
  const c = vscode.workspace.getConfiguration("kernl");
  return {
    // Validated by settingsProblem() before any model is built.
    provider: c.get<string>("provider", "anthropic"),
    model: c.get<string>("model", ""),
    baseUrl: c.get<string>("baseUrl", ""),
    customProviders: c.get<unknown>("customProviders", []),
    modelOptions: c.get<unknown>("modelOptions", {}),
    sequentialThinking: c.get<boolean>("sequentialThinking", true),
    allowList: c.get<unknown>("commandAllowList", []),
    approvals: { allow: c.get<unknown>("approvals.allow", []), ask: c.get<unknown>("approvals.ask", []), deny: c.get<unknown>("approvals.deny", []) },
    mcpServers: c.get<unknown>("mcpServers", {}),
    agentCommands: c.get<unknown>("agentCommands", {}),
    harness: c.get<string>("harness", "deepagents"),
    thinkingDisplay: c.get<string>("thinkingDisplay", "auto"),
    sources: sourceSettings(c),
    mcpToolTimeoutSeconds: c.get<number>("mcp.toolTimeoutSeconds", 60),
    terminal: { cliAgents: c.get<string>("terminal.cliAgents", "kernl") === "agent" ? ("agent" as const) : ("kernl" as const), outputLimit: c.get<number>("terminal.outputLimit", 30_000) },
    browser: { cliAgents: c.get<boolean>("browser.cliAgents", true), timeoutSeconds: c.get<number>("browser.timeoutSeconds", 30) },
  };
}

/** Wires the panel, the gate, and one runtime per workspace (main folder + worktree workspaces). */
export class Controller implements vscode.Disposable {
  readonly redactor = new Redactor();
  private output = vscode.window.createOutputChannel("kernl");
  private log = new Logger(this.output, this.redactor);
  readonly keys: KeyStore;
  readonly agentCredentials: AgentCredentials;
  readonly panel: AgentPanel;
  private diffs = new ProposalDiffs();
  /** Every open approval, with the workspace it belongs to. The source of truth for cards. */
  private requests = new Map<string, { workspace: WorkspaceRuntime; request: GateRequest }>();
  private workspaces = new Map<string, WorkspaceRuntime>();
  private sharedBrowser: IntegratedBrowser | undefined;
  /** kernl's tools for the CLI agents (one MCP server for the window, one token per workspace). */
  private toolServer = new KernlToolServer((line) => this.log.info(line));
  /** Project MCP servers the user said "not now" to in this window (by fingerprint). */
  private declinedServers = new Set<string>();
  private disposables: vscode.Disposable[] = [];
  private host: RuntimeHost;
  private commands: WorkspaceCommands;
  /** Choices open as menus next to the panel control that asked (VS Code's own prompts when the panel is off screen). */
  private panelPrompts: PanelPrompts;
  private prompts: Prompts;
  /** Issue and pull request source; the integration tests swap in a stub. */
  private github: GitHubSource | undefined;
  /** The workspace the panel shows (reported by the panel); title-bar commands act on it. */
  private active = MAIN;
  /** True when the window has several folders: each is a top-level workspace that remembers its own agent. */
  private multiRoot = false;
  /** Each worktree workspace's folder (the top-level workspace whose repository it belongs to). */
  private worktreeFolder = new Map<string, string>();
  /** Named agents (from ~/.kernl/agents and the main folder's .kernl/agents) offered in the agent picker. */
  private namedHarnesses: { id: string; label: string }[] = [];

  constructor(private context: vscode.ExtensionContext) {
    this.keys = new KeyStore(context.secrets, this.redactor);
    this.agentCredentials = new AgentCredentials(context.secrets, this.redactor);
    const sessions = new SessionStore(join(context.globalStorageUri.fsPath, "sessions"));
    // The panel may load tool images from the store's previews folder (and nothing else of it).
    this.panel = new AgentPanel(context.extensionUri, this.redactor, (m) => void this.onPanelMessage(m).catch((e) => this.fail("Panel action failed", e)), vscode.Uri.file(sessions.previewsDir));
    this.panelPrompts = new PanelPrompts(this.panel, vscodePrompts);
    this.prompts = this.panelPrompts;
    this.host = {
      log: this.log,
      post: (m) => this.panel.post(m),
      showApproval: (ws, id, request) => void this.showApproval(ws, id, request),
      closeApproval: (id) => this.closeApproval(id),
      deepAgentsProblem: () => this.deepAgentsProblem(),
      providerSettings: () => readSettings(),
      approvalRules: () => approvalRules().rules,
      sessions,
      checkpoints: new Checkpoints(join(context.globalStorageUri.fsPath, "checkpoints")),
      userDir: userCustomisationDir(),
      sources: (root, trusted) => this.loadSources(root, trusted),
      allowProjectServer: (server) => this.allowProjectServer(server),
      kernlTools: (tools) => this.toolServer.register(tools),
      apiKey: (provider) => (isProviderId(provider) ? this.keys.get(provider) : Promise.resolve(undefined)),
      agentEnv: async (id) => {
        const env = credentialEnv(id, await this.agentCredentials.get(id), join(context.globalStorageUri.fsPath, "agent-config"));
        if (env.CLAUDE_CONFIG_DIR) await mkdir(env.CLAUDE_CONFIG_DIR, { recursive: true });
        return env;
      },
      trusted: () => vscode.workspace.isTrusted,
      browser: () => (this.sharedBrowser ??= new IntegratedBrowser(() => readSettings().browser.timeoutSeconds * 1000)),
      workspacesChanged: () => this.postWorkspaces(),
    };
    this.commands = new WorkspaceCommands({
      log: this.log,
      diffs: this.diffs,
      worktreeStorage: join(context.globalStorageUri.fsPath, "worktrees"),
      mainRoot: () => this.activeFolder()?.root,
      prompts: () => this.prompts,
      harnesses: () => this.harnessList(),
    });
    this.disposables.push(
      this.panel.onDidHide(() => this.panelPrompts.cancel()),
      vscode.window.registerWebviewViewProvider("kernl.panel", this.panel, { webviewOptions: { retainContextWhenHidden: true } }),
      vscode.workspace.onDidChangeConfiguration((e) => {
        if (e.affectsConfiguration("kernl.approvals") || e.affectsConfiguration("kernl.commandAllowList")) this.reportRuleProblems();
        if (e.affectsConfiguration("kernl")) this.inputsChanged({ kind: "settings", affects: (s) => e.affectsConfiguration(s), mainHarness: readSettings().harness });
      }),
      vscode.workspace.onDidGrantWorkspaceTrust(() => this.inputsChanged({ kind: "trust" })),
      // Coming back to VS Code (e.g. after logging in to a CLI in a terminal): check again.
      vscode.window.onDidChangeWindowState((s) => s.focused && void this.refreshReadiness()),
      vscode.window.onDidChangeActiveTextEditor(() => this.postActiveFile()),
      ...this.watchCustomisationFiles(),
      vscode.workspace.onDidChangeWorkspaceFolders(() => void this.reloadWorkspaces()),
      this.diffs,
      this.output,
    );
    void this.loadWorkspaces();
    this.reportRuleProblems();
  }

  /** Instruction and agent files: in every workspace folder, and the user's own folder. One save can fire several events; they become one rebuild. */
  private watchCustomisationFiles(): vscode.Disposable[] {
    const roots = sourceRoots();
    let timer: NodeJS.Timeout | undefined;
    const changed = () => {
      clearTimeout(timer);
      timer = setTimeout(() => void this.refreshNamedAgents().then(() => (this.inputsChanged({ kind: "customisation" }), this.postSkills())), 300);
    };
    const watchers = [
      vscode.workspace.createFileSystemWatcher("**/{AGENTS.md,CLAUDE.md,.kernl/**,.claude/**,.mcp.json,.agents/skills/**,.codex/config.toml,.opencode/skills/**,opencode.json,opencode.jsonc}"),
      vscode.workspace.createFileSystemWatcher(new vscode.RelativePattern(vscode.Uri.file(userCustomisationDir()), "**")),
      // The other agents' own setup (the Sources settings read it).
      ...[
        [roots.claudeDir, "{agents/**,skills/**,commands/**,CLAUDE.md,settings.json,plugins/installed_plugins.json}"],
        [dirname(roots.claudeJson), basename(roots.claudeJson)],
        [roots.codexDir, "config.toml"],
        [join(roots.home, ".agents"), "skills/**"],
        [roots.opencodeDir, "{opencode.json,opencode.jsonc,skills/**}"],
      ].map(([dir, glob]) => vscode.workspace.createFileSystemWatcher(new vscode.RelativePattern(vscode.Uri.file(dir), glob))),
    ];
    for (const w of watchers) w.onDidChange(changed), w.onDidCreate(changed), w.onDidDelete(changed);
    return [...watchers, { dispose: () => clearTimeout(timer) }];
  }

  /** Malformed rules are skipped (that only ever leads to a card); say which ones, so nobody relies on them. */
  private reportRuleProblems() {
    const { problems } = approvalRules();
    if (problems.length) void vscode.window.showWarningMessage(`kernl skipped ${problems.length} approval rule(s): ${problems.join("; ")}`);
  }

  /**
   * One top-level workspace per local folder ("Main" when there is only one), plus the worktree
   * workspaces created earlier from each folder's repository. With no usable folder the panel is
   * told why (postWorkspaces sends the reason).
   */
  private async loadWorkspaces() {
    const scope = currentWorkspaceScope();
    if (!scope.ok) return this.postWorkspaces();
    this.multiRoot = scope.folders.length > 1;
    const defaultHarness = readSettings().harness;
    for (const folder of scope.folders) {
      let id = this.multiRoot ? `folder:${folder.name}` : MAIN;
      let label = this.multiRoot ? folder.name : "Main";
      for (let n = 2; this.workspaces.has(id); n++) (id = `folder:${folder.name} #${n}`), (label = `${folder.name} #${n}`);
      const harness = (this.multiRoot && this.context.workspaceState.get<string>(this.harnessKey(folder.root))) || defaultHarness;
      this.track(new WorkspaceRuntime(id, label, folder.root, isHarness(harness) ? harness : "deepagents", this.host, undefined, !this.multiRoot));
      try {
        const repo = await repoRoot(folder.root);
        for (const info of await listWorkspaces(repo, join(this.context.globalStorageUri.fsPath, "worktrees"))) this.addWorktree(info, id);
      } catch (err) {
        // Not a git repository: only the folder itself is a workspace. Anything else is a real failure.
        if (!isNotARepository(err)) this.fail(`Could not load workspaces for ${folder.name}`, err);
      }
    }
    // Start on the folder of the file being edited.
    const editing = vscode.window.activeTextEditor?.document.uri;
    const folderOfEditor = editing && vscode.workspace.getWorkspaceFolder(editing)?.uri.fsPath;
    this.active = [...this.workspaces.values()].find((w) => !w.info && w.root === folderOfEditor)?.id ?? this.workspaces.keys().next().value ?? MAIN;
    await this.refreshNamedAgents();
    this.postWorkspaces(this.active);
    void this.postSkills();
    void this.refreshReadiness();
  }

  /** Worktree ids are prefixed so no workspace name can collide with a folder's id; in multi-root they also name their folder. */
  private addWorktree(info: WorkspaceInfo, folderId: string) {
    const folder = this.workspace(folderId)!;
    const id = this.multiRoot ? `wt:${folder.label}/${info.name}` : `wt:${info.name}`;
    const label = this.multiRoot ? `${folder.label}/${info.name}` : info.name;
    const runtime = this.track(new WorkspaceRuntime(id, label, info.path, isHarness(info.harness) ? info.harness : "deepagents", this.host, info));
    this.worktreeFolder.set(runtime.id, folderId);
    return runtime;
  }

  /** The folder (top-level workspace) a workspace belongs to: itself, or a worktree's folder. */
  private folderIdOf(id: string): string {
    return this.worktreeFolder.get(id) ?? id;
  }

  /** The shown workspace's folder: whose repository new worktrees come from, and whose skills and agents are offered. */
  private activeFolder(): WorkspaceRuntime | undefined {
    return this.workspace(this.folderIdOf(this.active));
  }

  /** Where a folder's agent choice is kept in a multi-root window. */
  private harnessKey(root: string) {
    return `kernl.harness:${root}`;
  }

  /** A new workspace runtime, in the permission mode kept for its folder or worktree. */
  private track(runtime: WorkspaceRuntime) {
    const kept = this.context.workspaceState.get<string>(this.modeKey(runtime.root));
    if (isPermissionMode(kept)) runtime.restoreMode(kept);
    this.workspaces.set(runtime.id, runtime);
    return runtime;
  }

  /** Where a workspace's permission mode is kept (per folder or worktree path). */
  private modeKey(root: string) {
    return `kernl.mode:${root}`;
  }

  /** The mode chip's menu. Bypass asks first; a mode the agent can't confirm leaves the old one in place. */
  private async setMode(id: string, mode: string) {
    const ws = this.workspace(id);
    if (!ws || !isPermissionMode(mode)) return;
    if (mode === "bypass") {
      const agent = this.harnessList().find((h) => h.id === ws.harness)?.label ?? ws.harness;
      const ok = await this.prompts.confirm(
        "Bypass permissions?",
        `${agent} will run every tool (edits, shell commands, network) in ${ws.label} without asking you. Use it only in a sandbox or a throwaway checkout.`,
        "Bypass permissions",
      );
      if (!ok) return this.postWorkspaces();
    }
    try {
      await ws.setMode(mode);
      await this.context.workspaceState.update(this.modeKey(ws.root), ws.mode);
    } catch (err: any) {
      void vscode.window.showWarningMessage(err?.message ?? String(err));
    }
    this.postWorkspaces();
  }

  private harnessList(): HarnessView[] {
    const view = (h: { id: string; label: string }, group: HarnessView["group"]): HarnessView => {
      const r = this.readiness.get(h.id.startsWith(NAMED_AGENT_PREFIX) ? "deepagents" : h.id) ?? { ready: true };
      return { ...h, group, ready: r.ready, problem: r.problem };
    };
    return [view(HARNESSES[0], "kernl"), ...this.namedHarnesses.map((h) => view(h, "kernl")), ...HARNESSES.slice(1).map((h) => view(h, "agents"))];
  }

  /** Readiness of every harness, from the CLIs' own status commands and kernl's provider setup. */
  private readiness = new Map<string, Readiness>();

  private async refreshReadiness() {
    const overrides = readSettings().agentCommands as Record<string, unknown>;
    const deps = {
      find: (c: string) => resolveCommand(c),
      run: runQuiet,
      hasStoredKey: async (id: CliAgentId) => !!(await this.agentCredentials.get(id)),
      hasLaunchOverride: (id: CliAgentId) => overrides?.[id] !== undefined,
    };
    const problem = await this.deepAgentsProblem();
    this.readiness.set("deepagents", problem ? { ready: false, problem } : { ready: true });
    for (const id of CLI_AGENT_IDS) this.readiness.set(id, await cliReadiness(id, deps));
    this.postWorkspaces();
  }

  /** The agent chip: kernl and its named agents first, then the CLI agents, each with what it needs. */
  private async pickHarness() {
    // Readiness is kept current (startup, window focus, key and login changes); only the first menu waits for it.
    if (this.readiness.size) void this.refreshReadiness();
    else await this.refreshReadiness();
    const ws = this.workspace(this.active);
    if (!ws) return void vscode.window.showWarningMessage(this.noWorkspaceReason() ?? "kernl is still loading this window's folders.");
    if (ws.running) return void vscode.window.showWarningMessage("Stop the agent before changing it.");
    const list = this.harnessList();
    const item = (h: HarnessView) => ({
      label: `${h.id === ws.harness ? "$(check) " : ""}${h.label}`,
      description: h.ready ? (h.id === "deepagents" ? "your own model keys" : undefined) : "needs setup",
      detail: h.problem,
      harness: h,
    });
    const picked = await this.prompts.pick<vscode.QuickPickItem & { harness?: HarnessView }>(
      [
        { label: "kernl", kind: vscode.QuickPickItemKind.Separator },
        ...list.filter((h) => h.group === "kernl").map(item),
        { label: "Agents", kind: vscode.QuickPickItemKind.Separator },
        ...list.filter((h) => h.group === "agents").map(item),
      ],
      { title: "kernl: agent for this workspace" },
    );
    const h = picked?.harness;
    if (!h) return;
    if (!h.ready) {
      // Set it up first; switch only once it can run, so a cancelled setup doesn't leave a broken agent.
      await (h.group === "kernl" ? this.pickModel() : this.agentLogins());
      await this.refreshReadiness();
      const now = this.harnessList().find((x) => x.id === h.id);
      if (!now?.ready) {
        const current = this.harnessList().find((x) => x.id === ws.harness)?.label ?? ws.harness;
        return void vscode.window.showWarningMessage(`${h.label} still needs setup (${now?.problem ?? "not ready"}); ${ws.label} stays on ${current}.`);
      }
    }
    await this.setHarness(ws.id, h.id);
  }

  /**
   * Restore from a user message: files only, or files and conversation (the kernl agent only;
   * a CLI agent's conversation lives in the agent). Asks with the list of files it will change,
   * refuses files with unsaved edits, and offers Undo afterwards.
   */
  private async restore(workspaceId: string, messageId: string) {
    const ws = this.workspace(workspaceId);
    const at = ws?.checkpointOf(messageId);
    if (!ws || !at) return;
    if (ws.running) return void vscode.window.showWarningMessage("Stop the agent before restoring.");
    const canCut = !isCliAgentId(ws.harness);
    type Mode = vscode.QuickPickItem & { cut: boolean };
    const modes: Mode[] = [
      ...(canCut ? [{ label: "Restore files and conversation", description: "later messages are removed; your message returns to the input", cut: true }] : []),
      { label: "Restore files only", description: canCut ? "the conversation stays" : `${ws.view().label}'s conversation stays (the agent keeps its own history)`, cut: false },
    ];
    const mode = await this.prompts.pick(modes, { title: "Restore checkpoint" });
    if (!mode) return;
    const changes = await this.host.checkpoints.changes(ws.root, at.checkpoint);
    const dirty = vscode.workspace.textDocuments.filter((d) => d.isDirty && changes.some((c) => join(ws.root, c.path) === d.uri.fsPath));
    if (dirty.length) return void vscode.window.showWarningMessage(`Save or revert these files first: ${dirty.map((d) => vscode.workspace.asRelativePath(d.uri)).join(", ")}`);
    const verb = { A: "re-created", M: "changed back", D: "deleted" };
    const list = changes.slice(0, 12).map((c) => `${c.path} (${verb[c.status]})`).join("\n") + (changes.length > 12 ? `\n...and ${changes.length - 12} more` : "");
    const detail = `${changes.length ? `${changes.length} file(s):\n${list}` : "No files changed since then."}\n\nCommands' other effects (databases, installs, network) can't be undone.`;
    if (!(await this.prompts.confirm("Restore checkpoint?", detail, "Restore"))) return;
    const undo = await ws.restore(messageId, mode.cut);
    void vscode.window.showInformationMessage(`Restored ${changes.length} file(s).`, "Undo").then(async (choice) => {
      if (choice === "Undo") await this.host.checkpoints.restore(ws.root, undo);
    });
  }

  /** The history button: this workspace's conversations, newest first. */
  async showSessions() {
    const ws = this.workspace(this.active);
    if (!ws || ws.running) return;
    await ws.saveSession();
    const sessions = await this.host.sessions.list(ws.sessionKey);
    const label = (h: string) => this.harnessList().find((x) => x.id === h)?.label ?? h;
    const ago = (t: number) => {
      const m = Math.round((Date.now() - t) / 60000);
      return m < 1 ? "just now" : m < 60 ? `${m} min ago` : m < 1440 ? `${Math.round(m / 60)} h ago` : `${Math.round(m / 1440)} d ago`;
    };
    type Item = vscode.QuickPickItem & { id?: string };
    const items: Item[] = [
      { label: "$(add) New conversation" },
      ...sessions.map((s) => ({ label: `${s.id === ws.sessionId ? "$(check) " : ""}${s.title}`, description: `${messages(s.messages)} · ${label(s.harness)} · ${ago(s.updatedAt)}`, id: s.id })),
    ];
    const picked = await this.prompts.pick(items, { title: `Conversations in ${ws.view().label}` });
    if (!picked) return;
    if (!picked.id) return void ws.newThread();
    const record = await this.host.sessions.load(ws.sessionKey, picked.id);
    if (!record || record.id === ws.sessionId) return;
    if (record.harness !== ws.harness && isHarness(record.harness)) await this.setHarness(ws.id, record.harness);
    await ws.openSession(record);
  }

  async clearHistory() {
    if (!(await this.prompts.confirm("Delete all kernl conversations and checkpoints?", "Your files are not changed. Restore won't be available for earlier messages.", "Delete"))) return;
    await this.host.sessions.clear();
    await this.host.checkpoints.clear();
    for (const ws of this.workspaces.values()) if (!ws.running) ws.newThread();
  }

  /** The file open in the editor, offered in the composer when it's inside the shown workspace. */
  private postActiveFile() {
    const root = this.workspace(this.active)?.root;
    const uri = vscode.window.activeTextEditor?.document.uri;
    const path = root && uri?.scheme === "file" ? toAttachment(root, uri.fsPath, "file")?.path : undefined;
    this.panel.post({ type: "activeFile", path });
  }

  /** The jobs chip: show a job's terminal or stop it. */
  private async pickJob() {
    const ws = this.workspace(this.active);
    const jobs = ws?.jobList() ?? [];
    if (!ws || !jobs.length) return;
    const picked = await this.prompts.pick(
      jobs.map((j) => ({ label: j.name, description: `${j.status}${j.exitCode !== null ? ` (exit code ${j.exitCode})` : ""} · ${j.command}`, job: j })),
      { title: "Background jobs" },
    );
    if (!picked) return;
    const actions = [{ label: "Show output", stop: false }, ...(picked.job.status === "running" ? [{ label: "Stop", stop: true }] : [])];
    const action = await this.prompts.pick(actions, { title: picked.job.name });
    if (action?.stop) ws.stopJob(picked.job.id);
    else if (action) ws.showJob(picked.job.id);
  }

  /** The composer's + menu. */
  private async pickAttachments() {
    const ws = this.workspace(this.active);
    if (!ws) return;
    type Item = vscode.QuickPickItem & { run: () => Promise<unknown> };
    const items: Item[] = [
      { label: "$(files) Files & Folders...", run: () => this.pickFiles(ws.root) },
      { label: "$(comment-discussion) Conversations...", run: () => this.pickSessionAttachment(ws) },
      { label: "$(issues) Issue...", run: () => this.pickGitHubAttachment(ws.root, "issue") },
      { label: "$(git-pull-request) Pull Request...", run: () => this.pickGitHubAttachment(ws.root, "pr") },
    ];
    const picked = await this.prompts.pick(items, { title: "Attach" });
    await picked?.run();
  }

  /** Another conversation in this workspace, attached as text. */
  private async pickSessionAttachment(ws: WorkspaceRuntime) {
    await ws.saveSession();
    const sessions = (await this.host.sessions.list(ws.sessionKey)).filter((s) => s.id !== ws.sessionId);
    if (!sessions.length) return void vscode.window.showInformationMessage("No other conversations in this workspace yet.");
    const picked = await this.prompts.pick(sessions.map((s) => ({ label: s.title, description: messages(s.messages), id: s.id })), { title: "Attach a conversation" });
    const record = picked && (await this.host.sessions.load(ws.sessionKey, picked.id));
    if (record) this.panel.post({ type: "addAttachments", items: [{ kind: "text", path: `Conversation: ${record.title}`, text: transcriptText(record) }] });
  }

  /** An open issue or pull request of the workspace's GitHub repository (origin), attached as text. */
  private async pickGitHubAttachment(root: string, kind: GitHubKind) {
    const remote = await git(root, ["remote", "get-url", "origin"]).catch(() => "");
    const repo = parseGitHubRemote(remote);
    if (!repo) return void vscode.window.showWarningMessage("This workspace's origin isn't a GitHub repository.");
    const github = this.github ?? new GitHubApi(async () => {
      const session = await vscode.authentication.getSession("github", ["repo"], { createIfNone: true });
      this.redactor.register(session.accessToken);
      return session.accessToken;
    });
    try {
      const items = await github.list(kind, repo);
      const what = kind === "pr" ? "pull request" : "issue";
      if (!items.length) return void vscode.window.showInformationMessage(`No open ${what}s in ${repo.owner}/${repo.name}.`);
      const picked = await this.prompts.pick(items.map((i) => ({ label: `#${i.number} ${i.title}`, number: i.number })), { title: `Attach an ${what === "issue" ? "issue" : "pull request"} from ${repo.owner}/${repo.name}`, matchOnDescription: true });
      if (!picked) return;
      const text = await github.text(kind, repo, picked.number);
      this.panel.post({ type: "addAttachments", items: [{ kind: "text", path: `${kind === "pr" ? "PR" : "Issue"} #${picked.number}`, text }] });
    } catch (err: any) {
      void vscode.window.showWarningMessage(`GitHub: ${this.redactor.scrub(String(err?.message ?? err))}`);
    }
  }

  private async pickFiles(root: string) {
    const all = await searchWorkspace(root, "", 2000);
    const picked = await this.prompts.pick(
      all.map((a) => ({ label: `${a.kind === "folder" ? "$(folder)" : "$(file)"} ${a.path.split("/").pop()}`, description: a.path, attachment: a })),
      { title: "Attach a file or folder", matchOnDescription: true },
    );
    if (picked) this.panel.post({ type: "addAttachments", items: [picked.attachment] });
  }

  /** Dropped files and the Explorer's "Add to kernl chat": only paths inside the shown workspace. */
  /**
   * Attaches dropped (or Explorer "Add to kernl chat") files that are inside the shown workspace's
   * folder. A file in another folder of the window says which one to switch to.
   */
  async attachUris(uris: string[]) {
    if (!uris.length) return;
    const shown = this.workspace(this.active);
    if (!shown) return;
    const { attachments, outside, unusable } = await resolveUris(shown.root, uris);
    if (attachments.length) this.panel.post({ type: "addAttachments", items: attachments });
    if (outside.length) void vscode.window.showWarningMessage(outsideMessage(outside, shown, [...this.workspaces.values()]));
    if (unusable.length) {
      // Links, or items from a remote window: nothing here can be attached as a file.
      this.log.info(`couldn't attach ${unusable.length} dropped item(s) that aren't local files: ${unusable.slice(0, 5).join(", ")}`);
      void vscode.window.showWarningMessage(`kernl attaches files in this window's folders; couldn't attach ${unusable.slice(0, 3).join(", ")}${unusable.length > 3 ? ` and ${unusable.length - 3} more` : ""}.`);
    }
    await this.panel.reveal();
  }

  private async postSkills() {
    const root = this.activeFolder()?.root ?? "";
    const trusted = vscode.workspace.isTrusted && !!root;
    const { imports, commandsDir } = await this.loadSources(root, trusted);
    this.panel.post({ type: "skills", items: await listSkills({ userDir: userCustomisationDir(), imported: imports.skillFolders, commandsDir, projectRoot: root, trusted }) });
  }

  /** The command (walkthrough, palette): same menu as the agent chip, for the shown workspace. */
  async pickHarnessCommand() {
    await this.pickHarness();
  }

  async manageProviders() {
    const changed = await manageProviders(this.keyTargets(), (provider, model) => this.testProvider(provider, model));
    if (changed) this.inputsChanged({ kind: "keys", harnesses: changed });
  }

  async agentLogins() {
    const overrides = readSettings().agentCommands as Record<string, unknown>;
    const shown = this.workspace(this.active);
    const changed = await agentLogins(
      this.keyTargets(),
      (id) => cliReadiness(id, { find: (c) => resolveCommand(c), run: runQuiet, hasStoredKey: async (a) => !!(await this.agentCredentials.get(a)), hasLaunchOverride: (a) => overrides?.[a] !== undefined }),
      shown ? (id) => this.setHarness(shown.id, id) : undefined,
    );
    if (changed) this.inputsChanged({ kind: "keys", harnesses: changed });
  }

  private async pickModel() {
    const changed = await pickModel(this.keyTargets());
    if (changed) this.inputsChanged({ kind: "keys", harnesses: changed });
  }

  /** One tiny request with this provider's stored key: "Connected (model replied ...)" or the error. */
  private async testProvider(provider: ProviderId, model: string): Promise<string> {
    const s = { ...readSettings(), provider, model, modelOptions: { maxOutputTokens: 16 } };
    try {
      const reply = await createChatModel(s, await this.keys.get(provider)).invoke("Reply with the single word: ok");
      return `connected (the model replied "${String(reply.content).slice(0, 40)}")`;
    } catch (err: any) {
      return `failed: ${this.redactor.scrub(String(err?.message ?? err)).slice(0, 200)}`;
    }
  }

  private async refreshNamedAgents() {
    const root = this.activeFolder()?.root;
    const trusted = vscode.workspace.isTrusted && !!root;
    const { imports } = await this.loadSources(root ?? "", trusted);
    const { agents } = await loadNamedAgents({ userDir: userCustomisationDir(), claudeFolders: imports.agentFolders, projectRoot: root ?? "", trusted });
    this.namedHarnesses = agents.map((a) => ({ id: NAMED_AGENT_PREFIX + a.name, label: `kernl: ${a.name}` }));
  }

  /** What kernl's own agent reuses from Claude Code, Codex, and OpenCode for one folder (the Sources settings). */
  private loadSources(root: string, trusted: boolean) {
    return loadSources(sourceRoots(), { root, trusted }, readSettings().sources, join(this.context.globalStorageUri.fsPath, "command-skills"));
  }

  /**
   * A project's MCP server (.mcp.json, .codex/config.toml, opencode.json) starts only after you allow it
   * once in this workspace. The answer is kept for that exact server: if its command or URL changes, kernl asks again.
   * "Not now" is kept until the window closes.
   */
  private async allowProjectServer(server: McpServer): Promise<boolean> {
    const key = `kernl.allowedMcpServer.${server.name}`;
    const fingerprint = createHash("sha256").update(JSON.stringify(server.connection)).digest("hex");
    if (this.context.workspaceState.get(key) === fingerprint) return true;
    if (this.declinedServers.has(fingerprint)) return false;
    const c = server.connection;
    const what = "command" in c ? `runs the program ${c.command}` : `connects to ${hostOf(c.url)}`;
    const pick = await vscode.window.showWarningMessage(
      `Start the project's MCP server "${server.name}"?`,
      { modal: true, detail: `${server.origin} adds an MCP server that ${what}. kernl's agent starts it only if you allow it; each of its tools still asks before it runs.` },
      "Allow",
    );
    if (pick === "Allow") {
      await this.context.workspaceState.update(key, fingerprint);
      return true;
    }
    this.declinedServers.add(fingerprint);
    return false;
  }

  /** The Sources view: what kernl's own agent uses from the other agents' setup for the shown folder, as a Markdown document. */
  async showSources() {
    const root = this.activeFolder()?.root ?? "";
    const trusted = vscode.workspace.isTrusted && !!root;
    const { imports } = await this.loadSources(root, trusted);
    let own: string[] = [];
    try {
      own = settingServers(readSettings().mcpServers).map((s) => s.name);
    } catch (err: any) {
      imports.skipped.push({ item: "kernl.mcpServers", origin: "Settings", reason: err?.message ?? String(err) });
    }
    const doc = await vscode.workspace.openTextDocument({ language: "markdown", content: sourcesReport(imports, { mcpServers: own }) });
    await vscode.window.showTextDocument(doc, { preview: true });
  }

  private postWorkspaces(focus?: string) {
    const problem = this.workspaces.size ? undefined : this.noWorkspaceReason();
    this.panel.post({ type: "workspaces", items: [...this.workspaces.values()].map((w) => w.view()), harnesses: this.harnessList(), focus, problem });
  }

  /** Why there is no workspace to work in (no folder, or only remote ones); undefined when folders are usable. */
  private noWorkspaceReason(): string | undefined {
    const scope = currentWorkspaceScope();
    return scope.ok ? undefined : scope.reason;
  }

  private async showApproval(workspace: WorkspaceRuntime, id: string, request: GateRequest) {
    this.requests.set(id, { workspace, request });
    this.panel.post({ type: "approval", card: toApprovalCard(id, workspace, request) });
    this.postWorkspaces();
    await this.panel.reveal();
    await this.openDiff(id);
  }

  private async openDiff(id: string) {
    const r = this.requests.get(id)?.request;
    if (r?.kind === "edit" || r?.kind === "write") await this.diffs.show(id, r.path, r.before, r.after);
    if (r?.kind === "agent" && r.diff) await this.diffs.show(id, r.diff.path, r.diff.before, r.diff.after);
  }

  /** A tool row's file: opened in the editor (at the line when the agent gave one); only files inside the workspace. */
  /**
   * Opens a file a tool row names, in the editor that suits it (text, image, ...). Only files in the
   * window's own folders: an agent's output can name any path, and a click shouldn't open one
   * outside what you've opened in VS Code.
   */
  private async openLocation(workspaceId: string, path: string, line?: number) {
    const ws = this.workspace(workspaceId);
    if (!ws) return;
    const uri = vscode.Uri.file(isAbsolute(path) ? path : join(ws.root, path));
    if (!vscode.workspace.getWorkspaceFolder(uri)) return void vscode.window.showWarningMessage(`kernl only opens files inside this window's folders: ${path}`);
    const position = line !== undefined && line > 0 ? new vscode.Position(line - 1, 0) : undefined;
    await vscode.commands.executeCommand("vscode.open", uri, { selection: position && new vscode.Range(position, position), preview: true });
  }

  private closeApproval(id: string) {
    this.requests.delete(id);
    this.diffs.forget(id);
    this.panel.post({ type: "approvalClosed", id });
    this.postWorkspaces();
  }

  private workspace(id: string): WorkspaceRuntime | undefined {
    return this.workspaces.get(id);
  }

  /** Runs a flow started from a panel control; its menus open next to that control. */
  private async anchored<T>(anchor: MenuAnchor, flow: () => Promise<T>): Promise<T> {
    this.panelPrompts.anchor = anchor;
    try {
      return await flow();
    } finally {
      this.panelPrompts.anchor = "title";
    }
  }

  private async onPanelMessage(m: PanelToHost) {
    switch (m.type) {
      case "ready":
        this.panel.markReady();
        void this.postSkills();
        this.postActiveFile();
        await this.postStatus();
        this.postWorkspaces();
        this.panel.post(panelSnapshot([...this.requests].map(([id, r]) => [id, { workspace: r.workspace, request: r.request }])));
        return;
      case "send": {
        const ws = this.workspace(m.workspace);
        const r = ws && this.readiness.get(ws.harness);
        // Only a definite "can't start" stops a message here; anything uncertain goes to the agent, which reports its own error.
        if (ws && r && !r.ready && isCliAgentId(ws.harness)) {
          this.panel.post({ type: "userMessage", workspace: ws.id, text: m.text });
          this.panel.post({ type: "finished", workspace: ws.id, reason: "error", message: `${r.problem} (Agent logins in the ... menu can help.)` });
          return;
        }
        return ws?.submit(m.text, m.attachments ?? [], m.mode).catch((err) => {
          // Nothing was sent (e.g. this agent can't fork): put the message and its attachments back so they aren't lost.
          this.panel.post({ type: "setInput", workspace: ws.id, text: m.text });
          if (m.attachments?.length) this.panel.post({ type: "addAttachments", items: m.attachments });
          void vscode.window.showWarningMessage(err?.message ?? String(err));
        });
      }
      case "unqueue":
        return this.workspace(m.workspace)?.unqueue(m.id);
      case "sendQueued":
        return this.workspace(m.workspace)?.sendQueued(m.id);
      case "searchFiles": {
        const root = this.workspace(this.active)?.root;
        if (root) this.panel.post({ type: "fileMatches", query: m.query, items: await searchWorkspace(root, m.query) });
        return;
      }
      case "pickAttachments":
        return this.anchored("attach", () => this.pickAttachments());
      case "dropUris":
        return this.attachUris(m.uris);
      case "dropIgnored":
        // Logged, so the next "a drop does nothing" can be diagnosed from what it carried.
        return void this.log.info(`a drop on the panel attached nothing; it carried: ${m.types.join(", ") || "no data"}`);
      case "restore":
        return this.anchored(`restore:${m.messageId}`, () => this.restore(m.workspace, m.messageId));
      case "pickJob":
        return this.anchored("jobs", () => this.pickJob());
      case "menuPick":
        return this.panelPrompts.answer(m.id, m.index);
      case "fork":
        return this.workspace(m.workspace)?.fork(m.messageId).catch((err) => void vscode.window.showWarningMessage(err?.message ?? String(err)));
      case "stop":
        return this.workspace(m.workspace)?.stop();
      case "answer": {
        const owner = this.requests.get(m.id)?.workspace;
        if (owner?.approvals.answer(m.id, m.approved, m.always === true)) this.closeApproval(m.id);
        return;
      }
      case "showDiff":
        return this.openDiff(m.id);
      case "showToolDiff": {
        const diff = this.workspace(m.workspace)?.toolDiff(m.id);
        if (diff) await this.diffs.show(`tool-${m.id}`, diff.path, diff.before, diff.after);
        return;
      }
      case "openLocation":
        return this.openLocation(m.workspace, m.path, m.line);
      case "setKey":
        return this.setApiKey();
      case "openSettings":
        return this.openSettings();
      case "focus": {
        const folderBefore = this.folderIdOf(this.active);
        if (this.workspace(m.workspace)) this.active = m.workspace;
        this.postActiveFile();
        // Skills and named agents come from the shown folder.
        if (this.folderIdOf(this.active) !== folderBefore) {
          await this.refreshNamedAgents();
          this.postWorkspaces();
          void this.postSkills();
        }
        return;
      }
      case "setMode":
        return this.setMode(m.workspace, m.mode);
      case "openFolder":
        return void vscode.commands.executeCommand("workbench.action.files.openFolder");
      case "pickWorkspace":
        return this.anchored("workspace", () => this.pickWorkspace());
      case "openLink": {
        // The host is the trust boundary: check again, whatever the panel decided.
        const url = httpUrl(m.url);
        if (url) await vscode.env.openExternal(vscode.Uri.parse(url));
        else this.log.info(`refused to open a non-http(s) link: ${m.url.slice(0, 100)}`);
        return;
      }
      case "copy":
        await vscode.env.clipboard.writeText(m.text);
        return;
      case "pickModel":
        return this.anchored("model", () => this.pickModel());
      case "pickHarness":
        return this.anchored("agent", () => this.pickHarness());
    }
  }

  private async setHarness(id: string, harness: string) {
    const ws = this.workspace(id);
    if (!ws || !this.harnessList().some((h) => h.id === harness)) return;
    if (ws.running) return void vscode.window.showWarningMessage("Stop the agent before changing it.");
    ws.setHarness(harness);
    // The new agent may not support the old mode (it falls back to Ask before edits).
    await this.context.workspaceState.update(this.modeKey(ws.root), ws.mode);
    if (ws.info) await this.commands.rememberHarness(ws.info, harness);
    // In a multi-root window each folder keeps its own choice (kernl.harness is only the default).
    else if (this.multiRoot) await this.context.workspaceState.update(this.harnessKey(ws.root), harness);
    // A single folder's choice lives in settings; the resulting change event finds it already on this harness.
    else await vscode.workspace.getConfiguration("kernl").update("harness", harness, vscode.ConfigurationTarget.Workspace);
    this.postWorkspaces();
  }

  async newWorkspace() {
    const info = await this.commands.create();
    const folder = this.folderIdOf(this.active);
    if (!info || !this.workspace(folder)) return;
    this.postWorkspaces(this.addWorktree(info, folder).id);
  }

  private async review(id: string) {
    const info = this.workspace(id)?.info;
    if (info) await this.commands.review(info);
  }

  private async merge(id: string) {
    const ws = this.workspace(id);
    if (!ws?.info) return;
    if (ws.running) return void vscode.window.showWarningMessage("Stop the agent in this workspace before merging.");
    await this.commands.merge(ws.info);
  }

  private async discard(id: string) {
    const ws = this.workspace(id);
    if (!ws?.info) return;
    if (await this.commands.discard(ws.info, () => ws.dispose())) {
      const folder = this.folderIdOf(id);
      this.workspaces.delete(id);
      this.worktreeFolder.delete(id);
      // Its queued messages go with it (a later worktree at the same path starts empty).
      void this.host.sessions.saveQueue(ws.sessionKey, []).catch((err) => this.log.error("could not remove a discarded workspace's queue", err));
      this.postWorkspaces(folder);
    }
  }

  private keyTargets(): KeyTargets {
    return { keys: this.keys, agents: this.agentCredentials, prompts: this.prompts };
  }

  async setApiKey() {
    const changed = await promptForApiKey(this.keyTargets(), readSettings().provider);
    if (changed) this.inputsChanged({ kind: "keys", harnesses: changed });
  }

  async addCustomProvider() {
    const changed = await addCustomProvider(this.keyTargets());
    if (changed) this.inputsChanged({ kind: "keys", harnesses: changed });
  }

  async useDeepSeekForClaudeCode() {
    const changed = await useDeepSeekForClaudeCode(this.keyTargets());
    if (changed) this.inputsChanged({ kind: "keys", harnesses: changed });
  }

  async clearKeys() {
    if (!(await this.prompts.confirm("Clear all stored kernl keys?", "API keys for every model provider and CLI agent are removed from VS Code's secret storage. Agents logged in through their own CLI stay logged in.", "Clear keys"))) return;
    await this.keys.clearAll();
    await this.agentCredentials.clearAll();
    this.inputsChanged({ kind: "keys", harnesses: ["deepagents", ...Object.keys(CREDENTIAL_ENV)] });
  }

  /** New chat (title bar): clears the workspace the panel shows. */
  newChat() {
    this.workspace(this.active)?.newThread();
  }

  async openSettings() {
    await vscode.commands.executeCommand("workbench.action.openSettings", "@ext:local.kernl");
  }

  /** The workspace chip: switch, create, and for a worktree, review, merge, or discard. */
  private async pickWorkspace() {
    type Item = vscode.QuickPickItem & { run: () => unknown };
    const state = (w: WorkspaceRuntime) => [w.running ? "running" : undefined, w.approvals.size ? `${w.approvals.size} waiting` : undefined].filter(Boolean).join(" · ");
    const items: Item[] = [...this.workspaces.values()].map((w) => ({
      label: `${w.id === this.active ? "$(check) " : ""}${w.label}`,
      description: [w.info?.branch, state(w)].filter(Boolean).join(" · ") || undefined,
      run: () => this.postWorkspaces(w.id),
    }));
    items.push({ label: "$(git-branch) New workspace...", description: "a git worktree on its own branch", run: () => this.newWorkspace() });
    const current = this.workspace(this.active);
    if (current?.info) {
      items.push(
        { label: "", kind: vscode.QuickPickItemKind.Separator, run: () => undefined },
        { label: "$(diff) Review changes", description: current.label, run: () => this.review(current.id) },
        { label: "$(git-merge) Merge", description: `into ${current.info.base}`, run: () => this.merge(current.id) },
        { label: "$(trash) Discard...", description: current.label, run: () => this.discard(current.id) },
      );
    }
    const picked = await this.prompts.pick(items, { title: "kernl: workspaces" });
    await picked?.run();
  }

  private async deepAgentsProblem(): Promise<string | undefined> {
    const scope = currentWorkspaceScope();
    if (!scope.ok) return scope.reason;
    const s = readSettings();
    return settingsProblem(s, isProviderId(s.provider) ? await this.keys.get(s.provider) : undefined);
  }

  async postStatus() {
    const s = readSettings();
    const scope = currentWorkspaceScope();
    const problem = await this.deepAgentsProblem();
    const resolved = resolveProvider(s);
    const model = "error" in resolved ? s.model : resolved.model;
    const thinkingDisplay = s.thinkingDisplay === "collapsed" || s.thinkingDisplay === "expanded" ? s.thinkingDisplay : "auto";
    this.panel.post({ type: "status", ready: !problem, problem, provider: s.provider, model, restricted: scope.ok && !scope.trusted, thinkingDisplay, previewBase: this.panel.previewBase() });
  }

  /** Each workspace decides whether the change concerns it; running ones rebuild after their run. */
  private inputsChanged(change: InputChange) {
    this.log.info(`inputs changed (${change.kind}); affected idle workspaces rebuild now, running ones after their run`);
    for (const ws of this.workspaces.values()) ws.inputsChanged(change);
    this.postWorkspaces();
    void this.postStatus();
    void this.refreshReadiness();
  }

  /** A different folder is open: start over with that folder's workspaces. */
  private async reloadWorkspaces() {
    for (const ws of this.workspaces.values()) ws.dispose();
    this.workspaces.clear();
    this.worktreeFolder.clear();
    await this.loadWorkspaces();
    void this.postStatus();
  }

  private fail(what: string, err: unknown) {
    this.log.error(what, err);
    void vscode.window.showErrorMessage(`${what}: ${err instanceof Error ? err.message : String(err)}`);
  }

  /**
   * Integration-test seam: drive the real controller as the panel would (receive), watch what
   * reaches the webview (onDidDeliver), and answer workspace dialogs without UI (usePrompts).
   */
  testingApi() {
    return {
      receive: (m: PanelToHost) => this.onPanelMessage(m),
      onDidDeliver: this.panel.onDidDeliver,
      usePrompts: (p: Prompts) => (this.prompts = p),
      /** Back to the real prompts (in-panel menus), after usePrompts. */
      usePanelPrompts: () => (this.prompts = this.panelPrompts),
      activeWorkspace: () => this.active,
      /** A workspace's run state, part by part (for the integration tests' failure timeline). */
      runState: (workspace: string) => this.workspace(workspace)?.runState(),
      approvalRules: () => approvalRules(),
      setHarness: (workspace: string, harness: string) => this.setHarness(workspace, harness),
      useGitHub: (source: GitHubSource) => (this.github = source),
    };
  }

  dispose() {
    for (const ws of this.workspaces.values()) ws.dispose();
    void this.sharedBrowser?.dispose();
    void this.toolServer.dispose();
    for (const d of this.disposables) d.dispose();
  }
}

/** "1 message", "3 messages". */
const messages = (n: number) => `${n} message${n === 1 ? "" : "s"}`;
