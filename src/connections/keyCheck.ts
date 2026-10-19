// Whether a stored API key still works, asked of the provider's model list (`GET /models`): it spends
// no tokens and changes nothing. The key goes in a header, never in the URL. Only a 401 or 403 means
// the key was refused; anything else (404 from a server without the endpoint, a network error) is
// "can't tell", so a check never blocks a key that might work.
import { type CustomProvider, customHeaders, type ProviderAuth, type ProviderId, providerApi } from "../providers/registry";
import type { Parsed } from "./parsers";

export interface KeyRequest {
  url: string;
  headers: Record<string, string>;
}

const trim = (url: string) => url.replace(/\/+$/, "");

/**
 * The models-list request for an API ("anthropic", "openai", ...; a custom provider passes its protocol's,
 * see providerApi) and key. `baseUrl`: for openai-compatible and custom providers, and for an
 * Anthropic-compatible endpoint (a Claude Code key on DeepSeek). `headers`: a custom provider's own,
 * sent as its model requests send them; with them, the key is optional. Undefined when there's nothing
 * to ask (an openai-compatible provider without a URL).
 */
export function keyRequest(api: string, key: string | undefined, baseUrl?: string, headers: Record<string, string | null> = {}): KeyRequest | undefined {
  const own = Object.fromEntries(Object.entries(headers).filter((e): e is [string, string] => e[1] !== null));
  const bearer = { ...(key ? { Authorization: `Bearer ${key}` } : {}), ...own };
  switch (api) {
    case "anthropic":
      return { url: `${trim(baseUrl || "https://api.anthropic.com")}/v1/models`, headers: { ...(key ? { "x-api-key": key } : {}), "anthropic-version": "2023-06-01", ...own } };
    case "openai":
      return { url: "https://api.openai.com/v1/models", headers: bearer };
    case "google":
      return { url: "https://generativelanguage.googleapis.com/v1beta/models", headers: { ...(key ? { "x-goog-api-key": key } : {}), ...own } };
    case "deepseek":
      return { url: "https://api.deepseek.com/models", headers: bearer };
    default:
      return baseUrl ? { url: `${trim(baseUrl)}/models`, headers: bearer } : undefined;
  }
}

/** A provider as its models-list request needs it: `baseUrl` for openai-compatible (kernl.baseUrl) and custom providers; `custom`, the entry. */
export interface ModelsTarget {
  id: ProviderId;
  baseUrl?: string;
  custom?: CustomProvider;
}

/** The models-list request for a provider with its stored credentials: the key check and the model list both send this. */
export function modelsRequest(t: ModelsTarget, auth: ProviderAuth): KeyRequest | undefined {
  if (!t.custom) return keyRequest(t.id, auth.apiKey, t.baseUrl);
  return keyRequest(providerApi({ provider: t.id, custom: t.custom }), auth.apiKey, t.baseUrl, customHeaders(t.custom, auth));
}

export type Fetch = (url: string, init: { method: string; headers: Record<string, string>; signal: AbortSignal }) => Promise<{ status: number }>;

/** Asks the provider; `label` names it in the result ("anthropic", "Claude Code's key"). */
export async function checkKey(req: KeyRequest, label: string, fetchImpl: Fetch = fetch as unknown as Fetch, timeoutMs = 10_000): Promise<Parsed> {
  const controller = new AbortController();
  const timer = setTimeout(() => controller.abort(), timeoutMs);
  try {
    const res = await fetchImpl(req.url, { method: "GET", headers: req.headers, signal: controller.signal });
    if (res.status >= 200 && res.status < 300) return { state: "ready", detail: `${label} accepted the key` };
    if (res.status === 401 || res.status === 403) return { state: "needsAction", detail: `${label} refused the key (HTTP ${res.status})` };
    return { state: "unknown", detail: `Couldn't check the key: ${label} answered HTTP ${res.status}` };
  } catch (err: any) {
    return { state: "unknown", detail: controller.signal.aborted ? `Couldn't check the key: ${label} didn't answer in time` : `Couldn't check the key: ${err?.cause?.code ?? err?.message ?? err}` };
  } finally {
    clearTimeout(timer);
  }
}
