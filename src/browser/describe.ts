// kernl's browser tools in plain words, for approval cards and tool rows: "Open developers.brevo.com in
// kernl's browser" rather than "Use tool browser_navigate" and its JSON.

export interface BrowserCall {
  /** What it does: "open", "click", "type into", "read the page", "take a screenshot". */
  verb: string;
  /** What it acts on, short: a URL's host, an element, a key; undefined until the agent has sent it. */
  target?: string;
  /** Said instead of the target while it isn't known ("a page"), so a row never reads "open" alone. */
  stand?: string;
  /** The exact thing being approved: the full URL, the element and how it's found, the text typed. */
  detail: string;
}

const hostOf = (url: string) => {
  try {
    return new URL(url).host || url;
  } catch {
    return url;
  }
};

/**
 * A browser tool call described, from the tool's name in any form (`browser_navigate`,
 * `mcp__kernl__browser_navigate`); undefined for other tools. An element is named by what it is on the
 * page (`onPage`, added for approval cards from the snapshot), else the agent's words for it, else its
 * selector or ref.
 */
export function describeBrowserCall(tool: string | undefined, args: unknown): BrowserCall | undefined {
  const name = /browser_(navigate|click|type|press_key|back|scroll|snapshot|read_page|screenshot)$/.exec(tool ?? "")?.[1];
  const a = (args && typeof args === "object" ? args : {}) as Record<string, unknown>;
  const str = (v: unknown) => (typeof v === "string" ? v : "");
  const element = str(a.onPage) || str(a.element) || str(a.selector) || str(a.ref) || undefined;
  // What the card shows as approved: the element on the page, the agent's words when they differ, and how it's found.
  const which = [str(a.onPage), str(a.element) && str(a.element) !== str(a.onPage) ? `the agent calls it: ${str(a.element)}` : "", str(a.selector) || (a.ref ? `ref ${str(a.ref)}` : "")].filter(Boolean).join("\n");
  switch (name) {
    case "navigate":
      return { verb: "open", target: hostOf(str(a.url)) || undefined, stand: "a page", detail: str(a.url) };
    case "click":
      return { verb: "click", target: element, stand: "an element", detail: which };
    case "type":
      return { verb: "type into", target: element, stand: "a field", detail: `${which}\n${str(a.text)}${a.submit ? "\n(then Enter)" : ""}` };
    case "press_key":
      return { verb: "press", target: str(a.key) || undefined, stand: "a key", detail: str(a.key) };
    case "back":
      return { verb: "go back", detail: "To the previous page in the tab" };
    case "scroll":
      return { verb: `scroll ${str(a.direction) || "the page"}`, detail: "About a screen" };
    case "snapshot":
      return { verb: "look at the page", detail: "The page's headings, text, buttons, links, and fields" };
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
