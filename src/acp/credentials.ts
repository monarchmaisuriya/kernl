import { join } from "node:path";
import type { Redactor } from "../log";
import type { Secrets } from "../providers/keys";
import { CLI_AGENT_IDS, type CliAgentId } from "./agents";

/** An API key (and optional endpoint) a CLI agent uses instead of its own login. */
export interface AgentCredential {
  apiKey: string;
  baseUrl?: string;
}

/**
 * The environment variables each key-capable agent reads. OpenCode keeps providers in its own config.
 * `configDir` points the agent at a folder kernl owns: a logged-in Claude Code sends its login
 * credential instead of ANTHROPIC_API_KEY (seen with Claude Code 2.1.299), so with a stored key it
 * must not see the user's login at all.
 */
export const CREDENTIAL_ENV: Partial<Record<CliAgentId, { apiKey: string; baseUrl?: string; configDir?: string }>> = {
  "claude-code": { apiKey: "ANTHROPIC_API_KEY", baseUrl: "ANTHROPIC_BASE_URL", configDir: "CLAUDE_CONFIG_DIR" },
  codex: { apiKey: "CODEX_API_KEY" },
};

/** DeepSeek's Anthropic-compatible endpoint, for running Claude Code on a DeepSeek key. */
export const DEEPSEEK_ANTHROPIC_URL = "https://api.deepseek.com/anthropic";

const keyName = (id: CliAgentId) => `kernl.agentKey.${id}`;
const baseUrlName = (id: CliAgentId) => `kernl.agentBaseUrl.${id}`;

/**
 * The launch environment for a stored credential; empty without one, so the agent keeps its own login.
 * `isolatedConfigRoot` holds one config folder per agent (`<root>/<agent id>`), used only with a stored key.
 */
export function credentialEnv(id: CliAgentId, credential: AgentCredential | undefined, isolatedConfigRoot: string): Record<string, string> {
  const vars = CREDENTIAL_ENV[id];
  if (!vars || !credential) return {};
  const env: Record<string, string> = { [vars.apiKey]: credential.apiKey };
  if (vars.baseUrl && credential.baseUrl) env[vars.baseUrl] = credential.baseUrl;
  if (vars.configDir) env[vars.configDir] = join(isolatedConfigRoot, id);
  return env;
}

/** Per-agent credentials, only in SecretStorage. Every key read or stored is registered with the redactor. */
export class AgentCredentials {
  constructor(private secrets: Secrets, private redactor: Redactor) {}

  async get(id: CliAgentId): Promise<AgentCredential | undefined> {
    const apiKey = await this.secrets.get(keyName(id));
    if (!apiKey) return undefined;
    this.redactor.register(apiKey);
    const baseUrl = await this.secrets.get(baseUrlName(id));
    return baseUrl ? { apiKey, baseUrl } : { apiKey };
  }

  /** Stores the key and endpoint together; no baseUrl means the agent's default endpoint. */
  async store(id: CliAgentId, credential: AgentCredential): Promise<void> {
    if (!CREDENTIAL_ENV[id]) throw new Error(`${id} does not take an API key from kernl; configure it in its own settings.`);
    const apiKey = credential.apiKey.trim();
    if (!apiKey) throw new Error(`Expected a non-empty API key for ${id}`);
    const baseUrl = credential.baseUrl?.trim();
    if (baseUrl && !/^https?:\/\//.test(baseUrl)) throw new Error(`Expected an http(s) base URL for ${id}, got '${baseUrl}'`);
    this.redactor.register(apiKey);
    await this.secrets.store(keyName(id), apiKey);
    if (baseUrl) await this.secrets.store(baseUrlName(id), baseUrl);
    else await this.secrets.delete(baseUrlName(id));
  }

  async remove(id: CliAgentId): Promise<void> {
    this.redactor.forget(await this.secrets.get(keyName(id)));
    await this.secrets.delete(keyName(id));
    await this.secrets.delete(baseUrlName(id));
  }

  async clearAll(): Promise<void> {
    for (const id of CLI_AGENT_IDS) {
      this.redactor.forget(await this.secrets.get(keyName(id)));
      await this.secrets.delete(keyName(id));
      await this.secrets.delete(baseUrlName(id));
    }
  }
}
