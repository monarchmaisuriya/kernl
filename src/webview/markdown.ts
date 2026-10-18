// Markdown for agent replies. `marked` only tokenizes (text in, data out); this file builds every
// element from those tokens with createElement + textContent. Raw HTML in a reply is shown as text,
// images are never loaded, and only http(s) links are clickable.
import { lexer, type Token, type Tokens } from "marked";
import { httpUrl } from "../ui/protocol";
import { highlightInto } from "./highlight";
import { icon } from "./icons";

/** Side effects the rendered reply can request; the host performs them. */
export interface MarkdownActions {
  openLink(url: string): void;
  copy(text: string): void;
}

function el<K extends keyof HTMLElementTagNameMap>(tag: K, className?: string, text?: string): HTMLElementTagNameMap[K] {
  const node = document.createElement(tag);
  if (className) node.className = className;
  if (text !== undefined) node.textContent = text;
  return node;
}

const ENTITIES: Record<string, string> = { amp: "&", lt: "<", gt: ">", quot: '"', apos: "'", nbsp: " " };
/** The lexer leaves character references as written; decode them for display (the result is only ever text). */
function decode(text: string): string {
  return text.replace(/&(#x[0-9a-f]+|#\d+|[a-z]+);/gi, (whole, ref: string) => {
    if (ref[0] !== "#") return ENTITIES[ref.toLowerCase()] ?? whole;
    const code = ref[1] === "x" || ref[1] === "X" ? parseInt(ref.slice(2), 16) : parseInt(ref.slice(1), 10);
    return code > 0 && code <= 0x10ffff ? String.fromCodePoint(code) : whole;
  });
}

/** Renders a reply. Safe for partial text: an unclosed code fence renders as an open code block. */
export function renderMarkdown(text: string, actions: MarkdownActions): DocumentFragment {
  const out = document.createDocumentFragment();
  for (const t of lexer(text)) appendBlock(out, t, actions);
  return out;
}

/**
 * A reply that grows while it streams. Each update re-lexes the whole text (so Markdown context
 * stays correct) but rebuilds DOM only from the first top-level block whose source changed;
 * earlier blocks keep their elements. A block's elements depend only on its source text.
 */
export class MarkdownView {
  private blocks: { raw: string; nodes: Node[] }[] = [];

  constructor(private root: HTMLElement, private actions: MarkdownActions) {}

  update(text: string) {
    const tokens = lexer(text);
    let same = 0;
    while (same < tokens.length && same < this.blocks.length && tokens[same].raw === this.blocks[same].raw) same++;
    for (const stale of this.blocks.splice(same)) for (const node of stale.nodes) node.parentNode?.removeChild(node);
    for (const t of tokens.slice(same)) {
      const fragment = document.createDocumentFragment();
      appendBlock(fragment, t, this.actions);
      this.blocks.push({ raw: t.raw, nodes: [...fragment.childNodes] });
      this.root.appendChild(fragment);
    }
  }
}

function appendBlock(parent: Node, t: Token, actions: MarkdownActions) {
  switch (t.type) {
    case "space":
    case "def":
      return;
    case "paragraph":
      return void parent.appendChild(inline(el("p"), (t as Tokens.Paragraph).tokens, actions));
    case "heading": {
      const h = t as Tokens.Heading;
      return void parent.appendChild(inline(el(`h${Math.min(Math.max(h.depth, 1), 6)}` as "h1"), h.tokens, actions));
    }
    case "code":
      return void parent.appendChild(codeBlock(t as Tokens.Code, actions));
    case "blockquote": {
      const q = el("blockquote");
      for (const child of (t as Tokens.Blockquote).tokens) appendBlock(q, child, actions);
      return void parent.appendChild(q);
    }
    case "list":
      return void parent.appendChild(list(t as Tokens.List, actions));
    case "table":
      return void parent.appendChild(table(t as Tokens.Table, actions));
    case "hr":
      return void parent.appendChild(el("hr"));
    case "checkbox":
      // A task list item's box comes as the item's first block-level child.
      return void inline(parent, [t], actions);
    case "text": {
      // Text directly in a block (tight list items): render its inline tokens.
      const tx = t as Tokens.Text;
      return void (tx.tokens ? inline(parent, tx.tokens, actions) : parent.appendChild(document.createTextNode(decode(tx.text))));
    }
    default:
      // "html" and anything unknown: the source text, literally.
      return void parent.appendChild(el("p", "md-raw", t.raw.trimEnd()));
  }
}

