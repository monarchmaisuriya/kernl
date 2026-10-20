// The page as an agent should see it: an outline of headings, text, and the elements a person can act
// on, from the browser's accessibility tree (what a screen reader reads), each actionable element with
// a ref (e1, e2...) the browser tools take instead of a guessed CSS selector. As Playwright MCP and VS
// Code's own browser tools do.

/** One node of CDP's Accessibility.getFullAXTree. */
export interface AxNode {
  nodeId: string;
  ignored?: boolean;
  role?: { value?: string };
  name?: { value?: string };
  value?: { value?: unknown };
  properties?: { name: string; value?: { value?: unknown } }[];
  childIds?: string[];
  parentId?: string;
  backendDOMNodeId?: number;
}

export interface Snapshot {
  /** The outline for the agent, with the page's URL and title first. */
  text: string;
  /** ref -> the element (the page's node id, role, and name), for the actions and their approval cards. */
  refs: Map<string, { backendNodeId: number; role: string; name: string }>;
}

/** Elements a person acts on: each gets a ref. */
const ACTIONABLE = new Set(["button", "link", "textbox", "searchbox", "combobox", "checkbox", "radio", "switch", "tab", "menuitem", "menuitemcheckbox", "menuitemradio", "option", "slider", "spinbutton", "listbox", "treeitem"]);
/** Structure worth showing even without being actionable. */
const SHOWN = new Set(["heading", "img", "list", "listitem", "navigation", "main", "banner", "contentinfo", "dialog", "alertdialog", "alert", "form", "region", "table", "row", "cell", "columnheader", "rowheader", "paragraph", "status"]);
/** Lines and characters of outline an agent gets. */
const MAX_LINES = 800;
const MAX_CHARS = 25_000;

/** A fresh numbering (e1, e2...), for one snapshot on its own. */
export function newRefs(): (backendNodeId: number) => string {
  const refs = new Map<number, string>();
  return (id) => refs.get(id) ?? (refs.set(id, `e${refs.size + 1}`), refs.get(id)!);
}

/** A frame inside the page: its tree, or none when kernl can't read it (a frame from another site). */
export interface FrameTree {
  url: string;
  nodes?: readonly AxNode[];
}

/**
 * `refOf` names an element by its page node. The browser passes one that keeps an element's ref across
 * snapshots and never gives a ref to another element, so an approved ref still means the approved element.
 * `frames`: the page's frames, each outlined after the page under its address.
 */
export function outline(nodes: readonly AxNode[], page: { href: string; title: string }, refOf: (backendNodeId: number) => string = newRefs(), frames: readonly FrameTree[] = []): Snapshot {
  const refs: Snapshot["refs"] = new Map();
  const lines: string[] = [];
  let truncated = false;
  const prop = (n: AxNode, name: string) => n.properties?.find((p) => p.name === name)?.value?.value;

  const visit = (byId: Map<string, AxNode>, n: AxNode | undefined, depth: number) => {
    if (!n || truncated) return;
    const role = n.role?.value ?? "";
    const name = String(n.name?.value ?? "").replace(/\s+/g, " ").trim();
    let shown = false;
    if (!n.ignored) {
      if (role === "StaticText") {
        if (name) (lines.push(`${"  ".repeat(depth)}- text: ${name}`), (shown = true));
      } else if (ACTIONABLE.has(role) || (SHOWN.has(role) && (name || ["list", "table", "dialog", "form", "navigation", "main"].includes(role)))) {
        const bits = [`- ${role}`];
        if (name) bits.push(JSON.stringify(name));
        const level = prop(n, "level");
        if (role === "heading" && level) bits.push(`level=${level}`);
        const value = n.value?.value;
        if (value !== undefined && value !== "" && value !== name) bits.push(`value=${JSON.stringify(String(value))}`);
        for (const flag of ["checked", "pressed", "selected", "expanded"]) {
          const v = prop(n, flag);
          if (v !== undefined && v !== "false" && v !== false) bits.push(`${flag}${v === true || v === "true" ? "" : `=${v}`}`);
        }
        if (prop(n, "disabled") === true) bits.push("disabled");
        if (ACTIONABLE.has(role) && n.backendDOMNodeId !== undefined) {
          const ref = refOf(n.backendDOMNodeId);
          refs.set(ref, { backendNodeId: n.backendDOMNodeId, role, name });
          bits.push(`[ref=${ref}]`);
        }
        lines.push(`${"  ".repeat(depth)}${bits.join(" ")}`);
        shown = true;
      }
    }
    if (lines.length >= MAX_LINES) truncated = true;
    // Text inside a named element (a button's label) repeats its name: skipped.
    if (shown && ACTIONABLE.has(role)) return;
    for (const id of n.childIds ?? []) visit(byId, byId.get(id), shown ? depth + 1 : depth);
  };
  const tree = (treeNodes: readonly AxNode[], depth: number) => visit(new Map(treeNodes.map((n) => [n.nodeId, n])), treeNodes.find((n) => !n.parentId) ?? treeNodes[0], depth);
  tree(nodes, 0);
  for (const f of frames) {
    if (truncated) break;
    lines.push(`- frame ${JSON.stringify(f.url)}${f.nodes?.length ? "" : " (from another site: kernl can't read inside it)"}`);
    if (f.nodes?.length) tree(f.nodes, 1);
  }

  let body = lines.join("\n");
  if (body.length > MAX_CHARS) (body = body.slice(0, MAX_CHARS)), (truncated = true);
  const head = `url: ${page.href}\ntitle: ${page.title}`;
  const tail = truncated ? "\n[the page is long: the outline was cut; scroll and take another snapshot for the rest]" : "";
  return { text: `${head}\n\n${body || "(nothing on the page)"}${tail}`, refs };
}
