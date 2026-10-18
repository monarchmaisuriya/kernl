import * as vscode from "vscode";
import { CLI_AGENTS, type CliAgentId } from "./acp/agents";
import { type AgentCredentials, CREDENTIAL_ENV, DEEPSEEK_ANTHROPIC_URL } from "./acp/credentials";
import type { KeyStore } from "./providers/keys";
import { BUILT_IN_PROVIDERS, customProviders, type ProviderId } from "./providers/registry";
import type { Prompts } from "./workspaces/commands";

const settings = () => vscode.workspace.getConfiguration("yourstack");

/** Where the key commands store keys. Each command returns the harnesses whose key changed, or undefined if cancelled. */
export interface KeyTargets {
  keys: KeyStore;
  agents: AgentCredentials;
  prompts: Prompts;
}

type Target = { provider: ProviderId } | { agent: CliAgentId };

/** Writes yourstack.provider and yourstack.model where yourstack.provider is already set (workspace, else user). */
export async function useProvider(provider: ProviderId, model: string) {
  const target = settings().inspect("provider")?.workspaceValue !== undefined ? vscode.ConfigurationTarget.Workspace : vscode.ConfigurationTarget.Global;
  await settings().update("provider", provider, target);
  await settings().update("model", model.trim(), target);
}

/**
 * Confirms a stored key. For a model provider YourStack doesn't use yet, it offers to switch to it
 * (with that provider's default model): a stored key alone doesn't change which provider is used.
 */
export function keyStored(label: string, provider?: ProviderId) {
  const offer = provider && provider !== settings().get<string>("provider") ? `Use ${label} for YourStack` : undefined;
  void vscode.window.showInformationMessage(`Key stored for ${label}.`, ...(offer ? [offer] : [])).then(async (choice) => {
    if (offer && choice === offer) await useProvider(provider!, "");
  });
}

/** "YourStack: Set API key": pick a Deep Agents provider (built-in or custom) or a CLI agent, paste a key, store it. */
export async function promptForApiKey(t: KeyTargets, currentProvider: string): Promise<string[] | undefined> {
  const custom = customProviders(settings().get("customProviders"));
  const items: (vscode.QuickPickItem & { target: Target })[] = [
    ...BUILT_IN_PROVIDERS.map((id) => ({ label: id, target: { provider: id as ProviderId }, picked: id === currentProvider })),
    ...("error" in custom ? [] : custom).map((c) => {
      const provider: ProviderId = `custom:${c.id}`;
      return { label: provider, description: `${c.label} (${c.baseUrl})`, target: { provider }, picked: provider === currentProvider };
    }),
    ...(Object.keys(CREDENTIAL_ENV) as CliAgentId[]).map((agent) => ({
      label: `CLI agent: ${CLI_AGENTS[agent].label}`,
      description: `${CREDENTIAL_ENV[agent]!.apiKey}, instead of its own login`,
      target: { agent },
    })),
  ];
  const picked = await t.prompts.pick(items, { title: "YourStack: what is this key for?" });
  if (!picked) return undefined;
  const target = picked.target;
  const name = "provider" in target ? target.provider : CLI_AGENTS[target.agent].label;
  const key = await t.prompts.input({ title: `API key for ${name}`, password: true, ignoreFocusOut: true });
  if (!key) return undefined;
  if ("provider" in target) {
    await t.keys.store(target.provider, key);
    keyStored(name, target.provider);
    return ["deepagents"];
  }
  await t.agents.store(target.agent, { apiKey: key });
  keyStored(name);
  return [target.agent];
}

/** "YourStack: Use DeepSeek for Claude Code": Claude Code talks to DeepSeek's Anthropic-compatible endpoint. */
export async function useDeepSeekForClaudeCode(t: KeyTargets): Promise<string[] | undefined> {
  const key = await t.prompts.input({ title: "DeepSeek API key for Claude Code", prompt: `Claude Code will use ${DEEPSEEK_ANTHROPIC_URL}`, password: true, ignoreFocusOut: true });
  if (!key) return undefined;
  await t.agents.store("claude-code", { apiKey: key, baseUrl: DEEPSEEK_ANTHROPIC_URL });
  keyStored("Claude Code (DeepSeek)");
  return ["claude-code"];
}

/** "YourStack: Add custom provider": adds an OpenAI-compatible entry to yourstack.customProviders and stores its key. */
export async function addCustomProvider(t: KeyTargets): Promise<string[] | undefined> {
  const existing = settings().get<unknown[]>("customProviders") ?? [];
  const id = await t.prompts.input({ title: "Custom provider id", prompt: "Lowercase letters, digits, or dashes, e.g. openrouter", ignoreFocusOut: true });
  if (!id) return undefined;
  const label = await t.prompts.input({ title: "Display name (optional)", value: id, ignoreFocusOut: true });
  if (label === undefined) return undefined;
  const baseUrl = await t.prompts.input({ title: `Base URL for ${id}`, prompt: "OpenAI-compatible endpoint, e.g. https://openrouter.ai/api/v1", ignoreFocusOut: true });
  if (!baseUrl) return undefined;
  const model = await t.prompts.input({ title: `Model id for ${id}`, ignoreFocusOut: true });
  if (!model) return undefined;
  const entry = { id: id.trim(), label: label.trim() || id.trim(), baseUrl: baseUrl.trim(), model: model.trim() };
  const parsed = customProviders([...existing, entry]);
  if ("error" in parsed) throw new Error(parsed.error);
  const provider: ProviderId = `custom:${entry.id}`;
  const key = await t.prompts.input({ title: `API key for ${provider}`, password: true, ignoreFocusOut: true });
  if (!key) return undefined;
  await t.keys.store(provider, key);
  await settings().update("customProviders", [...existing, entry], vscode.ConfigurationTarget.Global);
  if (await t.prompts.confirm(`Use ${entry.label} for Deep Agents now?`, `Sets yourstack.provider to ${provider}.`, "Use it")) {
    await settings().update("provider", provider, vscode.ConfigurationTarget.Global);
  }
  return ["deepagents"];
}
