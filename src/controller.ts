import { createHash } from "node:crypto";
import { mkdir } from "node:fs/promises";
import { homedir } from "node:os";
import { basename, dirname, isAbsolute, join } from "node:path";
import type * as acp from "@agentclientprotocol/sdk";
import * as vscode from "vscode";
import { CLI_AGENT_IDS, type CliAgentId, isCliAgentId, resolveLaunch } from "./acp/agents";
import { claudeSessionOpenElsewhere, sessionStore } from "./acp/sessionStores";
import { coreTerminalTools } from "./terminal/coreTools";
import { TerminalHistory } from "./terminal/history";
import type { Attachment } from "./ui/protocol";
import { DRAFT_TEXT_LIMIT, type Draft, draftToKeep } from "./ui/draft";
import { resolveCommand } from "./acp/commands";
import { AgentCredentials, CREDENTIAL_ENV, credentialEnv } from "./acp/credentials";
import type { FixAction } from "./connections/types";
import { loadNamedAgents } from "./agent/namedAgents";
import type { InputChange } from "./agent/rebuildPolicy";
import { listSkills } from "./agent/skills";
import { outsideMessage, resolveUris, searchWorkspace, toAttachment } from "./attachmentSearch";
import { editorFocusReturn, IntegratedBrowser } from "./browser/integratedBrowser";
import { Checkpoints } from "./checkpoints";
import type { GateRequest } from "./gate/approvalGate";
import { parseRules } from "./gate/rules";
import { GitHubApi, type GitHubKind, type GitHubSource, parseGitHubRemote } from "./github";
import { addCustomProvider, type KeyTargets, promptForApiKey, useDeepSeekForClaudeCode } from "./keyCommands";
import { Logger, Redactor } from "./log";
import { isPermissionMode } from "./modes";
import { agentLogins, manageProviders, pickModel } from "./providerManager";
import { KeyStore } from "./providers/keys";
import { type CustomProvider, createChatModel, customProviders, effectiveModelOptions, isProviderId, missingSecretHeader, type ProviderId, profileKey, providerApi, resolveProvider, settingsProblem, THINKING_LEVELS, type ThinkingLevel } from "./providers/registry";
import { type SessionRecord, SessionStore } from "./sessions";
import { loadSources, sourceRoots, sourceSettings, sourcesReport } from "./sources";
import { KernlToolServer } from "./mcp/kernlServer";
import { type AgentCheckDeps, agentBinary, agentLabel, agentProblem, checkAgent, LOGIN_ARGS } from "./connections/agentChecks";
import { checkKey, keyRequest, modelsRequest } from "./connections/keyCheck";
import { checkAgentMcp, checkClaudePlugins } from "./connections/listChecks";
import { ConnectionMonitor } from "./connections/monitor";
import { applySignal } from "./connections/signals";
import { applyChatButtonReplacement, CHAT_BUTTON_SETTING, QUICK_ACTIONS, statusBarText } from "./quickAccess";
import type { ChatForwarding } from "./chatParticipant";
import { runStatusCommand, STATUS_TIMEOUT_MS } from "./connections/statusCommands";
import { blocks, type ConnectionStatus } from "./connections/types";
import { type McpServer, SIGN_IN_REASON, SignInRequired, settingServers } from "./mcp/servers";
import { panelSnapshot, toApprovalCard } from "./ui/approvalCards";
import { AgentPanel } from "./ui/panel";
import { type ConversationPick, conversationRows } from "./ui/conversationRows";
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

/** Where the unsent message is kept (per window). */
const DRAFT_KEY = "kernl.draft";

