import * as vscode from "vscode";
import { CLI_AGENT_IDS, CLI_AGENTS, type CliAgentId } from "./acp/agents";
import { CREDENTIAL_ENV, DEEPSEEK_ANTHROPIC_URL } from "./acp/credentials";
import type { Readiness } from "./harnesses";
import { addCustomProvider, type KeyTargets, keyStored, useProvider } from "./keyCommands";
import { BUILT_IN_PROVIDERS, customProviders, type ProviderId, resolveProvider } from "./providers/registry";

/**
 * The provider and login menus, all native QuickPicks:
 * - the model chip (pickModel): provider first, with whether its key is stored, then the model;
 * - Manage providers: each provider's key status; set, replace, remove, test; add a custom one;
 * - Agent logins: each CLI agent's status; log in in a terminal, or use a stored key.
 * Each returns the harnesses whose inputs changed (for the rebuild policy), or undefined.
 */
const BUILT_IN_LABELS: Record<string, string> = {
  anthropic: "Anthropic",
  openai: "OpenAI",
  google: "Google Gemini",
  deepseek: "DeepSeek",
  "openai-compatible": "Local or OpenAI-compatible server",
};

const config = () => vscode.workspace.getConfiguration("yourstack");

interface ProviderEntry {
  id: ProviderId;
  label: string;
  keyRequired: boolean;
  hasKey: boolean;
}

async function providers(t: KeyTargets): Promise<ProviderEntry[]> {
  const custom = customProviders(config().get("customProviders"));
  const ids: { id: ProviderId; label: string }[] = [
    ...BUILT_IN_PROVIDERS.map((id) => ({ id: id as ProviderId, label: BUILT_IN_LABELS[id] })),
    ...("error" in custom ? [] : custom).map((c) => ({ id: `custom:${c.id}` as ProviderId, label: c.label })),
  ];
  return Promise.all(ids.map(async (p) => ({ ...p, keyRequired: p.id !== "openai-compatible", hasKey: !!(await t.keys.get(p.id)) })));
}

const keyStatus = (p: ProviderEntry) => (p.hasKey ? "key stored" : p.keyRequired ? "no key yet" : "no key needed");

/** `offerUse`: after storing, offer to switch YourStack to this provider (when the flow doesn't do that itself). */
async function askKey(t: KeyTargets, p: ProviderEntry, offerUse = false): Promise<boolean> {
  const key = await t.prompts.input({ title: `API key for ${p.label}`, password: true, ignoreFocusOut: true });
  if (!key) return false;
  await t.keys.store(p.id, key);
  keyStored(p.label, offerUse ? p.id : undefined);
  return true;
}

/** Asks for a model id, suggesting the current one or the provider's default. */
async function askModel(t: KeyTargets, p: ProviderEntry): Promise<string | undefined> {
  const current = config().get<string>("provider") === p.id ? config().get<string>("model", "") : "";
  const resolved = resolveProvider({ provider: p.id, model: current, baseUrl: config().get("baseUrl", ""), customProviders: config().get("customProviders") });
  const suggested = "error" in resolved ? current : resolved.model;
  return t.prompts.input({ title: `Model for ${p.label}`, value: suggested, prompt: "A model id, e.g. claude-sonnet-5-5, gpt-5.6, deepseek-flash. Empty uses the provider's default when it has one", ignoreFocusOut: true });
}

/** The model chip: provider (with key status), a key if it needs one, then the model. */
export async function pickModel(t: KeyTargets): Promise<string[] | undefined> {
  const current = config().get<string>("provider");
  const list = await providers(t);
  const picked = await t.prompts.pick(
    list.map((p) => ({ label: p.label, description: [p.id === current ? `current: ${config().get<string>("model") || "default model"}` : undefined, keyStatus(p)].filter(Boolean).join(" · "), provider: p })),
    { title: "YourStack: model provider" },
  );
  if (!picked) return undefined;
  const p = picked.provider;
  let keysChanged = false;
  if (p.keyRequired && !p.hasKey) {
    if (!(await askKey(t, p))) return undefined;
    keysChanged = true;
  }
  const model = await askModel(t, p);
  if (model === undefined) return keysChanged ? ["deepagents"] : undefined;
  await useProvider(p.id, model);
  return ["deepagents"];
}

