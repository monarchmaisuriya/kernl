// The composer's context. Files and folders are mentions inside the message text (`@src/app.ts`,
// `@docs/`), drawn highlighted by a layer behind the textarea, so editing stays the browser's own;
// conversations (threads), issues, and pull requests are chips above (they're content, not paths).
// "@" searches workspace paths and conversations, "/" lists commands and skills, and the file open in the editor
// is offered as a suggestion. Everything is built with createElement/textContent; the host checks every path.
import type { Attachment, PanelToHost } from "../ui/protocol";
import { droppedFiles, isPanelDrop, linkUris, vscodeUris } from "./dropData";
import { icon } from "./icons";

function el<K extends keyof HTMLElementTagNameMap>(tag: K, className?: string, text?: string): HTMLElementTagNameMap[K] {
  const node = document.createElement(tag);
  if (className) node.className = className;
  if (text !== undefined) node.textContent = text;
  return node;
}

type Suggestion = { label: string; detail?: string; choose: () => void };
/** A "/" menu row: `run` runs it when chosen (a kernl command); otherwise its label goes into the text (a skill or an agent's command). */
export type SlashRow = { label: string; detail?: string; run?: () => void };

const AT_QUERY = /(^|\s)@([^\s@]*)$/;
const SLASH_QUERY = /^\/([\w:-]*)$/;
const escape = (s: string) => s.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");

/** How a file or folder appears in the text: `@path`, `@folder/`, or `@"path with spaces"`. */
export function mentionText(a: Attachment): string {
  const path = a.kind === "folder" ? `${a.path.replace(/\/$/, "")}/` : a.path;
  return /\s/.test(path) ? `@"${path}"` : `@${path}`;
}

/** A small type badge for a file name: "TS", "PY", "JSON"... */
const badge = (path: string) => (path.includes(".") ? path.split(".").pop()!.slice(0, 4).toUpperCase() : "");

/** A tagged conversation's agent, workspace, and age, for its popover row and chip: "Claude Code · Develop · 2 h ago". */
export function threadDetail(a: Attachment, now = Date.now()): string {
  if (!a.thread) return "";
  if (!a.thread.updatedAt) return `${a.thread.agent} · ${a.thread.workspace}`;
  const minutes = Math.max(0, Math.round((now - a.thread.updatedAt) / 60_000));
  const ago = minutes < 1 ? "just now" : minutes < 60 ? `${minutes} min ago` : minutes < 48 * 60 ? `${Math.round(minutes / 60)} h ago` : `${Math.round(minutes / 1440)} d ago`;
  return `${a.thread.agent} · ${a.thread.workspace} · ${ago}`;
}

