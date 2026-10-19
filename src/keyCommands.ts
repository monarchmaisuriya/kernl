import * as vscode from "vscode";
import { CLI_AGENTS, type CliAgentId } from "./acp/agents";
import { type AgentCredentials, CREDENTIAL_ENV, DEEPSEEK_ANTHROPIC_URL } from "./acp/credentials";
import type { KeyStore } from "./providers/keys";
import { BUILT_IN_PROVIDERS, customProviders, HEADER_NAME, type ProviderId } from "./providers/registry";
import type { Prompts } from "./workspaces/commands";

const settings = () => vscode.workspace.getConfiguration("kernl");

/** Where the key commands store keys. Each command returns the harnesses whose key changed, or undefined if cancelled. */
export interface KeyTargets {
  keys: KeyStore;
  agents: AgentCredentials;
  prompts: Prompts;
}

type Target = { provider: ProviderId; header?: string } | { agent: CliAgentId };

/** Writes kernl.provider and kernl.model where kernl.provider is already set (workspace, else user). */
export async function useProvider(provider: ProviderId, model: string) {
  const target = settings().inspect("provider")?.workspaceValue !== undefined ? vscode.ConfigurationTarget.Workspace : vscode.ConfigurationTarget.Global;
  await settings().update("provider", provider, target);
  await settings().update("model", model.trim(), target);
}

/**
 * Confirms a stored key. For a model provider kernl doesn't use yet, it offers to switch to it
 * (with that provider's default model): a stored key alone doesn't change which provider is used.
 */
export function keyStored(label: string, provider?: ProviderId) {
  const offer = provider && provider !== settings().get<string>("provider") ? `Use ${label} for kernl` : undefined;
  void vscode.window.showInformationMessage(`Key stored for ${label}.`, ...(offer ? [offer] : [])).then(async (choice) => {
    if (offer && choice === offer) await useProvider(provider!, "");
  });
}

/** "kernl: Set API key": pick a Deep Agents provider (built-in or custom), a custom provider's secret header, or a CLI agent; paste the value; store it. */
export async function promptForApiKey(t: KeyTargets, currentProvider: string): Promise<string[] | undefined> {
  const custom = customProviders(settings().get("customProviders"));
  const items: (vscode.QuickPickItem & { target: Target })[] = [
    ...BUILT_IN_PROVIDERS.map((id) => ({ label: id, target: { provider: id as ProviderId }, picked: id === currentProvider })),
    ...("error" in custom ? [] : custom).map((c) => {
      const provider: ProviderId = `custom:${c.id}`;
      return { label: provider, description: `${c.label} (${c.baseUrl})`, target: { provider }, picked: provider === currentProvider };
    }),
    ...("error" in custom ? [] : custom).flatMap((c) =>
      c.secretHeaders.map((header) => ({ label: `custom:${c.id}: ${header}`, description: "secret header", target: { provider: `custom:${c.id}` as ProviderId, header } })),
    ),
    ...(Object.keys(CREDENTIAL_ENV) as CliAgentId[]).map((agent) => ({
      label: `CLI agent: ${CLI_AGENTS[agent].label}`,
      description: `${CREDENTIAL_ENV[agent]!.apiKey}, instead of its own login`,
      target: { agent },
    })),
  ];
  const picked = await t.prompts.pick(items, { title: "kernl: what is this key for?" });
  if (!picked) return undefined;
  const target = picked.target;
  const name = "provider" in target ? target.provider : CLI_AGENTS[target.agent].label;
  const key = await t.prompts.input({ title: "provider" in target && target.header ? `Value for ${name}'s header ${target.header}` : `API key for ${name}`, password: true, ignoreFocusOut: true });
  if (!key) return undefined;
  if ("provider" in target && target.header) {
    await t.keys.storeHeader(target.provider, target.header, key);
    void vscode.window.showInformationMessage(`Header ${target.header} stored for ${name}.`);
    return ["deepagents"];
  }
  if ("provider" in target) {
    await t.keys.store(target.provider, key);
    keyStored(name, target.provider);
    return ["deepagents"];
  }
  await t.agents.store(target.agent, { apiKey: key });
  keyStored(name);
  return [target.agent];
}

/** "kernl: Use DeepSeek for Claude Code": Claude Code talks to DeepSeek's Anthropic-compatible endpoint. */
export async function useDeepSeekForClaudeCode(t: KeyTargets): Promise<string[] | undefined> {
  const key = await t.prompts.input({ title: "DeepSeek API key for Claude Code", prompt: `Claude Code will use ${DEEPSEEK_ANTHROPIC_URL}`, password: true, ignoreFocusOut: true });
  if (!key) return undefined;
  await t.agents.store("claude-code", { apiKey: key, baseUrl: DEEPSEEK_ANTHROPIC_URL });
  keyStored("Claude Code (DeepSeek)");
  return ["claude-code"];
}

/**
 * "kernl: Add custom provider": adds an OpenAI- or Anthropic-compatible entry to kernl.customProviders
 * with optional headers. Secret header values and the key go to SecretStorage; settings get only their names.
 */