function inline<P extends Node>(parent: P, tokens: Token[] | undefined, actions: MarkdownActions): P {
  for (const t of tokens ?? []) {
    switch (t.type) {
      case "text":
        if ((t as Tokens.Text).tokens) inline(parent, (t as Tokens.Text).tokens, actions);
        else parent.appendChild(document.createTextNode(decode((t as Tokens.Text).text)));
        break;
      case "escape":
        parent.appendChild(document.createTextNode((t as Tokens.Escape).text));
        break;
      case "strong":
        parent.appendChild(inline(el("strong"), (t as Tokens.Strong).tokens, actions));
        break;
      case "em":
        parent.appendChild(inline(el("em"), (t as Tokens.Em).tokens, actions));
        break;
      case "del":
        parent.appendChild(inline(el("del"), (t as Tokens.Del).tokens, actions));
        break;
      case "codespan":
        parent.appendChild(el("code", "", decode((t as Tokens.Codespan).text)));
        break;
      case "br":
        parent.appendChild(el("br"));
        break;
      case "checkbox": {
        const box = el("input");
        box.type = "checkbox";
        box.checked = (t as Tokens.Checkbox).checked;
        box.disabled = true;
        parent.appendChild(box);
        break;
      }
      case "link":
        parent.appendChild(link((t as Tokens.Link).href, (t as Tokens.Link).tokens, actions));
        break;
      case "image": {
        // Never loaded: shown as a link to the image, labeled with its alt text.
        const img = t as Tokens.Image;
        parent.appendChild(link(img.href, [{ type: "text", raw: img.text, text: img.text || img.href }], actions));
        break;
      }
      default:
        // Inline HTML and anything unknown: the source text, literally.
        parent.appendChild(document.createTextNode(t.raw));
    }
  }
  return parent;
}

function link(href: string, tokens: Token[], actions: MarkdownActions): Node {
  const url = httpUrl(href);
  if (!url) return inline(el("span", "md-link-blocked"), tokens, actions);
  const a = inline(el("a"), tokens, actions);
  a.title = url;
  a.setAttribute("role", "link");
  a.tabIndex = 0;
  // No href: the webview never navigates. The host opens the URL in the browser.
  const open = (e: Event) => (e.preventDefault(), actions.openLink(url));
  a.addEventListener("click", open);
  a.addEventListener("keydown", (e) => e.key === "Enter" && open(e));
  return a;
}

function codeBlock(t: Tokens.Code, actions: MarkdownActions): HTMLElement {
  const box = el("div", "md-code");
  const head = el("div", "md-code-head");
  const copy = el("button", "md-copy");
  copy.append(icon("copy", 14));
  copy.setAttribute("aria-label", "Copy code");
  copy.title = "Copy code";
  copy.addEventListener("click", () => actions.copy(t.text));
  head.append(el("span", "md-lang", t.lang || "text"), copy);
  const pre = el("pre");
  const code = el("code");
  highlightInto(code, t.lang, t.text);
  pre.append(code);
  box.append(head, pre);
  return box;
}

function list(t: Tokens.List, actions: MarkdownActions): HTMLElement {
  const node = t.ordered ? el("ol") : el("ul");
  if (t.ordered && typeof t.start === "number" && t.start !== 1) (node as HTMLOListElement).start = t.start;
  for (const item of t.items) {
    const li = el("li", item.task ? "md-task" : undefined);
    for (const child of item.tokens) appendBlock(li, child, actions);
    node.append(li);
  }
  return node;
}

function table(t: Tokens.Table, actions: MarkdownActions): HTMLElement {
  const wrap = el("div", "md-table");
  const thead = el("thead");
  const headRow = el("tr");
  for (const cell of t.header) headRow.append(cellNode("th", cell, actions));
  thead.append(headRow);
  const tbody = el("tbody");
  for (const row of t.rows) {
    const tr = el("tr");
    for (const cell of row) tr.append(cellNode("td", cell, actions));
    tbody.append(tr);
  }
  const tableEl = el("table");
  tableEl.append(thead, tbody);
  wrap.append(tableEl);
  return wrap;
}

function cellNode(tag: "th" | "td", cell: Tokens.TableCell, actions: MarkdownActions): HTMLElement {
  const node = inline(el(tag), cell.tokens, actions);
  if (cell.align) node.classList.add(`md-align-${cell.align}`);
  return node;
}