export function attachmentChip(a: Attachment, onRemove?: () => void): HTMLElement {
  const chip = el("span", "attachment");
  chip.title = a.kind === "folder" ? `${a.path}/ (folder)` : a.kind === "thread" ? `Conversation: ${a.path} (${threadDetail(a)})` : a.path;
  const name = a.kind === "text" || a.kind === "thread" ? a.path : a.path.split("/").pop() || a.path;
  chip.append(icon(a.kind === "folder" ? "folder" : a.kind === "thread" ? "chat" : a.kind === "text" ? "kernl" : "file", 13), el("span", "chip-text", name));
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
  // Why a drop attached nothing (or not everything); cleared after a while or when you type.
  const dropNote = el("div", "drop-note");
  dropNote.setAttribute("role", "status");
  dropNote.hidden = true;
  let dropNoteTimer: ReturnType<typeof setTimeout> | undefined;
  function note(text: string) {
    dropNote.textContent = text;
    dropNote.hidden = false;
    clearTimeout(dropNoteTimer);
    dropNoteTimer = setTimeout(() => (dropNote.hidden = true), 8000);
  }
  input.addEventListener("input", () => (dropNote.hidden = true));
  const popover = el("div", "popover");
  popover.setAttribute("role", "listbox");
  popover.hidden = true;
  /** Picked files and folders by their text in the message; only these highlight and attach. */
  const known = new Map<string, Attachment>();
  /** Chips: text (pasted, dropped, an issue) and threads. */
  let texts: Attachment[] = [];
  let slashRows: (query: string) => SlashRow[] = () => [];
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
      if (a.kind === "thread") {
        // The same conversation again: one chip.
        texts = [...texts.filter((x) => x.thread?.id !== a.thread?.id), a];
      } else if (a.kind === "text") {
        // The same label again (a file dropped again after editing it): the newer text replaces the older.
        texts = [...texts.filter((x) => x.path !== a.path), a];
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
  function onInput() {
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
    const slash = SLASH_QUERY.exec(beforeCaret);
    if (slash) {
      const choose = (r: SlashRow) => () => (replaceTrigger(SLASH_QUERY, r.run ? "" : `${r.label} `), close(), refresh(), changed(), r.run?.());
      return show(slashRows(slash[1]).map((r) => ({ label: r.label, detail: r.detail, choose: choose(r) })));
    }
    close();
  }

  function onFileMatches(query: string, matches: Attachment[]) {
    if (query !== lastQuery) return; // a newer keystroke is on its way
    show(
      matches.map((a) =>
        a.kind === "thread"
          ? // A conversation becomes a chip; the "@query" typed for it goes.
            { label: a.path, detail: threadDetail(a), choose: () => (replaceTrigger(AT_QUERY, ""), close(), add([a])) }
          : {
              label: a.kind === "folder" ? `${a.path}/` : a.path,
              detail: a.kind === "folder" ? "folder" : undefined,
              choose: () => (replaceTrigger(AT_QUERY, ""), insertMention(a), close(), refresh(), changed()),
            },
      ),
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
  /**
   * A drop on the panel. Items from VS Code go to the host, which checks they're in this window's
   * folders; files from Finder or another app are attached by their content when they're text (a
   * webview can't see their paths), even when the drop also carries their file:// links; other links
   * go to the host, which says why it can't attach them. A drop that attaches nothing here says why,
   * and the host logs what it carried. A plain-text drop isn't the panel's: it's left alone.
   */
  async function onDrop(e: DragEvent) {
    const data = e.dataTransfer;
    if (!data || !isPanelDrop(data.types)) return;
    e.preventDefault();
    // The drop's data is readable only during the event: take everything before any await.
    const fromVsCode = vscodeUris(data);
    const links = linkUris(data);
    const types = Array.from(data.types ?? []);
    const files = Array.from(data.files ?? []);
    if (fromVsCode.length) return send({ type: "dropUris", uris: fromVsCode });
    if (!files.length && links.length) return send({ type: "dropUris", uris: links });
    const { attached, skipped } = await droppedFiles(files);
    if (attached.length) add(attached);
    if (skipped.length) note(`Couldn't attach ${skipped.join(", ")}. Drag workspace files from the Explorer instead.`);
    else if (!attached.length) note("Nothing to attach from that drop.");
    if (!attached.length) send({ type: "dropIgnored", types });
  }

  suggestion.addEventListener("click", () => activeFile && (add([{ path: activeFile, kind: "file" }]), input.focus()));
  input.addEventListener("scroll", () => (layer.scrollTop = input.scrollTop));
  renderChips();
  refresh();
  return {
    chips,
    dropNote,
    layer,
    suggestion,
    popover,
    add,
    refresh,
    onInput,
    onKeydown,
    onFileMatches,
    onDrop,
    /** The "/" menu's rows for the text after "/". */
    setSlashRows: (rows: (query: string) => SlashRow[]) => (slashRows = rows),
    /** The workspace file open in the editor (offered as a suggestion), or undefined. */
    setActiveFile(path: string | undefined) {
      activeFile = path;
      renderSuggestion();
    },
    /** The attachments now (mentions still in the text, then text chips), without clearing them: for the saved draft. */
    current(): Attachment[] {
      return [...present().map((t) => known.get(t)!), ...texts];
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