export async function addCustomProvider(t: KeyTargets): Promise<string[] | undefined> {
  const existing = settings().get<unknown[]>("customProviders") ?? [];
  const id = await t.prompts.input({ title: "Custom provider id", prompt: "Lowercase letters, digits, or dashes, e.g. openrouter", ignoreFocusOut: true });
  if (!id) return undefined;
  const label = await t.prompts.input({ title: "Display name (optional)", value: id, ignoreFocusOut: true });
  if (label === undefined) return undefined;
  const protocol = await t.prompts.pick(
    [
      { label: "OpenAI API", description: "/chat/completions: OpenRouter, LiteLLM, vLLM, most gateways", protocol: "openai" as const },
      { label: "Anthropic API", description: "/v1/messages: Anthropic-compatible gateways", protocol: "anthropic" as const },
    ],
    { title: `Which API does ${id} speak?`, ignoreFocusOut: true },
  );
  if (!protocol) return undefined;
  const example = protocol.protocol === "openai" ? "https://openrouter.ai/api/v1" : "https://gateway.example.com/anthropic (kernl adds /v1/messages)";
  const baseUrl = await t.prompts.input({ title: `Base URL for ${id}`, prompt: `e.g. ${example}`, ignoreFocusOut: true });
  if (!baseUrl) return undefined;
  const model = await t.prompts.input({ title: `Model id for ${id}`, ignoreFocusOut: true });
  if (!model) return undefined;
  const headers = await askHeaders(t.prompts, id);
  if (!headers) return undefined;
  const entry = {
    id: id.trim(),
    label: label.trim() || id.trim(),
    baseUrl: baseUrl.trim(),
    model: model.trim(),
    protocol: protocol.protocol,
    ...(Object.keys(headers.plain).length ? { headers: headers.plain } : {}),
    ...(Object.keys(headers.secret).length ? { secretHeaders: Object.keys(headers.secret) } : {}),
  };
  const parsed = customProviders([...existing, entry]);
  if ("error" in parsed) throw new Error(parsed.error);
  const provider: ProviderId = `custom:${entry.id}`;
  const headerAuth = Object.keys(headers.secret).length > 0;
  const key = await t.prompts.input({
    title: `API key for ${provider}`,
    prompt: headerAuth ? "Optional: leave empty when your secret header authenticates" : undefined,
    password: true,
    ignoreFocusOut: true,
    validateInput: (v) => (headerAuth || v.trim() ? undefined : "An API key is needed (or add a secret header that authenticates)."),
  });
  if (key === undefined) return undefined;
  if (key.trim()) await t.keys.store(provider, key);
  for (const [name, value] of Object.entries(headers.secret)) await t.keys.storeHeader(provider, name, value);
  await settings().update("customProviders", [...existing, entry], vscode.ConfigurationTarget.Global);
  if (await t.prompts.confirm(`Use ${entry.label} for Deep Agents now?`, `Sets kernl.provider to ${provider}.`, "Use it")) {
    await settings().update("provider", provider, vscode.ConfigurationTarget.Global);
  }
  return ["deepagents"];
}

/** Asks for headers one at a time, each secret (value for SecretStorage) or not (value for settings); undefined if cancelled. */
async function askHeaders(prompts: Prompts, id: string): Promise<{ plain: Record<string, string>; secret: Record<string, string> } | undefined> {
  const plain: Record<string, string> = {};
  const secret: Record<string, string> = {};
  const names = () => [...Object.keys(plain), ...Object.keys(secret)].map((n) => n.toLowerCase());
  for (;;) {
    const any = names().length > 0;
    const choice = await prompts.pick(
      [
        { label: any ? "Done adding headers" : "No custom headers", adds: "none" as const },
        { label: "Add a secret header", description: "an auth token: its value stays in VS Code's secret storage", adds: "secret" as const },
        { label: "Add a header", description: "not secret: its value is written to settings", adds: "plain" as const },
      ],
      { title: `Headers for ${id}${any ? ` (${names().length} added)` : ""}`, ignoreFocusOut: true },
    );
    if (!choice) return undefined;
    if (choice.adds === "none") return { plain, secret };
    const name = await prompts.input({
      title: "Header name",
      prompt: "e.g. X-Api-Token or Authorization",
      ignoreFocusOut: true,
      validateInput: (v) => (!HEADER_NAME.test(v.trim()) ? "Expected a header name: letters, digits, and - _ . (no spaces or colons)." : names().includes(v.trim().toLowerCase()) ? "That header is already added." : undefined),
    });
    if (!name) return undefined;
    const value = await prompts.input({ title: `Value for ${name.trim()}`, password: choice.adds === "secret", ignoreFocusOut: true, validateInput: (v) => (v.trim() ? undefined : "Expected a value.") });
    if (!value) return undefined;
    (choice.adds === "secret" ? secret : plain)[name.trim()] = value.trim();
  }
}
