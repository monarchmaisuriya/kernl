import type * as vscode from "vscode";
import type { Redactor } from "../log";
import { BUILT_IN_PROVIDERS, type ProviderId } from "./registry";

/** `kernl.apiKey.anthropic`, and `kernl.apiKey.custom.<id>` for custom providers. */
export const secretName = (provider: ProviderId) => `kernl.apiKey.${provider.replace(":", ".")}`;
// The names of every provider key ever stored. SecretStorage.keys() can omit a key stored a moment ago
// (seen in VS Code 1.142), so Clear reads this index instead.
const INDEX = "kernl.apiKeyIndex";

export type Secrets = Pick<vscode.SecretStorage, "get" | "store" | "delete">;

/** Provider API keys live only in VS Code SecretStorage. Every key read or stored is registered with the redactor. */
export class KeyStore {
  constructor(private secrets: Secrets, private redactor: Redactor) {}

  async get(provider: ProviderId): Promise<string | undefined> {
    const key = await this.secrets.get(secretName(provider));
    this.redactor.register(key);
    return key;
  }

  async store(provider: ProviderId, key: string): Promise<void> {
    const trimmed = key.trim();
    if (!trimmed) throw new Error(`Expected a non-empty API key for ${provider}`);
    this.redactor.register(trimmed);
    const index = await this.index();
    if (!index.includes(secretName(provider))) await this.secrets.store(INDEX, JSON.stringify([...index, secretName(provider)]));
    await this.secrets.store(secretName(provider), trimmed);
  }

  async remove(provider: ProviderId): Promise<void> {
    const name = secretName(provider);
    this.redactor.forget(await this.secrets.get(name));
    await this.secrets.delete(name);
    const index = await this.index();
    if (index.includes(name)) await this.secrets.store(INDEX, JSON.stringify(index.filter((n) => n !== name)));
  }

  /** Removes every provider key, including keys of custom providers no longer in settings. */
  async clearAll(): Promise<void> {
    // Built-in names too: keys stored before the index existed are not in it.
    const names = new Set([...BUILT_IN_PROVIDERS.map(secretName), ...(await this.index())]);
    for (const name of names) {
      this.redactor.forget(await this.secrets.get(name));
      await this.secrets.delete(name);
    }
    await this.secrets.delete(INDEX);
  }

  private async index(): Promise<string[]> {
    const raw = await this.secrets.get(INDEX);
    return raw ? JSON.parse(raw) : [];
  }
}