/** "Manage providers": key status per provider; set, replace, remove, or test a key; add a custom provider. */
export async function manageProviders(t: KeyTargets, test: (provider: ProviderId, model: string) => Promise<string>): Promise<string[] | undefined> {
  const list = await providers(t);
  const ADD = { label: "$(add) Add a custom provider...", description: "any OpenAI-compatible service" };
  const picked = await t.prompts.pick<vscode.QuickPickItem & { provider?: ProviderEntry }>(
    [...list.map((p) => ({ label: p.label, description: keyStatus(p), provider: p })), ADD],
    { title: "YourStack: providers for the YourStack agent" },
  );
  if (!picked) return undefined;
  if (!picked.provider) return addCustomProvider(t);
  const p = picked.provider;
  type Action = "set" | "remove" | "test" | "use";
  const actions: (vscode.QuickPickItem & { action: Action })[] = [
    { label: p.hasKey ? "Replace key..." : "Set key...", action: "set" },
    ...(p.hasKey ? [{ label: "Remove key", action: "remove" as const }] : []),
    ...(p.hasKey || !p.keyRequired ? [{ label: "Test connection", description: "sends one tiny request", action: "test" as const }] : []),
    { label: "Use for YourStack...", description: "pick a model", action: "use" },
  ];
  const action = await t.prompts.pick(actions, { title: p.label });
  if (!action) return undefined;
  switch (action.action) {
    case "set":
      return (await askKey(t, p, true)) ? ["deepagents"] : undefined;
    case "remove":
      await t.keys.remove(p.id);
      return ["deepagents"];
    case "test": {
      const model = await askModel(t, p);
      if (model === undefined) return undefined;
      void vscode.window.showInformationMessage(`${p.label}: ${await test(p.id, model)}`);
      return undefined;
    }
    case "use": {
      if (p.keyRequired && !p.hasKey && !(await askKey(t, p))) return undefined;
      const model = await askModel(t, p);
      if (model === undefined) return undefined;
      await useProvider(p.id, model);
      return ["deepagents"];
    }
  }
}

const LOGIN_COMMAND: Record<CliAgentId, string> = { "claude-code": "claude", codex: "codex login", opencode: "opencode auth login" };

/**
 * "Agent logins": each CLI agent's status. A ready agent can be used in the shown workspace right
 * away (`use`, absent when there is no workspace); any agent can log in in a terminal or use a key
 * stored in YourStack.
 */
export async function agentLogins(t: KeyTargets, readiness: (id: CliAgentId) => Promise<Readiness>, use?: (id: CliAgentId) => Promise<void>): Promise<string[] | undefined> {
  const rows = await Promise.all(
    CLI_AGENT_IDS.map(async (id) => {
      const r = await readiness(id);
      const stored = await t.agents.get(id);
      const status = stored ? (stored.baseUrl === DEEPSEEK_ANTHROPIC_URL ? "using DeepSeek" : "using a stored API key") : r.ready ? "ready" : "not ready";
      return { label: CLI_AGENTS[id].label, description: status, detail: r.problem, id, stored: !!stored, ready: r.ready };
    }),
  );
  const picked = await t.prompts.pick(rows, { title: "YourStack: agent logins" });
  if (!picked) return undefined;
  type Action = "use" | "login" | "key" | "deepseek" | "remove";
  const actions: (vscode.QuickPickItem & { action: Action })[] = [
    ...(use && picked.ready ? [{ label: `Use ${picked.label} in this workspace`, description: "switch the agent now", action: "use" as const }] : []),
    { label: "Log in in a terminal", description: picked.ready ? `already logged in; runs ${LOGIN_COMMAND[picked.id]}` : LOGIN_COMMAND[picked.id], action: "login" },
    ...(CREDENTIAL_ENV[picked.id] ? [{ label: "Use an API key instead...", description: CREDENTIAL_ENV[picked.id]!.apiKey, action: "key" as const }] : []),
    ...(picked.id === "claude-code" ? [{ label: "Use DeepSeek...", description: "Claude Code on a DeepSeek key", action: "deepseek" as const }] : []),
    ...(picked.stored ? [{ label: "Remove the stored key", description: "back to the agent's own login", action: "remove" as const }] : []),
  ];
  const action = await t.prompts.pick(actions, { title: picked.label });
  if (!action) return undefined;
  switch (action.action) {
    case "use":
      await use!(picked.id);
      return undefined;
    case "login": {
      const terminal = vscode.window.createTerminal({ name: `${picked.label} login` });
      terminal.show();
      terminal.sendText(LOGIN_COMMAND[picked.id]);
      if (picked.id === "claude-code") void vscode.window.showInformationMessage("In the terminal, type /login and follow the steps. YourStack checks again when you come back.");
      return undefined;
    }
    case "key": {
      const key = await t.prompts.input({ title: `API key for ${picked.label}`, password: true, ignoreFocusOut: true });
      if (!key) return undefined;
      await t.agents.store(picked.id, { apiKey: key });
      keyStored(picked.label);
      return [picked.id];
    }
    case "deepseek": {
      const key = await t.prompts.input({ title: "DeepSeek API key for Claude Code", prompt: `Claude Code will use ${DEEPSEEK_ANTHROPIC_URL}`, password: true, ignoreFocusOut: true });
      if (!key) return undefined;
      await t.agents.store("claude-code", { apiKey: key, baseUrl: DEEPSEEK_ANTHROPIC_URL });
      keyStored("Claude Code (DeepSeek)");
      return ["claude-code"];
    }
    case "remove":
      await t.agents.remove(picked.id);
      return [picked.id];
  }
}
