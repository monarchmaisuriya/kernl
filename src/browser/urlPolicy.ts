/**
 * Which URLs the agent may open in the integrated browser. Web pages only: file: URLs would let
 * one navigation read any local file (including credentials) outside the workspace's read rules.
 */
export function assertNavigableUrl(url: string): void {
  let parsed: URL;
  try {
    parsed = new URL(url);
  } catch {
    throw new Error(`Expected an absolute http(s) URL, got '${url}'`);
  }
  if (!["http:", "https:", "about:"].includes(parsed.protocol)) {
    throw new Error(`Only http(s) and about: URLs can be opened in the browser, got '${parsed.protocol}' in '${url}'`);
  }
}
