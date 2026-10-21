import type * as vscode from "vscode";
import type { Redactor } from "../log";
import { BUILT_IN_PROVIDERS, customProviders, isProviderId, type ProviderAuth, type ProviderId } from "./registry";

/** `kernl.apiKey.anthropic`, and `kernl.apiKey.custom.<id>` for custom providers. */
export const secretName = (provider: ProviderId) => `kernl.apiKey.${provider.replace(":", ".")}`;
/** `kernl.header.custom.<id>.<header name>`: the value of a custom provider's secret header. */
export const headerSecretName = (provider: ProviderId, header: string) => `kernl.header.${provider.replace(":", ".")}.${header.toLowerCase()}`;
// The names of every provider key ever stored. SecretStorage.keys() can omit a key stored a moment ago
// (seen in VS Code 1.142), so Clear reads this index instead.
const INDEX = "kernl.apiKeyIndex";

export type Secrets = Pick<vscode.SecretStorage, "get" | "store" | "delete">;

/** Provider API keys and secret header values live only in VS Code SecretStorage. Every value read or stored is registered with the redactor. */
export class KeyStore {
  constructor(private secrets: Secrets, private redactor: Redactor) {}

  async get(provider: ProviderId): Promise<string | undefined> {
    return this.read(secretName(provider));
  }

  async store(provider: ProviderId, key: string): Promise<void> {
    await this.write(secretName(provider), key, `Expected a non-empty API key for ${provider}`);
  }

  /** What a provider's requests carry from SecretStorage: its key and, for a custom provider, its secret headers' values. */
  async auth(provider: string, rawCustomProviders: unknown): Promise<ProviderAuth> {
    if (!isProviderId(provider)) return {};
    const custom = customProviders(rawCustomProviders);
    const entry = "error" in custom ? undefined : custom.find((c) => `custom:${c.id}` === provider);
    return { apiKey: await this.get(provider), secretHeaders: entry ? await this.headers(provider, entry.secretHeaders) : {} };
  }

  /** The stored values of a provider's secret headers, by header name; a header without a value is left out. */
  async headers(provider: ProviderId, names: readonly string[]): Promise<Record<string, string>> {
    const out: Record<string, string> = {};
    for (const name of names) {
      const value = await this.read(headerSecretName(provider, name));
      if (value) out[name] = value;
    }
    return out;
  }

  async storeHeader(provider: ProviderId, name: string, value: string): Promise<void> {
    await this.write(headerSecretName(provider, name), value, `Expected a non-empty value for ${provider}'s header ${name}`);
  }

  private async read(name: string): Promise<string | undefined> {
    const value = await this.secrets.get(name);
    this.redactor.register(value);
    return value;
  }

  private async write(name: string, value: string, emptyError: string): Promise<void> {
    const trimmed = value.trim();
    if (!trimmed) throw new Error(emptyError);
    this.redactor.register(trimmed);
    const index = await this.index();
    if (!index.includes(name)) await this.secrets.store(INDEX, JSON.stringify([...index, name]));
    await this.secrets.store(name, trimmed);
  }

  async remove(provider: ProviderId): Promise<void> {
    const name = secretName(provider);
    this.redactor.forget(await this.secrets.get(name));
    await this.secrets.delete(name);
    const index = await this.index();
    if (index.includes(name)) await this.secrets.store(INDEX, JSON.stringify(index.filter((n) => n !== name)));
  }

  /** Reads every stored provider key and secret header value into the redactor (so an export can scrub them all); nothing is returned. */
  async registerAll(): Promise<void> {
    for (const name of await this.storedNames()) await this.read(name);
  }

  /** Removes every provider key and secret header value, including those of custom providers no longer in settings. */
  async clearAll(): Promise<void> {
    for (const name of await this.storedNames()) {
      this.redactor.forget(await this.secrets.get(name));
      await this.secrets.delete(name);
    }
    await this.secrets.delete(INDEX);
  }

  /** Every name a provider key or header value may be stored under; built-in names too: keys stored before the index existed are not in it. */
  private async storedNames(): Promise<Set<string>> {
    return new Set([...BUILT_IN_PROVIDERS.map(secretName), ...(await this.index())]);
  }

  private async index(): Promise<string[]> {
    const raw = await this.secrets.get(INDEX);
    return raw ? JSON.parse(raw) : [];
  }
}
