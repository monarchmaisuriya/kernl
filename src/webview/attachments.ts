// The composer's context. Files and folders are mentions inside the message text (`@src/app.ts`,
// `@docs/`), drawn highlighted by a layer behind the textarea, so editing stays the browser's own;
// conversations, issues, and pull requests are chips above (they're content, not paths). "@"
// searches workspace paths, "/" names a skill, and the file open in the editor is offered as a
// suggestion. Everything is built with createElement/textContent; the host checks every path.
import type { Attachment, PanelToHost, SkillView } from "../ui/protocol";
import { icon } from "./icons";

function el<K extends keyof HTMLElementTagNameMap>(tag: K, className?: string, text?: string): HTMLElementTagNameMap[K] {
  const node = document.createElement(tag);
  if (className) node.className = className;
  if (text !== undefined) node.textContent = text;
  return node;
}

type Suggestion = { label: string; detail?: string; choose: () => void };

const AT_QUERY = /(^|\s)@([^\s@]*)$/;
const SLASH_QUERY = /^\/([\w-]*)$/;
const escape = (s: string) => s.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");

/** How a file or folder appears in the text: `@path`, `@folder/`, or `@"path with spaces"`. */
export function mentionText(a: Attachment): string {
  const path = a.kind === "folder" ? `${a.path.replace(/\/$/, "")}/` : a.path;
  return /\s/.test(path) ? `@"${path}"` : `@${path}`;
}

/** A small type badge for a file name: "TS", "PY", "JSON"... */
const badge = (path: string) => (path.includes(".") ? path.split(".").pop()!.slice(0, 4).toUpperCase() : "");

export function attachmentChip(a: Attachment, onRemove?: () => void): HTMLElement {
  const chip = el("span", "attachment");
  chip.title = a.kind === "folder" ? `${a.path}/ (folder)` : a.path;
  const name = a.kind === "text" ? a.path : a.path.split("/").pop() || a.path;
  chip.append(icon(a.kind === "folder" ? "folder" : a.kind === "text" ? "sparkle" : "file", 13), el("span", "chip-text", name));
  if (onRemove) {
    const remove = el("button", "attachment-remove");
    remove.setAttribute("aria-label", `Remove ${a.path}`);
    remove.title = `Remove ${a.path}`;
    remove.append(icon("close", 12));
    remove.addEventListener("click", onRemove);
    chip.append(remove);
  }
  return chip;
}

