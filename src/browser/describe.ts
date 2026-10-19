// kernl's browser tools in plain words, for approval cards and tool rows: "Open developers.brevo.com in
// kernl's browser" rather than "Use tool browser_navigate" and its JSON.

export interface BrowserCall {
  /** What it does: "open", "click", "type into", "read the page", "take a screenshot". */
  verb: string;
  /** What it acts on, short: a URL's host, or a CSS selector; undefined until the agent has sent it. */
  target?: string;
  /** Said instead of the target while it isn't known ("a page"), so a row never reads "open" alone. */
  stand?: string;
  /** The exact thing being approved: the full URL, the selector, the text typed. */
  detail: string;
}

const hostOf = (url: string) => {
  try {
    return new URL(url).host || url;
  } catch {
    return url;
  }
};

/** A browser tool call described, from the tool's name in any form (`browser_navigate`, `mcp__kernl__browser_navigate`); undefined for other tools. */
export function describeBrowserCall(tool: string | undefined, args: unknown): BrowserCall | undefined {
  const name = /browser_(navigate|click|type|read_page|screenshot)$/.exec(tool ?? "")?.[1];
  const a = (args && typeof args === "object" ? args : {}) as Record<string, unknown>;
  const str = (v: unknown) => (typeof v === "string" ? v : "");
  switch (name) {
    case "navigate":
      return { verb: "open", target: hostOf(str(a.url)) || undefined, stand: "a page", detail: str(a.url) };
    case "click":
      return { verb: "click", target: str(a.selector) || undefined, stand: "an element", detail: str(a.selector) };
    case "type":
      return { verb: "type into", target: str(a.selector) || undefined, stand: "a field", detail: `${str(a.selector)}\n${str(a.text)}` };
    case "read_page":
      return { verb: "read the page", detail: "The page's URL, title, and visible text" };
    case "screenshot":
      return { verb: "take a screenshot", detail: "A PNG of the current page" };
    default:
      return undefined;
  }
}

const phrase = (c: BrowserCall) => [c.verb, c.target ?? c.stand].filter(Boolean).join(" ");

/** The approval card's title: "Open developers.brevo.com in kernl's browser". */
export const browserCardTitle = (c: BrowserCall) => `${phrase(c)[0].toUpperCase()}${phrase(c).slice(1)} in kernl's browser`;

/** A tool row's title: "Browser: open developers.brevo.com". */
export const browserRowTitle = (c: BrowserCall) => `Browser: ${phrase(c)}`;