/** How long an agent's session list is reused when its store hasn't changed (a change empties it at once). */
const AGENT_SESSIONS_TTL_MS = 5 * 60_000;
/** Where the open tabs are kept for the window (workspaceState): workspace id -> its tabs' numbers and conversations. */
const TABS_KEY = "kernl.tabs";

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
    modelProfiles: c.get<unknown>("modelProfiles", {}),
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
  /** Whether kernl's panel has keyboard focus (the panel reports it), so focus can go back there. */
  private panelHasKeyboard = false;
  /** Every connection's status (agents, keys, MCP servers, plugins); the agent chip, menu, and Connections view read it. */
  readonly connections = new ConnectionMonitor();
  /** "kernl" in the status bar: opens the kernl menu, and warns when a connection needs the user. */
  private statusItem = vscode.window.createStatusBarItem("kernl.status", vscode.StatusBarAlignment.Right, 100);
  /** kernl's tools for the CLI agents (one MCP server for the window, one token per workspace). */
  private toolServer = new KernlToolServer((line) => this.log.info(line));
  /** Remote MCP servers that wanted a sign-in in this window (OAuth): kernl's agent skips them. */
  private signInRequired = new SignInRequired();
  /** Every command run in this window's terminals, recorded from activation (see src/terminal/history.ts). */
  private readonly terminalHistory: TerminalHistory;
  /** The CLI agents' session lists, per agent and folder (`<agent>\n<root>`); dropped when the agent's store changes. */
  private agentSessionLists = new Map<string, { at: number; sessions: acp.SessionInfo[] }>();
  /** Agents' session lists being asked for now, by agent and folder (shared by repeated clicks), with the generation they were asked in. */
  private agentSessionRequests = new Map<string, { generation: number; request: Promise<acp.SessionInfo[] | undefined> }>();
  /** Raised whenever the cached lists are forgotten: a request from an earlier generation is neither shared nor cached. */
  private agentSessionGeneration = 0;
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
  /** Runs the agents' read-only status commands; the integration tests wrap it to hold a check open. */
  private statusCommands: AgentCheckDeps["run"] = runStatusCommand;
  /** The workspace the panel shows (reported by the panel); title-bar commands act on it. */
  private active = MAIN;
  /** True when the window has several folders: each is a top-level workspace that remembers its own agent. */
  private multiRoot = false;
  /** Each worktree workspace's folder (the top-level workspace whose repository it belongs to). */
  private worktreeFolder = new Map<string, string>();
  /** When each tab was last shown: at kernl.tabs.max, the one shown longest ago (and idle) closes. */
  private tabUsed = new Map<string, number>();
  /** The highest tab number used for each workspace in this window. */
  private tabNumbers = new Map<string, number>();
  /** Tabs restored after a reload: the conversation each opens when it's first shown. */
  private tabConversation = new Map<string, string>();
  /** Named agents (from ~/.kernl/agents and the main folder's .kernl/agents) offered in the agent picker. */
  private namedHarnesses: { id: string; label: string }[] = [];

  constructor(private context: vscode.ExtensionContext) {
    // First, before anything slower: commands are recorded from activation (VS Code startup) on.
    this.terminalHistory = new TerminalHistory(
      {
        onDidStartTerminalShellExecution: vscode.window.onDidStartTerminalShellExecution,
        onDidEndTerminalShellExecution: vscode.window.onDidEndTerminalShellExecution,
        onDidCloseTerminal: vscode.window.onDidCloseTerminal,
        terminals: () => vscode.window.terminals,
        activeTerminal: () => vscode.window.activeTerminal,
      },
      (text) => this.redactor.scrub(text),
    );
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
      projectServerAllowed: (server) => this.projectServerAllowed(server),
      kernlTools: (tools) => this.toolServer.register(tools),
      connectionSignal: (signal, harness) =>
        applySignal(this.connections, signal, harness, { now: Date.now, provider: readSettings().provider, recheck: (id) => void this.refreshReadiness({ only: id }) }),
      signInRequired: this.signInRequired,
      providerAuth: (provider) => this.keys.auth(provider, readSettings().customProviders),
      agentEnv: async (id) => {
        const env = credentialEnv(id, await this.agentCredentials.get(id), join(context.globalStorageUri.fsPath, "agent-config"));
        if (env.CLAUDE_CONFIG_DIR) await mkdir(env.CLAUDE_CONFIG_DIR, { recursive: true });
        return env;
      },
      trusted: () => vscode.workspace.isTrusted,
      browser: () => (this.sharedBrowser ??= new IntegratedBrowser(() => readSettings().browser.timeoutSeconds * 1000, () => this.focusReturn())),
      workspacesChanged: () => this.postWorkspaces(),
      state: context.workspaceState,
      terminalHistory: () => this.terminalHistory,
      coreTerminalTools: () => coreTerminalTools,
      scrub: (text) => this.redactor.scrub(text),
      knownRoot: (root) => [...this.workspaces.values()].some((w) => w.root === root),
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
      // Coming back to VS Code (e.g. after logging in to a CLI in a terminal elsewhere): check again, and
      // believe the result over an earlier run's failure, since the user may have just fixed it.
      vscode.window.onDidChangeWindowState((s) => s.focused && this.staleConnections(30_000) && void this.refreshReadiness({ force: true })),
      // A key stored, changed, or removed in kernl: check logins and keys again.
      context.secrets.onDidChange(() => void Promise.all([this.refreshReadiness({ changed: true }), this.checkKeys({ changed: true })])),
      this.connections.onDidChange(() => this.connectionsChanged()),
      ...this.watchCredentialFiles(),
      ...this.watchSessionStores(),
      this.pollConnections(),
      vscode.window.onDidChangeActiveTextEditor(() => this.postActiveFile()),
      ...this.watchCustomisationFiles(),
      vscode.workspace.onDidChangeWorkspaceFolders(() => void this.reloadWorkspaces()),
      this.diffs,
      this.output,
    );
    this.statusItem.name = "kernl";
    this.statusItem.command = "kernl.quickMenu";
    this.updateStatusItem();
    this.disposables.push(
      this.statusItem,
      vscode.workspace.onDidChangeConfiguration((e) => {
        if (e.affectsConfiguration("kernl.statusBar.show") || e.affectsConfiguration("kernl.replaceChatButton")) this.updateStatusItem();
        if (e.affectsConfiguration("kernl.replaceChatButton")) void this.replaceChatButton(true);
      }),
    );
    void this.replaceChatButton(false);
    void this.loadWorkspaces();
    this.reportRuleProblems();
  }

  /**
   * What stops the agents actually in use: the login of each open workspace's agent and its key (kernl's
   * provider key, or a CLI agent's stored key). Agents nobody uses and MCP servers kernl can't sign in to
   * don't count; the Connections view lists those.
   */
  private connectionsNeedingYou() {
    const ids = new Set<string>();
    for (const ws of this.workspaces.values()) {
      const harness = ws.harness.startsWith(NAMED_AGENT_PREFIX) ? "deepagents" : ws.harness;
      ids.add(`agent:${harness}`);
      ids.add(harness === "deepagents" ? `key:${readSettings().provider}` : `agentKey:${harness}`);
    }
    return this.connections.list().filter((s) => ids.has(s.id) && blocks(s));
  }

  /** The status bar item follows the connections: "kernl", or a warning with how many need the user. */
  private updateStatusItem() {
    const c = vscode.workspace.getConfiguration("kernl");
    const { text, tooltip } = statusBarText(this.connectionsNeedingYou().length);
    this.statusItem.text = text;
    this.statusItem.tooltip = tooltip;
    if (c.get<boolean>("statusBar.show", true) || c.get<boolean>("replaceChatButton", false)) this.statusItem.show();
    else this.statusItem.hide();
  }

  /**
   * kernl.replaceChatButton: hide VS Code's chat button in the Command Center (its own setting, in user
   * settings) and use kernl's; off puts back what was there. `toggled`: the user changed the option now
   * (always apply, and say what happened). At startup it applies only when the saved state disagrees
   * with the option, so a button the user showed again by hand isn't hidden again behind their back.
   */
  private async replaceChatButton(toggled: boolean) {
    const on = vscode.workspace.getConfiguration("kernl").get<boolean>("replaceChatButton", false);
    const key = "kernl.savedChatButtonSetting";
    const saved = {
      get: () => this.context.globalState.get<{ value: unknown }>(key),
      set: (v: { value: unknown } | undefined) => Promise.resolve(this.context.globalState.update(key, v)),
    };
    if (!toggled && on === !!saved.get()) return;
    const config = () => vscode.workspace.getConfiguration();
    const setting = {
      exists: () => config().inspect(CHAT_BUTTON_SETTING)?.defaultValue !== undefined,
      get: () => config().inspect(CHAT_BUTTON_SETTING)?.globalValue,
      set: (value: unknown) => Promise.resolve(config().update(CHAT_BUTTON_SETTING, value, vscode.ConfigurationTarget.Global)),
    };
    let result: Awaited<ReturnType<typeof applyChatButtonReplacement>>;
    try {
      result = await applyChatButtonReplacement(on, setting, saved);
    } catch (err) {
      return this.fail("Couldn't change VS Code's chat button", err);
    }
    this.log.info(`kernl.replaceChatButton ${on ? "on" : "off"}: ${result}`);
    if (!toggled) return;
    const messages: Record<typeof result, string | undefined> = {
      hidden: "kernl hid VS Code's chat button (chat.agentsControl.enabled is now \"hidden\"). Use the kernl button in the editor toolbar, \"kernl\" in the status bar, or Ctrl+Alt+K. Turn kernl.replaceChatButton off to bring VS Code's back.",
      restored: "VS Code's chat button is back (kernl put chat.agentsControl.enabled back as it was).",
      kept: "You changed VS Code's chat button setting yourself, so kernl left it as it is.",
      unsupported: "This VS Code has no chat.agentsControl.enabled setting, so kernl can't hide its chat button.",
      unchanged: undefined,
    };
    const text = messages[result];
    if (text) void (result === "unsupported" ? vscode.window.showWarningMessage(text) : vscode.window.showInformationMessage(text));
  }

  /** Open kernl: the panel. */
  async open() {
    await this.panel.reveal();
  }

  /** The kernl menu (status bar, kernl.quickMenu): the same actions as the editor toolbar's kernl button. */
  async quickMenu() {
    const needYou = this.connectionsNeedingYou().length;
    const items = QUICK_ACTIONS.map((a) => ({
      label: a.label,
      detail: a.command === "kernl.showConnections" && needYou ? `${needYou} need${needYou === 1 ? "s" : ""} you` : a.detail || undefined,
      command: a.command,
    }));
    const picked = await vscode.window.showQuickPick(items, { title: "kernl", placeHolder: "kernl" });
    if (picked) await vscode.commands.executeCommand(picked.command);
  }

  /** Ask kernl…: a one-line request for the shown workspace, sent the way the panel's Send does. */
  async ask() {
    const ws = this.workspace(this.active);
    if (!ws) return void vscode.window.showWarningMessage(this.noWorkspaceReason() ?? "kernl has no workspace to send to yet.");
    const agent = this.harnessList().find((h) => h.id === ws.harness)?.label ?? ws.harness;
    const text = await this.prompts.input({ title: "Ask kernl", prompt: `Goes to ${agent} in ${ws.label}${ws.running ? " (queued: it's working)" : ""}`, placeHolder: "What should kernl do?", ignoreFocusOut: true });
    if (!text?.trim()) return;
    const result = await this.sendFromOutside(text, []);
    if ("error" in result) void vscode.window.showWarningMessage(result.error);
  }

  /** Ask kernl about this file or selection: the active editor's selection (or its file) goes into the message box. */
  async askAboutSelection() {
    const editor = vscode.window.activeTextEditor;
    if (!editor) return void vscode.window.showInformationMessage("Open a file first; kernl attaches it, or the lines you select.");
    const doc = editor.document;
    if (editor.selection.isEmpty) return this.attachUris([doc.uri.toString()]);
    const folder = vscode.workspace.getWorkspaceFolder(doc.uri);
    const name = folder ? vscode.workspace.asRelativePath(doc.uri, false) : doc.uri.fsPath;
    const { start, end } = editor.selection;
    const lines = start.line === end.line ? `${start.line + 1}` : `${start.line + 1}-${end.line + 1}`;
    const attachment: Attachment = { kind: "text", path: `${name}:${lines}`, text: doc.getText(editor.selection) };
    await this.panel.reveal();
    this.panel.post({ type: "addAttachments", items: [attachment] });
  }

  /**
   * A message from outside the panel (Ask kernl, @kernl in VS Code's chat) to the shown workspace,
   * through the panel's own Send: the same checks, and queued while the agent runs.
   */
  async sendFromOutside(text: string, files: readonly string[]): Promise<{ workspace: string; agent: string; queued: boolean } | { error: string }> {
    const ws = this.workspace(this.active);
    if (!ws) return { error: this.noWorkspaceReason() ?? "kernl has no workspace to send to yet." };
    const { attachments, outside, unusable } = files.length ? await resolveUris(ws.root, [...files]) : { attachments: [], outside: [], unusable: [] };
    const skipped = outside.length + unusable.length;
    if (skipped) this.log.info(`a message from outside the panel referenced ${skipped} file(s) outside ${ws.label}; not attached`);
    const queued = ws.running;
    await this.panel.reveal();
    // Handed over like the panel's Send, which never waits for the run: awaiting it would hold Ask
    // kernl's box and an @kernl reply open until the agent finished (or forever, behind an approval).
    void this.onPanelMessage({ type: "send", workspace: ws.id, text, attachments }).catch((err) => this.fail("Couldn't send to kernl", err));
    return { workspace: ws.label, agent: this.harnessList().find((h) => h.id === ws.harness)?.label ?? ws.harness, queued };
  }

  /** What @kernl in VS Code's chat calls. */
  chatForwarding(): ChatForwarding {
    return { forward: (text, files) => this.sendFromOutside(text, files) };
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
    this.restoreTabs();
    // Start on the folder of the file being edited.
    const editing = vscode.window.activeTextEditor?.document.uri;
    const folderOfEditor = editing && vscode.workspace.getWorkspaceFolder(editing)?.uri.fsPath;
    this.active = [...this.workspaces.values()].find((w) => !w.info && !w.tabOf && w.root === folderOfEditor)?.id ?? this.workspaces.keys().next().value ?? MAIN;
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
    const tabOf = this.workspaces.get(id)?.tabOf;
    return tabOf ? this.folderIdOf(tabOf) : (this.worktreeFolder.get(id) ?? id);
  }

  /** A workspace's tabs, itself first, then by number. */
  private tabsOf(workspace: string): WorkspaceRuntime[] {
    const tabs = [...this.workspaces.values()].filter((w) => w.tabOf === workspace);
    const n = (w: WorkspaceRuntime) => Number(w.id.slice(w.id.lastIndexOf("~") + 1));
    return [this.workspaces.get(workspace)!, ...tabs.sort((a, b) => n(a) - n(b))].filter(Boolean);
  }

  /**
   * A new tab for the shown workspace: another session in the same folder, with its own conversation,
   * agent, and queue. At kernl.tabs.max (0: no limit) the tab shown longest ago that is idle (not
   * running, no card, nothing queued) closes first; its conversation stays in Conversations.
   */
  private async newTab() {
    const base = this.workspace(this.workspace(this.active)?.tabOf ?? this.active);
    if (!base) return;
    const tabs = this.tabsOf(base.id);
    const max = Math.max(0, Math.floor(vscode.workspace.getConfiguration("kernl").get<number>("tabs.max", 5)));
    if (max && tabs.length >= max) {
      const idle = tabs.filter((t) => t.tabOf && !t.running && !t.approvals.size && !t.view().queue.length).sort((a, b) => (this.tabUsed.get(a.id) ?? 0) - (this.tabUsed.get(b.id) ?? 0));
      if (!idle.length) {
        this.panel.post({ type: "notice", workspace: this.active, text: `All ${tabs.length} tabs are busy (kernl.tabs.max is ${max}): close one, or raise kernl.tabs.max.` });
        return;
      }
      await this.closeTab(idle[0].id, false);
    }
    const tab = this.addTab(base);
    this.active = tab.id;
    this.tabUsed.set(tab.id, Date.now());
    this.postWorkspaces(tab.id);
  }

  /**
   * A tab numbered `n` (a restored one), or the next number never used in this window: a closed tab's
   * number isn't given again, since the panel keeps each id's transcript while the window is open.
   */
  private addTab(base: WorkspaceRuntime, n?: number): WorkspaceRuntime {
    let number = n ?? Math.max(1, this.tabNumbers.get(base.id) ?? 1) + 1;
    while (this.workspaces.has(`${base.id}~${number}`)) number++;
    this.tabNumbers.set(base.id, Math.max(number, this.tabNumbers.get(base.id) ?? 1));
    return this.track(new WorkspaceRuntime(`${base.id}~${number}`, `${base.label} · tab ${number}`, base.root, base.harness, this.host, base.info, base.followsHarnessSetting, base.id));
  }

  /** Closes a tab (never a workspace's first); a running one asks first. Its conversation stays in Conversations. */
  private async closeTab(id: string, ask = true) {
    const tab = this.workspace(id);
    if (!tab?.tabOf) return;
    if (ask && !(await this.confirmStop(tab, "Stop the agent and close this tab?", "Stop and close"))) return;
    if (tab.running) await tab.stop();
    await tab.saveSession();
    const siblings = this.tabsOf(tab.tabOf);
    const next = siblings[siblings.indexOf(tab) - 1] ?? this.workspace(tab.tabOf)!;
    tab.dispose();
    this.workspaces.delete(id);
    this.tabUsed.delete(id);
    this.tabConversation.delete(id);
    void this.host.sessions.saveQueue(tab.queueKey, []).catch((err) => this.log.error("could not remove a closed tab's queue", err));
    if (this.active === id) this.active = next.id;
    this.postWorkspaces(this.active);
  }

  /** The open tabs and their conversations, kept for the window so they come back after a reload. */
  private saveTabs() {
    const tabs: Record<string, { n: number; conversation: string }[]> = {};
    for (const w of this.workspaces.values()) {
      if (!w.tabOf) continue;
      (tabs[w.tabOf] ??= []).push({ n: Number(w.id.slice(w.id.lastIndexOf("~") + 1)), conversation: this.tabConversation.get(w.id) ?? w.sessionId });
    }
    void this.context.workspaceState.update(TABS_KEY, tabs);
  }

  /** Tabs open before the reload come back; each opens its conversation when it's first shown. */
  private restoreTabs() {
    const saved = this.context.workspaceState.get<Record<string, { n: number; conversation: string }[]>>(TABS_KEY) ?? {};
    for (const [workspace, tabs] of Object.entries(saved)) {
      const base = this.workspace(workspace);
      if (!base || base.tabOf) continue;
      for (const t of tabs) {
        if (!Number.isInteger(t.n) || t.n < 2 || this.workspaces.has(`${workspace}~${t.n}`)) continue;
        const tab = this.addTab(base, t.n);
        if (typeof t.conversation === "string") this.tabConversation.set(tab.id, t.conversation);
      }
    }
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
  /** The unsent message, kept for this window (VS Code's workspaceState) until it's sent or cleared. */
  /** Where keyboard focus goes back after kernl brings its browser tab to the front: kernl's panel when it had it, else the editor's. */
  private focusReturn() {
    if (this.panelHasKeyboard && vscode.window.state.focused) {
      return async () => (await this.panel.reveal(), "the kernl panel");
    }
    return editorFocusReturn();
  }

  private async keepDraft(text: string, attachments: Attachment[]) {
    const { draft, dropped } = draftToKeep(String(text ?? ""), Array.isArray(attachments) ? attachments : []);
    if (dropped) this.log.info(`draft: ${dropped} long text attachment(s) not kept (over ${DRAFT_TEXT_LIMIT} characters in total)`);
    await this.context.workspaceState.update(DRAFT_KEY, draft);
  }

  /** The panel loaded (after a restart or reload): it gets the unsent message back. */
  private restoreDraft() {
    const draft = this.context.workspaceState.get<Draft>(DRAFT_KEY);
    if (draft) this.panel.post({ type: "restoreDraft", text: draft.text, attachments: draft.attachments });
  }

  /** A CLI agent's model or thinking chip: its own choices (from the agent), the current one marked. */
  private async pickAgentOption(workspaceId: string, id: string) {
    const ws = this.workspace(workspaceId);
    const option = ws?.view().agentOptions?.find((o) => o.id === id && o.kind !== "fast");
    if (!ws || !option?.choices) return;
    const picked = await this.prompts.pick(
      option.choices.map((c) => ({ label: c.name, description: [c.value === option.value ? "current" : undefined, c.description].filter(Boolean).join(" · ") || undefined, value: c.value })),
      { title: `${option.name}: ${ws.view().label}` },
    );
    if (picked && picked.value !== option.value) await ws.setAgentOption(id, picked.value);
  }

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
      const r = this.readiness(h.id.startsWith(NAMED_AGENT_PREFIX) ? "deepagents" : h.id);
      return { ...h, group, ready: r.ready, problem: r.problem };
    };
    return [view(HARNESSES[0], "kernl"), ...this.namedHarnesses.map((h) => view(h, "kernl")), ...HARNESSES.slice(1).map((h) => view(h, "agents"))];
  }

  /** Whether a harness can start, from its connection status: not ready only when it definitely can't. */
  private readiness(harness: string): { ready: boolean; problem?: string } {
    // kernl's agent also can't run when its provider refused the stored key.
    const key = harness === "deepagents" ? this.connections.get(`key:${readSettings().provider}`) : undefined;
    if (key && blocks(key)) return { ready: false, problem: `${key.detail}. Set a new key with Choose provider and model.` };
    const s = this.connections.get(`agent:${harness}`);
    if (!s || !blocks(s)) return { ready: true };
    return { ready: false, problem: isCliAgentId(harness) ? agentProblem(harness, s) : s.detail };
  }

  /**
   * Checks every agent's connection: kernl's provider setup, and each CLI agent's install and login,
   * run the way kernl launches it. `force`: credentials changed, so a failure an earlier run reported
   * no longer holds.
   */
  private async refreshReadiness(options: { force?: boolean; changed?: boolean; only?: CliAgentId } = {}) {
    this.lastConnectionCheck = Date.now();
    const deps = this.agentCheckDeps();
    await Promise.all([
      ...(options.only ? [] : [this.connections.check("agent:deepagents", async () => [await this.kernlAgentStatus()], options)]),
      ...CLI_AGENT_IDS.filter((id) => !options.only || id === options.only).map((id) => this.connections.check(`agent:${id}`, async () => [await checkAgent(id, deps)], options)),
    ]);
  }

  /** How the agents' status commands run: the agent's own binary and launch environment, in the shown folder. */
  private agentCheckDeps(): AgentCheckDeps {
    const overrides = readSettings().agentCommands as Record<string, any>;
    return {
      launch: async (id: CliAgentId) => resolveLaunch(id, overrides, await this.host.agentEnv(id)),
      hasStoredKey: async (id: CliAgentId) => !!(await this.agentCredentials.get(id)),
      launchOverride: (id: CliAgentId) => (typeof overrides?.[id]?.command === "string" ? { command: overrides[id].command as string } : undefined),
      find: (c: string, env: Record<string, string | undefined>) => resolveCommand(c, env as NodeJS.ProcessEnv),
      run: this.statusCommands,
      cwd: this.activeFolder()?.root,
      now: Date.now,
    };
  }

  /**
   * Everything the Connections view shows, checked now: logins, stored keys, every agent's MCP servers
   * (this connects to them), and Claude Code's plugins. Run when the view opens and on Check now.
   */
  async checkConnections(options: { force?: boolean } = {}) {
    const deps = this.agentCheckDeps();
    await Promise.all([
      this.refreshReadiness(options),
      this.checkKeys(options),
      ...CLI_AGENT_IDS.map((id) => this.connections.check(`mcp:${id}`, () => checkAgentMcp(id, deps), options)),
      this.connections.check("plugin:claude-code", () => checkClaudePlugins(deps), options),
      this.workspace(this.active)?.checkMcp() ?? Promise.resolve(),
    ]);
  }

  /** Stored keys, asked of each provider's model list (no tokens spent); kernl.connections.checkKeys turns it off. */
  private async checkKeys(options: { force?: boolean; changed?: boolean } = {}) {
    if (!vscode.workspace.getConfiguration("kernl").get<boolean>("connections.checkKeys", true)) return;
    const s = readSettings();
    const custom = customProviders(s.customProviders);
    const providers: { id: ProviderId; baseUrl?: string; custom?: CustomProvider }[] = [
      ...(["anthropic", "openai", "google", "deepseek"] as const).map((id) => ({ id })),
      { id: "openai-compatible" as const, baseUrl: s.baseUrl || undefined },
      ...("error" in custom ? [] : custom.map((c) => ({ id: `custom:${c.id}` as ProviderId, baseUrl: c.baseUrl, custom: c }))),
    ];
    const status = (id: string, kind: ConnectionStatus["kind"], owner: string, label: string, p: { state: ConnectionStatus["state"]; detail: string }, target: string): ConnectionStatus => ({
      id,
      kind,
      owner,
      label,
      ...p,
      source: "key check (GET /models)",
      checkedAt: Date.now(),
      ...(p.state === "needsAction" ? { fix: { label: "Set key", action: "setKey" as const, target } } : {}),
    });
    await Promise.all([
      ...providers.map((p) =>
        this.connections.check(`key:${p.id}`, async () => {
          const auth = await this.keys.auth(p.id, s.customProviders);
          // A custom provider may authenticate with a secret header instead of a key; one whose secret
          // header isn't stored yet (it's being added) isn't asked, so it's never sent incomplete.
          if (!auth.apiKey && !p.custom?.secretHeaders.length) return [];
          if (p.custom && missingSecretHeader(p.custom, auth)) return [];
          const req = modelsRequest(p, auth);
          if (!req) return [status(`key:${p.id}`, "providerKey", "kernl", `${p.id} key`, { state: "unknown", detail: "Stored; no URL to check it against" }, p.id)];
          return [status(`key:${p.id}`, "providerKey", "kernl", `${p.id} key`, await checkKey(req, p.id), p.id)];
        }, options),
      ),
      ...(["claude-code", "codex"] as const).map((id) =>
        this.connections.check(`agentKey:${id}`, async () => {
          const stored = await this.agentCredentials.get(id);
          if (!stored) return [];
          const req = keyRequest(id === "claude-code" ? "anthropic" : "openai", stored.apiKey, stored.baseUrl);
          const label = agentLabel(id);
          return [status(`agentKey:${id}`, "agentKey", label, `${label} key`, req ? await checkKey(req, stored.baseUrl ? hostOf(stored.baseUrl) : label) : { state: "unknown", detail: "Stored" }, id)];
        }, options),
      ),
    ]);
  }

  /** kernl's own agent: its provider settings and stored key. */
  private async kernlAgentStatus(): Promise<ConnectionStatus> {
    const problem = await this.deepAgentsProblem();
    const s = readSettings();
    return {
      id: "agent:deepagents",
      kind: "agent",
      owner: "kernl",
      label: "kernl",
      state: problem ? "needsAction" : "ready",
      detail: problem ?? `Uses ${s.provider}${s.model ? ` (${s.model})` : ""}`,
      source: "kernl settings",
      checkedAt: Date.now(),
      ...(problem ? { fix: { label: "Choose provider and model", action: "setKey" as const, target: "deepagents" } } : {}),
    };
  }

  private lastConnectionCheck = 0;
  private staleConnections(ms: number) {
    return Date.now() - this.lastConnectionCheck > ms;
  }

  /** Statuses changed: the agent chip and menu follow at once (several changes in a row are sent once). */
  private connectionsTimer: NodeJS.Timeout | undefined;
  private connectionsChanged() {
    clearTimeout(this.connectionsTimer);
    this.connectionsTimer = setTimeout(() => {
      this.postWorkspaces();
      this.panel.post({ type: "connections", items: this.connections.list() });
    }, 50);
  }

  /** "kernl: Show connections": the panel, with the Connections view open (at `focus`, a row id). */
  async showConnections(focus?: string) {
    await this.panel.reveal();
    this.panel.post({ type: "connections", items: this.connections.list(), open: true, focus });
  }

  /** A row's fix button in the Connections view. */
  private async connectionAction(action: FixAction, target: string) {
    switch (action) {
      case "check":
        return this.checkConnections({ force: true });
      case "login":
        if (target.startsWith("mcp:claude-code:")) return this.signInToClaudeMcp(target.slice("mcp:claude-code:".length));
        return isCliAgentId(target) ? this.openLoginTerminal(target) : undefined;
      case "setKey":
        if (target === "deepagents") return this.pickModel();
        if (isCliAgentId(target)) return this.agentLogins();
        if (isProviderId(target)) {
          const changed = await promptForApiKey(this.keyTargets(), target);
          if (changed) this.inputsChanged({ kind: "keys", harnesses: changed });
        }
        return;
      case "openSettings":
        return this.openSettings();
      case "showSources":
        return this.showSources();
    }
  }

  /**
   * Log in: a terminal running the agent's own login (`claude auth login`, `codex login`, `opencode auth
   * login`) with the binary and folder kernl launches, and never kernl's stored keys. kernl never sees
   * the login. While the terminal is open the login is checked every 5 s (a keychain login changes no
   * file kernl could watch), and once more when it closes.
   */
  private async openLoginTerminal(id: CliAgentId) {
    const deps = this.agentCheckDeps();
    const launch = await deps.launch(id);
    if ("error" in launch) return void vscode.window.showWarningMessage(launch.error);
    const binary = agentBinary(id, launch, deps.launchOverride(id), deps.find);
    if (!binary) return void vscode.window.showWarningMessage(`${agentLabel(id)} starts with your own command (kernl.agentCommands); log it in the way that command expects.`);
    const env = { ...launch.env };
    for (const name of [CREDENTIAL_ENV[id]?.apiKey, CREDENTIAL_ENV[id]?.baseUrl]) if (name) delete env[name];
    const terminal = vscode.window.createTerminal({ name: `kernl: log in to ${agentLabel(id)}`, shellPath: binary, shellArgs: LOGIN_ARGS[id], env, cwd: this.activeFolder()?.root });
    terminal.show();
    const started = Date.now();
    const poll = setInterval(() => {
      if (Date.now() - started > 5 * 60_000) return clearInterval(poll);
      void this.refreshReadiness({ force: true, only: id }).then(() => {
        if (this.connections.get(`agent:${id}`)?.state === "ready") clearInterval(poll);
      });
    }, 5_000);
    const closed = vscode.window.onDidCloseTerminal((t) => {
      if (t !== terminal) return;
      closed.dispose();
      clearInterval(poll);
      void this.refreshReadiness({ changed: true, only: id });
    });
    this.disposables.push(closed, { dispose: () => clearInterval(poll) });
  }

  /** A Claude Code MCP server that needs a sign-in signs in inside Claude Code: open it, and say how. */
  private async signInToClaudeMcp(server: string) {
    const deps = this.agentCheckDeps();
    const launch = await deps.launch("claude-code");
    const binary = "error" in launch ? undefined : agentBinary("claude-code", launch, deps.launchOverride("claude-code"), deps.find);
    if (!binary || "error" in launch) return void vscode.window.showWarningMessage("Claude Code isn't available to sign in from; check Agents in Connections.");
    const terminal = vscode.window.createTerminal({ name: `kernl: sign in to ${server}`, shellPath: binary, env: launch.env, cwd: this.activeFolder()?.root });
    terminal.show();
    void vscode.window.showInformationMessage(`In Claude Code, type /mcp, choose "${server}", then Authenticate. kernl checks again when you close the terminal.`);
    const closed = vscode.window.onDidCloseTerminal((t) => {
      if (t !== terminal) return;
      closed.dispose();
      void this.checkConnections({ force: true });
    });
    this.disposables.push(closed);
  }

  /**
   * Logins can change without any file kernl can watch (Claude Code keeps them in the macOS keychain),
   * so logins are checked again every kernl.connections.pollSeconds while the panel is visible.
   */
  private pollConnections(): vscode.Disposable {
    let timer: NodeJS.Timeout | undefined;
    const schedule = () => {
      clearTimeout(timer);
      const seconds = vscode.workspace.getConfiguration("kernl").get<number>("connections.pollSeconds", 60);
      if (!(seconds > 0)) return;
      timer = setTimeout(() => {
        if (this.panel.visible && this.staleConnections(seconds * 1000 - 1000)) void this.refreshReadiness();
        schedule();
      }, seconds * 1000);
    };
    schedule();
    const settings = vscode.workspace.onDidChangeConfiguration((e) => e.affectsConfiguration("kernl.connections.pollSeconds") && schedule());
    return { dispose: () => (clearTimeout(timer), settings.dispose()) };
  }

  /** The CLIs' own login and config files: a change (a login, a logout, a profile switch) is checked at once. */
  /** A CLI agent's session store changed on disk: its cached list (per folder) is stale. The stores are never read. */
  private watchSessionStores(): vscode.Disposable[] {
    return CLI_AGENT_IDS.flatMap((agent) => {
      const { base, pattern } = sessionStore(agent);
      const watcher = vscode.workspace.createFileSystemWatcher(new vscode.RelativePattern(vscode.Uri.file(base), pattern));
      const stale = () => this.forgetAgentSessions(agent);
      watcher.onDidChange(stale), watcher.onDidCreate(stale), watcher.onDidDelete(stale);
      return [watcher];
    });
  }

  /**
   * The ready CLI agents' stored sessions for a workspace's folder, each agent asked in parallel
   * (ACP session/list) unless its list is cached and its store hasn't changed since. An agent that
   * can't list is left out (logged).
   */
  private watchCredentialFiles(): vscode.Disposable[] {
    const roots = sourceRoots();
    let timer: NodeJS.Timeout | undefined;
    const changed = () => {
      clearTimeout(timer);
      timer = setTimeout(() => void this.refreshReadiness({ changed: true }), 500);
    };
    const watched: [string, string][] = [
      [roots.claudeDir, "{.credentials.json,settings.json}"],
      [dirname(roots.claudeJson), basename(roots.claudeJson)],
      [roots.codexDir, "{auth.json,config.toml}"],
      [join(roots.home, ".local", "share", "opencode"), "{auth.json,opencode.db}"],
      [roots.opencodeDir, "{opencode.json,opencode.jsonc}"],
    ];
    const watchers = watched.map(([dir, glob]) => vscode.workspace.createFileSystemWatcher(new vscode.RelativePattern(vscode.Uri.file(dir), glob)));
    for (const w of watchers) w.onDidChange(changed), w.onDidCreate(changed), w.onDidDelete(changed);
    return [...watchers, { dispose: () => clearTimeout(timer) }];
  }

  /** The agent chip: kernl and its named agents first, then the CLI agents, each with what it needs. */
  private async pickHarness() {
    // Statuses are kept current (startup, focus, the poll, file and key changes); only the first menu waits for them.
    if (this.connections.get("agent:deepagents")) void this.refreshReadiness();
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

  /**
   * The history button: the Conversations view, shown at once with this workspace's conversations.
   * Each ready CLI agent's own sessions in this folder (started in a terminal or another app) join as
   * that agent answers: a list fetched before shows straight away and is asked again when it's older
   * than AGENT_SESSIONS_TTL_MS, so no agent's start holds the view up.
   */
  async showSessions() {
    const ws = this.workspace(this.active);
    if (!ws || ws.running) return;
    await this.panel.reveal();
    await ws.saveSession();
    const kept = await this.host.sessions.list(ws.sessionKey);
    const agents = vscode.workspace.getConfiguration("kernl").get<boolean>("sessions.importFromAgents", true) ? CLI_AGENT_IDS.filter((a) => this.readiness(a).ready) : [];
    const labelOf = (h: string) => this.harnessList().find((x) => x.id === h)?.label ?? h;
    const state = agents.map((agent) => {
      const cached = this.agentSessionLists.get(`${agent}\n${ws.root}`);
      return { id: agent, label: labelOf(agent), sessions: cached?.sessions, pending: !cached || Date.now() - cached.at >= AGENT_SESSIONS_TTL_MS };
    });
    const post = (open?: boolean) =>
      this.panel.post({
        type: "conversations",
        workspace: ws.id,
        title: `Conversations in ${ws.view().label}`,
        rows: conversationRows({ kept, current: ws.sessionId, agents: state, label: labelOf, now: Date.now() }),
        ...(open ? { open } : {}),
      });
    post(true);
    for (const a of state.filter((x) => x.pending)) {
      void this.listAgentSessions(ws, a.id, a.label).then((sessions) => {
        if (sessions) a.sessions = sessions;
        a.pending = false;
        post();
      });
    }
  }

  /**
   * An agent's sessions for a workspace's folder, asked once at a time: a request still running (the
   * clock clicked again) is shared rather than starting the agent again. The answer goes in the cache.
   */
  private listAgentSessions(ws: WorkspaceRuntime, agent: CliAgentId, label: string): Promise<acp.SessionInfo[] | undefined> {
    const key = `${agent}\n${ws.root}`;
    const generation = this.agentSessionGeneration;
    const running = this.agentSessionRequests.get(key);
    if (running?.generation === generation) return running.request;
    const started = Date.now();
    const request = ws.listAgentSessions(agent).then((sessions) => {
      this.log.info(`[${ws.label}] ${label} ${sessions ? `listed ${sessions.length} session(s)` : "listed no sessions"} in ${((Date.now() - started) / 1000).toFixed(1)} s`);
      // Asked before the lists were forgotten (the agent's launch or its sessions changed): not kept.
      if (sessions && generation === this.agentSessionGeneration) this.agentSessionLists.set(key, { at: Date.now(), sessions });
      return sessions;
    }).finally(() => this.agentSessionRequests.get(key)?.request === request && this.agentSessionRequests.delete(key));
    this.agentSessionRequests.set(key, { generation, request });
    return request;
  }

  /** Forgets the agents' session lists (one agent's, or all): cached ones, and requests still running. */
  private forgetAgentSessions(agent?: CliAgentId) {
    this.agentSessionGeneration++;
    for (const map of [this.agentSessionLists, this.agentSessionRequests] as Map<string, unknown>[]) {
      for (const key of [...map.keys()]) if (!agent || key.startsWith(`${agent}\n`)) map.delete(key);
    }
  }

  /** A row picked in the Conversations view: a new conversation, one kernl kept, or a CLI agent's session not opened in kernl yet. */
  private async openConversation(workspace: string, pick: ConversationPick) {
    const ws = this.workspace(workspace);
    if (!ws) return;
    if (pick.kind === "new") return this.newChat(ws.id);
    if (pick.kind === "agent") {
      // Only a session the agent listed for this folder: the panel's rows carry nothing else.
      const agent = CLI_AGENT_IDS.find((a) => a === pick.agent);
      const session = agent && this.agentSessionLists.get(`${agent}\n${ws.root}`)?.sessions.find((s) => s.sessionId === pick.sessionId);
      if (!agent || !session || !(await this.stopToOpen(ws))) return;
      const record = this.host.sessions.create(agent);
      record.importedFrom = { agent, sessionId: session.sessionId };
      record.history = { sessionId: session.sessionId };
      if (session.title?.trim()) record.agentTitle = session.title.trim();
      return this.openAgentSession(ws, record);
    }
    const record = await this.host.sessions.load(ws.sessionKey, pick.id);
    if (!record || record.id === ws.sessionId || !(await this.stopToOpen(ws))) return;
    if (record.importedFrom) return this.openAgentSession(ws, record);
    if (record.harness !== ws.harness && isHarness(record.harness)) await this.setHarness(ws.id, record.harness);
    await ws.openSession(record);
  }

  /** Opening another conversation while the agent works: ask, stop it, and wait until its turn has ended. False when declined or it didn't stop. */
  private async stopToOpen(ws: WorkspaceRuntime): Promise<boolean> {
    if (!(await this.confirmStop(ws, "Stop the agent and open this conversation?", "Stop and open"))) return false;
    try {
      await ws.stopAndWait();
      return true;
    } catch (err) {
      void vscode.window.showWarningMessage(err instanceof Error ? err.message : String(err));
      return false;
    }
  }

  /** Opens a CLI agent's session in a workspace, with a notice when Claude Code has it open in another app (sending here continues it). */
  private async openAgentSession(ws: WorkspaceRuntime, record: SessionRecord) {
    const { agent, sessionId } = record.importedFrom!;
    if (ws.harness !== agent) await this.setHarness(ws.id, agent);
    if (ws.harness !== agent) return;
    const elsewhere = agent === "claude-code" && (await claudeSessionOpenElsewhere(sessionId));
    await ws.openAgentSession(record, elsewhere ? "This session is open in another app. Read it here; sending a message continues it in kernl, apart from that app." : undefined);
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

  /** Another conversation, from any workspace of the window and any agent, tagged as a thread. */
  private async pickSessionAttachment(ws: WorkspaceRuntime) {
    await ws.saveSession();
    const threads = await this.threadCandidates(ws);
    if (!threads.length) return void vscode.window.showInformationMessage("No other conversations yet.");
    const picked = await this.prompts.pick(
      threads.map((t) => ({ label: t.path, description: `${t.thread!.agent} · ${t.thread!.workspace}`, thread: t })),
      { title: "Tag a conversation" },
    );
    if (picked) this.panel.post({ type: "addAttachments", items: [picked.thread] });
  }

  /**
   * What "@" and + > Conversations can tag, newest first, except the conversation `shown` is in: the
   * conversations kernl kept in the window's workspaces (folders and worktrees; any agent), and each ready
   * CLI agent's own sessions there that kernl hasn't opened (from the lists Conversations fetches). With a
   * `query`, those whose title contains it; with none (just "@"), lists that are missing or old are asked
   * for in the background, so they're there a keystroke later.
   */
  private async threadCandidates(shown: WorkspaceRuntime, query = ""): Promise<Attachment[]> {
    const harnesses = [...HARNESSES, ...this.namedHarnesses];
    const labelOf = (id: string) => harnesses.find((h) => h.id === id)?.label ?? id;
    const matches = (title: string) => title.toLowerCase().includes(query.toLowerCase());
    const agents = vscode.workspace.getConfiguration("kernl").get<boolean>("sessions.importFromAgents", true) ? CLI_AGENT_IDS.filter((a) => this.readiness(a).ready) : [];
    const seen = new Set<string>();
    const out: Attachment[] = [];
    for (const ws of this.workspaces.values()) {
      if (ws.tabOf || seen.has(ws.sessionKey)) continue;
      seen.add(ws.sessionKey);
      const kept = await this.host.sessions.list(ws.sessionKey);
      for (const s of kept) {
        if (s.id === shown.sessionId || !matches(s.title)) continue;
        out.push({ kind: "thread", path: s.title, thread: { workspaceKey: ws.sessionKey, id: s.id, agent: labelOf(s.harness), workspace: ws.label, updatedAt: s.updatedAt } });
      }
      const linked = new Set(kept.map((s) => s.agentSessionId).filter(Boolean));
      for (const agent of agents) {
        const cached = this.agentSessionLists.get(`${agent}\n${ws.root}`);
        if (!query && (!cached || Date.now() - cached.at >= AGENT_SESSIONS_TTL_MS)) void this.listAgentSessions(ws, agent, labelOf(agent));
        for (const session of cached?.sessions ?? []) {
          const title = session.title?.trim() || "Untitled session";
          if (linked.has(session.sessionId) || !matches(title)) continue;
          const updated = session.updatedAt ? Date.parse(session.updatedAt) : NaN;
          out.push({
            kind: "thread",
            path: title,
            thread: { workspaceKey: ws.sessionKey, id: session.sessionId, agent: `${labelOf(agent)} session`, workspace: ws.label, updatedAt: Number.isNaN(updated) ? 0 : updated, agentSession: { agent, sessionId: session.sessionId, root: ws.root } },
          });
        }
      }
    }
    return out.sort((a, b) => b.thread!.updatedAt - a.thread!.updatedAt);
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
    const shown = this.workspace(this.active);
    await this.refreshReadiness({ force: true });
    const changed = await agentLogins(
      this.keyTargets(),
      async (id) => this.readiness(id),
      (id) => this.openLoginTerminal(id),
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
      const reply = await createChatModel(s, await this.keys.auth(provider, s.customProviders)).invoke("Reply with the single word: ok");
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
  private projectServerAllowed(server: McpServer): boolean {
    const fingerprint = createHash("sha256").update(JSON.stringify(server.connection)).digest("hex");
    return this.context.workspaceState.get(`kernl.allowedMcpServer.${server.name}`) === fingerprint;
  }

  private async allowProjectServer(server: McpServer): Promise<boolean> {
    const key = `kernl.allowedMcpServer.${server.name}`;
    const fingerprint = createHash("sha256").update(JSON.stringify(server.connection)).digest("hex");
    if (this.projectServerAllowed(server)) return true;
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
    // Servers that wanted a sign-in when kernl's agent connected (OAuth servers Claude Code signs in to itself).
    for (const s of this.signInRequired.list()) {
      imports.mcpServers = imports.mcpServers.filter((i) => i.name !== s.name);
      imports.skipped.push({ item: `MCP server ${s.name}`, origin: s.origin, reason: SIGN_IN_REASON });
    }
    const doc = await vscode.workspace.openTextDocument({ language: "markdown", content: sourcesReport(imports, { mcpServers: own }) });
    await vscode.window.showTextDocument(doc, { preview: true });
  }

  private postWorkspaces(focus?: string) {
    // With no workspace (no usable folder yet) there's nothing to keep, and the saved tabs stay as they were.
    if (this.workspaces.size) this.saveTabs();
    this.updateStatusItem();
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
        // A panel that loaded again has no edit open: queued messages held for one carry on.
        for (const ws of this.workspaces.values()) ws.releaseQueueEdits();
        void this.postSkills();
        this.postActiveFile();
        await this.postStatus();
        this.postWorkspaces();
        this.panel.post(panelSnapshot([...this.requests].map(([id, r]) => [id, { workspace: r.workspace, request: r.request }])));
        this.restoreDraft();
        this.prepareShown();
        return;
      case "send": {
        const ws = this.workspace(m.workspace);
        // A CLI agent's first check, or its check after a change, is about to answer: wait for it (capped) rather
        // than read "unknown" as uncertain. A routine recheck keeps the last answer and isn't waited for.
        if (ws && isCliAgentId(ws.harness)) await this.connections.whenAnswered(`agent:${ws.harness}`, STATUS_TIMEOUT_MS);
        // Only a definite "can't start" from a check stops a message here. Anything uncertain, and a failure an
        // earlier run reported (the user may have fixed it since), goes to the agent, which reports its own error.
        const checked = ws && this.connections.get(`agent:${ws.harness}`);
        const r = ws && checked && checked.source !== "last run" ? this.readiness(ws.harness) : undefined;
        if (ws && r && !r.ready && isCliAgentId(ws.harness)) {
          this.panel.post({ type: "userMessage", workspace: ws.id, text: m.text });
          this.panel.post({ type: "finished", workspace: ws.id, reason: "error", message: `${r.problem} (Agent logins in the ... menu can help.)` });
          return;
        }
        if (ws && !ws.running && [...this.workspaces.values()].some((o) => o !== ws && o.root === ws.root && o.running)) {
          this.panel.post({ type: "notice", workspace: ws.id, text: "Another tab is also working in this folder: both may change the same files. A worktree workspace keeps work apart." });
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
      case "newTab":
        return this.newTab();
      case "closeTab":
        return this.closeTab(m.workspace);
      case "newChat":
        return this.newChat(m.workspace);
      case "showConversations":
        return this.showSessions();
      case "showHelp":
        return this.showHelp();
      case "editQueued":
        return this.workspace(m.workspace)?.editingQueue(m.id, m.editing);
      case "updateQueued":
        return this.workspace(m.workspace)?.updateQueued(m.id, m.text);
      case "searchFiles": {
        const ws = this.workspace(this.active);
        if (!ws) return;
        // Conversations come with files: first when the text matches a title, after the files otherwise.
        const [files, threads] = await Promise.all([searchWorkspace(ws.root, m.query), this.threadCandidates(ws, m.query)]);
        const tagged = threads.slice(0, 5);
        this.panel.post({ type: "fileMatches", query: m.query, items: m.query ? [...tagged, ...files] : [...files, ...tagged] });
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
      case "openConversation":
        return this.openConversation(m.workspace, m.pick);
      case "showConnections":
        this.panel.post({ type: "connections", items: this.connections.list() });
        return this.checkConnections();
      case "connectionAction":
        return this.connectionAction(m.action, m.target);
      case "openSettings":
        return this.openSettings();
      case "focus": {
        const folderBefore = this.folderIdOf(this.active);
        if (this.workspace(m.workspace)) this.active = m.workspace;
        this.tabUsed.set(this.active, Date.now());
        // A tab restored after a reload opens its conversation when it's first shown.
        const conversation = this.tabConversation.get(this.active);
        if (conversation) (this.tabConversation.delete(this.active), void this.openConversation(this.active, { kind: "kernl", id: conversation }));
        this.postActiveFile();
        this.prepareShown();
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
      case "draft":
        return this.keepDraft(m.text, m.attachments);
      case "keyboardFocus":
        this.panelHasKeyboard = m.inPanel;
        return;
      case "pickAgentOption": {
        const kind = this.workspace(m.workspace)?.view().agentOptions?.find((o) => o.id === m.id)?.kind;
        return this.anchored(kind === "thinking" ? "thinking" : "model", () => this.pickAgentOption(m.workspace, m.id));
      }
      case "setAgentOption": {
        // The panel only toggles fast mode; anything else it sends is ignored.
        const option = this.workspace(m.workspace)?.view().agentOptions?.find((o) => o.id === m.id);
        if (option?.kind === "fast" && typeof m.value === "boolean") await this.workspace(m.workspace)!.setAgentOption(m.id, m.value);
        return;
      }
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
      case "pickThinking":
        return this.anchored("thinking", () => this.pickThinking());
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
    if (id === this.active) this.prepareShown();
  }

  /**
   * The folder is the one shown when New workspace starts: its repository gets the worktree, and the
   * workspace is listed under it, even if the panel shows another folder by the time the prompts end.
   */
  async newWorkspace() {
    const folder = this.folderIdOf(this.active);
    const info = await this.commands.create(this.workspace(folder)?.root);
    if (!info || !this.workspace(folder)) return;
    this.postWorkspaces(this.addWorktree(info, folder).id);
  }

  private async review(id: string) {
    const info = this.workspace(id)?.info;
    if (info) await this.commands.review(info);
  }

  /** Merges a worktree workspace. Its tabs work in the same worktree: none may be running. */
  private async merge(id: string) {
    const ws = this.workspace(this.workspace(id)?.tabOf ?? id);
    if (!ws?.info) return;
    if (this.tabsOf(ws.id).some((t) => t.running)) {
      return void this.panel.post({ type: "notice", workspace: this.active, text: "Stop the agent in this workspace's tabs before merging: a tab is still working in the worktree." });
    }
    await this.commands.merge(ws.info);
  }

  /**
   * Discards a worktree workspace with all its tabs. Every tab's conversation is saved first, and every
   * tab is stopped before the worktree folder is removed, so no agent is left working in a folder that's gone.
   */
  private async discard(id: string): Promise<void> {
    const ws = this.workspace(this.workspace(id)?.tabOf ?? id);
    if (!ws?.info) return;
    const tabs = this.tabsOf(ws.id);
    await Promise.all(tabs.map((t) => t.saveSession()));
    if (await this.commands.discard(ws.info, () => tabs.forEach((t) => t.dispose()))) {
      id = ws.id;
      const folder = this.folderIdOf(id);
      for (const tab of tabs.slice(1)) (this.workspaces.delete(tab.id), void this.host.sessions.saveQueue(tab.queueKey, []).catch(() => {}));
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

  /** Before something that ends the workspace's run (New chat, Close tab, opening another conversation): asks while it works. True to go ahead. */
  private async confirmStop(ws: WorkspaceRuntime, question: string, button: string): Promise<boolean> {
    return !ws.running || this.prompts.confirm(question, "This conversation stays in Conversations.", button);
  }

  /** New chat (title bar, kernl menu, /new): a new conversation in that workspace or tab, asking first while its agent works. */
  async newChat(id = this.active) {
    const ws = this.workspace(id);
    if (!ws) return;
    if (!(await this.confirmStop(ws, "Stop the agent and start a new chat?", "Stop and start new"))) return;
    ws.newThread();
    this.prepareShown();
  }

  /**
   * The shown workspace's CLI agent starts its session now (while the panel is on screen), so its
   * model, thinking, and fast chips can be chosen before the first message. Hidden workspaces don't start.
   */
  private prepareShown() {
    const ws = this.workspace(this.active);
    if (ws && this.panel.visible) void ws.prepareAgent();
  }

  /** /help, kernl: Help, the kernl menu: kernl's help page (shipped with the extension) in VS Code's Markdown preview. */
  async showHelp() {
    const page = vscode.Uri.joinPath(this.context.extensionUri, "docs", "guides", "help.md");
    try {
      await vscode.commands.executeCommand("markdown.showPreview", page);
    } catch (err) {
      void vscode.window.showErrorMessage(`kernl couldn't open its help in VS Code's Markdown preview (${err instanceof Error ? err.message : String(err)}). The page is ${page.fsPath}.`);
    }
  }

  async openSettings() {
    await vscode.commands.executeCommand("workbench.action.openSettings", "@ext:local.kernl");
  }

  /** The workspace chip: switch, create, and for a worktree, review, merge, or discard. */
  private async pickWorkspace() {
    type Item = vscode.QuickPickItem & { run: () => unknown };
    const state = (w: WorkspaceRuntime) => [w.running ? "running" : undefined, w.approvals.size ? `${w.approvals.size} waiting` : undefined].filter(Boolean).join(" · ");
    const shown = this.workspace(this.active)?.tabOf ?? this.active;
    const items: Item[] = [...this.workspaces.values()].filter((w) => !w.tabOf).map((w) => ({
      label: `${w.id === shown ? "$(check) " : ""}${w.label}`,
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
    return settingsProblem(s, await this.keys.auth(s.provider, s.customProviders));
  }

  async postStatus() {
    const s = readSettings();
    const scope = currentWorkspaceScope();
    const problem = await this.deepAgentsProblem();
    const resolved = resolveProvider(s);
    const model = "error" in resolved ? s.model : resolved.model;
    const thinking = this.thinkingLevel(s);
    const thinkingDisplay = s.thinkingDisplay === "collapsed" || s.thinkingDisplay === "expanded" ? s.thinkingDisplay : "auto";
    this.panel.post({ type: "status", ready: !problem, problem, provider: s.provider, model, thinking, restricted: scope.ok && !scope.trusted, thinkingDisplay, previewBase: this.panel.previewBase() });
  }

  /** The current model's thinking level, or undefined when its provider has no thinking control or the settings can't build it. */
  private thinkingLevel(s: ReturnType<typeof readSettings>): ThinkingLevel | undefined {
    const r = resolveProvider(s);
    if ("error" in r || providerApi(r) === "deepseek") return undefined;
    const o = effectiveModelOptions(s, r);
    return "error" in o ? undefined : (o.reasoningEffort ?? "off");
  }

  /** The thinking chip: sets reasoningEffort in the current model's kernl.modelProfiles entry (user settings); the agent rebuilds at the next message. */
  private async pickThinking() {
    const s = readSettings();
    const r = resolveProvider(s);
    const current = this.thinkingLevel(s);
    if ("error" in r || !current) return;
    const picked = await this.prompts.pick(
      THINKING_LEVELS.map((level) => ({ label: level === "off" ? "Off" : level[0].toUpperCase() + level.slice(1), description: level === current ? "current" : undefined, level })),
      { title: `Thinking for ${r.model}` },
    );
    if (!picked || picked.level === current) return;
    const config = vscode.workspace.getConfiguration("kernl");
    const key = profileKey(r.provider, r.model);
    const profiles: Record<string, unknown> = { ...config.inspect<Record<string, unknown>>("modelProfiles")?.globalValue };
    profiles[key] = { ...(profiles[key] as object | undefined), reasoningEffort: picked.level };
    await config.update("modelProfiles", profiles, vscode.ConfigurationTarget.Global);
  }

  /** Each workspace decides whether the change concerns it; running ones rebuild after their run. */
  private inputsChanged(change: InputChange) {
    this.log.info(`inputs changed (${change.kind}); affected idle workspaces rebuild now, running ones after their run`);
    for (const ws of this.workspaces.values()) ws.inputsChanged(change);
    this.postWorkspaces();
    void this.postStatus();
    // An idle workspace just rebuilt (its agent's session closed): the shown one starts again.
    this.prepareShown();
    // A change to how agents launch (kernl.agentCommands) or to their keys makes their last status stale.
    const launchChanged = change.kind === "keys" || (change.kind === "settings" && change.affects("kernl.agentCommands"));
    // A different launch (or login) can mean a different list of the agent's own sessions.
    if (launchChanged) this.forgetAgentSessions();
    void this.refreshReadiness(launchChanged ? { changed: true } : {});
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
      /** What a folder change does: every workspace (and tab) rebuilt from the folders and the saved tabs. */
      reloadWorkspaces: () => this.reloadWorkspaces(),
      /** A workspace's run state, part by part (for the integration tests' failure timeline). */
      runState: (workspace: string) => this.workspace(workspace)?.runState(),
      approvalRules: () => approvalRules(),
      setHarness: (workspace: string, harness: string) => this.setHarness(workspace, harness),
      useGitHub: (source: GitHubSource) => (this.github = source),
      useStatusCommands: (run: AgentCheckDeps["run"]) => (this.statusCommands = run),
      /** Ask kernl and @kernl's path: a message from outside the panel to the shown workspace. */
      sendFromOutside: (text: string, files: readonly string[] = []) => this.sendFromOutside(text, files),
    };
  }

  dispose() {
    for (const ws of this.workspaces.values()) ws.dispose();
    void this.sharedBrowser?.dispose();
    void this.toolServer.dispose();
    this.terminalHistory.dispose();
    for (const d of this.disposables) d.dispose();
  }
}