export function createAttachments(input: HTMLTextAreaElement, send: (m: PanelToHost) => void, changed: () => void) {
  const chips = el("div", "attachments");
  const layer = el("div", "input-layer");
  layer.setAttribute("aria-hidden", "true");
  const suggestion = el("button", "suggest-file");
  const popover = el("div", "popover");
  popover.setAttribute("role", "listbox");
  popover.hidden = true;
  /** Picked files and folders by their text in the message; only these highlight and attach. */
  const known = new Map<string, Attachment>();
  let texts: Attachment[] = [];
  let skills: SkillView[] = [];
  let suggestions: Suggestion[] = [];
  let selected = 0;
  let lastQuery: string | undefined;
  let searchTimer: ReturnType<typeof setTimeout> | undefined;
  let activeFile: string | undefined;

  /** Known mentions present in the text as whole tokens (followed by whitespace or the end). */
  function present(): string[] {
    return [...known.keys()].filter((t) => new RegExp(`${escape(t)}(?=\\s|$)`).test(input.value));
  }

  /** Redraws the text behind the textarea, with mentions highlighted. */
  function refresh() {
    const tokens = [...known.keys()].sort((a, b) => b.length - a.length);
    const parts: Node[] = [];
    const value = input.value;
    if (tokens.length) {
      const re = new RegExp(`(${tokens.map(escape).join("|")})(?=\\s|$)`, "g");
      let last = 0;
      for (const m of value.matchAll(re)) {
        if (m.index! > last) parts.push(document.createTextNode(value.slice(last, m.index)));
        parts.push(el("span", "mention", m[0]));
        last = m.index! + m[0].length;
      }
      parts.push(document.createTextNode(value.slice(last)));
    } else parts.push(document.createTextNode(value));
    // A trailing newline needs a character after it to take up a line, as it does in the textarea.
    if (value.endsWith("\n")) parts.push(document.createTextNode(" "));
    layer.replaceChildren(...parts);
    layer.scrollTop = input.scrollTop;
    renderSuggestion();
  }

  function renderChips() {
    chips.replaceChildren(...texts.map((a) => attachmentChip(a, () => ((texts = texts.filter((x) => x !== a)), renderChips(), changed()))));
    chips.hidden = texts.length === 0;
  }

  function renderSuggestion() {
    const show = !!activeFile && !present().includes(mentionText({ path: activeFile, kind: "file" }));
    suggestion.hidden = !show;
    if (!show) return;
    const name = activeFile!.split("/").pop()!;
    suggestion.replaceChildren(icon("plus", 12), el("span", "file-badge", badge(name)), el("span", "chip-text", name));
    suggestion.title = `Add ${activeFile} (open in the editor)`;
    suggestion.setAttribute("aria-label", `Add the open file ${activeFile}`);
  }

  /** Puts `@path ` at the caret, with a space before it when needed. */
  function insertMention(a: Attachment) {
    const token = remember(a);
    const caret = input.selectionStart ?? input.value.length;
    const before = input.value.slice(0, caret);
    const lead = before && !/\s$/.test(before) ? " " : "";
    const text = `${before}${lead}${token} `;
    input.value = text + input.value.slice(caret);
    input.selectionStart = input.selectionEnd = text.length;
  }

  /** Marks `@path` as a mention of `a`; returns the token. */
  function remember(a: Attachment): string {
    const token = mentionText(a);
    known.set(token, { path: a.path.replace(/\/$/, ""), kind: a.kind });
    return token;
  }

  function add(next: Attachment[]) {
    for (const a of next) {
      if (a.kind === "text") {
        if (!texts.some((x) => x.path === a.path)) texts.push(a);
      } else if (new RegExp(`${escape(mentionText(a))}(?=\\s|$)`).test(input.value)) remember(a); // already in the text (a message put back): just mark it
      else insertMention(a);
    }
    renderChips();
    refresh();
    changed();
  }

  function close() {
    popover.hidden = true;
    suggestions = [];
    lastQuery = undefined;
  }

  function show(list: Suggestion[]) {
    suggestions = list;
    selected = 0;
    popover.replaceChildren(
      ...list.map((s, i) => {
        const row = el("div", i === selected ? "suggestion selected" : "suggestion");
        row.setAttribute("role", "option");
        row.append(el("span", "suggestion-label", s.label));
        if (s.detail) row.append(el("span", "suggestion-detail", s.detail));
        row.addEventListener("mousedown", (e) => (e.preventDefault(), s.choose()));
        return row;
      }),
    );
    popover.hidden = list.length === 0;
  }

  function move(delta: number) {
    if (!suggestions.length) return;
    selected = (selected + delta + suggestions.length) % suggestions.length;
    [...popover.children].forEach((row, i) => row.classList.toggle("selected", i === selected));
  }

  /** Removes the trigger text before the caret ("@que", "/na"), or replaces it. */
  function replaceTrigger(pattern: RegExp, replacement: string) {
    const caret = input.selectionStart ?? input.value.length;
    const before = input.value.slice(0, caret).replace(pattern, (_m, lead = "") => (pattern === AT_QUERY ? lead : "") + replacement);
    input.value = before + input.value.slice(caret);
    input.selectionStart = input.selectionEnd = before.length;
  }

  /** Called on every input event: opens, updates, or closes the popover, and redraws mentions. */
  function onInput(skillsApply: boolean) {
    refresh();
    const beforeCaret = input.value.slice(0, input.selectionStart ?? input.value.length);
    const at = AT_QUERY.exec(beforeCaret);
    if (at) {
      const query = at[2];
      lastQuery = query;
      clearTimeout(searchTimer);
      searchTimer = setTimeout(() => send({ type: "searchFiles", query }), 120);
      return;
    }
    const slash = skillsApply ? SLASH_QUERY.exec(beforeCaret) : null;
    if (slash) {
      const matching = skills.filter((s) => s.name.startsWith(slash[1]));
      return show(matching.map((s) => ({ label: `/${s.name}`, detail: s.description, choose: () => (replaceTrigger(SLASH_QUERY, `/${s.name} `), close(), refresh(), changed()) })));
    }
    close();
  }

  function onFileMatches(query: string, matches: Attachment[]) {
    if (query !== lastQuery) return; // a newer keystroke is on its way
    show(
      matches.map((a) => ({
        label: a.kind === "folder" ? `${a.path}/` : a.path,
        detail: a.kind === "folder" ? "folder" : undefined,
        choose: () => (replaceTrigger(AT_QUERY, ""), insertMention(a), close(), refresh(), changed()),
      })),
    );
  }

  /** Backspace right after a mention removes all of it. True when the key was used here. */
  function deleteMention(e: KeyboardEvent): boolean {
    if (e.key !== "Backspace" || input.selectionStart !== input.selectionEnd) return false;
    const caret = input.selectionStart ?? 0;
    const before = input.value.slice(0, caret);
    for (const token of known.keys()) {
      for (const candidate of [token, `${token} `]) {
        if (!before.endsWith(candidate)) continue;
        const start = caret - candidate.length;
        if (start > 0 && !/\s/.test(before[start - 1])) continue;
        e.preventDefault();
        input.value = input.value.slice(0, start) + input.value.slice(caret);
        input.selectionStart = input.selectionEnd = start;
        refresh();
        changed();
        return true;
      }
    }
    return false;
  }

  /** True when the key was used by the popover or mention editing (so Enter doesn't also send). */
  function onKeydown(e: KeyboardEvent): boolean {
    if (popover.hidden) return deleteMention(e);
    if (e.key === "ArrowDown" || e.key === "ArrowUp") return e.preventDefault(), move(e.key === "ArrowDown" ? 1 : -1), true;
    if (e.key === "Enter" || e.key === "Tab") return e.preventDefault(), suggestions[selected]?.choose(), true;
    if (e.key === "Escape") return e.preventDefault(), close(), true;
    return false;
  }

  /** Files dragged from the Explorer or the OS arrive as a URI list; the host checks and resolves them. */
  function onDrop(e: DragEvent) {
    const data = e.dataTransfer?.getData("application/vnd.code.uri-list") || e.dataTransfer?.getData("text/uri-list") || "";
    const uris = data.split(/\r?\n/).map((u) => u.trim()).filter((u) => u && !u.startsWith("#"));
    if (!uris.length) return;
    e.preventDefault();
    send({ type: "dropUris", uris });
  }

  suggestion.addEventListener("click", () => activeFile && (add([{ path: activeFile, kind: "file" }]), input.focus()));
  input.addEventListener("scroll", () => (layer.scrollTop = input.scrollTop));
  renderChips();
  refresh();
  return {
    chips,
    layer,
    suggestion,
    popover,
    add,
    refresh,
    onInput,
    onKeydown,
    onFileMatches,
    onDrop,
    setSkills: (next: SkillView[]) => (skills = next),
    /** The workspace file open in the editor (offered as a suggestion), or undefined. */
    setActiveFile(path: string | undefined) {
      activeFile = path;
      renderSuggestion();
    },
    /** The attachments to send (mentions still in the text, then text chips), and clears them. */
    take(): Attachment[] {
      const out = [...present().map((t) => known.get(t)!), ...texts];
      known.clear();
      texts = [];
      renderChips();
      close();
      return out;
    },
  };
}
