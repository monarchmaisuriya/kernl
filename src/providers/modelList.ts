// The models a provider offers, for the model picker: asked of the same models-list endpoint the key
// check uses (with the provider's key and custom headers). Lists are cached for 10 minutes; a failure
// isn't cached, and anything but a readable list means "type the model id instead".
import type { KeyRequest } from "../connections/keyCheck";

export type ListFetch = (url: string, init: { method: string; headers: Record<string, string>; signal: AbortSignal }) => Promise<{ status: number; json(): Promise<unknown> }>;

const TTL_MS = 10 * 60_000;
const cache = new Map<string, { at: number; ids: string[] }>();

/** Model ids from a models-list response: `data[].id` (OpenAI, Anthropic, DeepSeek, most gateways); Google's `models[]` that can chat. */
export function parseModelList(api: string, body: unknown): string[] {
  const b = body as { data?: { id?: unknown }[]; models?: { name?: unknown; supportedGenerationMethods?: unknown }[] };
  if (api === "google") {
    return (b?.models ?? [])
      .filter((m) => typeof m?.name === "string" && Array.isArray(m.supportedGenerationMethods) && m.supportedGenerationMethods.includes("generateContent"))
      .map((m) => (m.name as string).replace(/^models\//, ""));
  }
  return (Array.isArray(b?.data) ? b.data : []).map((m) => m?.id).filter((id): id is string => typeof id === "string" && !!id);
}

/** Without these, Anthropic returns 20 models and Google 50. */
const PAGE_SIZE: Record<string, string> = { anthropic: "limit=1000", google: "pageSize=1000" };

/**
 * The provider's model ids, or undefined when it can't list them (no endpoint, refused, unreadable,
 * empty, or no answer within `timeoutMs`). `api` is the provider's API (see providerApi).
 */
export async function listModels(req: KeyRequest, api: string, opts: { fetchImpl?: ListFetch; now?: () => number; timeoutMs?: number } = {}): Promise<string[] | undefined> {
  const now = opts.now ?? Date.now;
  const query = PAGE_SIZE[api];
  const url = query ? `${req.url}${req.url.includes("?") ? "&" : "?"}${query}` : req.url;
  const cached = cache.get(url);
  if (cached && now() - cached.at < TTL_MS) return cached.ids;
  const controller = new AbortController();
  const timer = setTimeout(() => controller.abort(), opts.timeoutMs ?? 10_000);
  try {
    const fetchImpl = opts.fetchImpl ?? (fetch as unknown as ListFetch);
    const res = await fetchImpl(url, { method: "GET", headers: req.headers, signal: controller.signal });
    if (res.status < 200 || res.status >= 300) return undefined;
    const ids = parseModelList(api, await res.json());
    if (!ids.length) return undefined;
    cache.set(url, { at: now(), ids });
    return ids;
  } catch {
    return undefined;
  } finally {
    clearTimeout(timer);
  }
}
