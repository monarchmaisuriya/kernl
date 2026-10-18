// Reads and searches that come in a row, as one line: "Exploring · 1 file, 2 searches" while any
// runs (shimmering), "Explored 1 file, 4 searches" when done, and "· 1 failed" in red when any failed.
// The files it read show as chips after the summary (each opens its file), and images its reads
// returned as thumbnails at the end of the line. It opens to the
// individual rows. Built with createElement + textContent only.
import { icon } from "./icons";

export interface ToolGroup {
  element: HTMLDetailsElement;
  /** Moves a row (already built) into the group. */
  add(row: HTMLElement, kind: "read" | "search"): void;
  /** Re-reads the members' status marks (call after any of them changes). */
  refresh(): void;
}

const count = (n: number, one: string, many: string) => `${n} ${n === 1 ? one : many}`;

/** A read file on the group's line: its icon and name (full path in the tooltip); a click opens it. */
function fileChip(path: string, openFile?: (path: string) => void): HTMLElement {
  const chip = document.createElement("button");
  chip.className = "tool-file-chip";
  chip.title = `Open ${path}`;
  chip.setAttribute("aria-label", `Open ${path}`);
  const name = document.createElement("span");
  name.textContent = path.split("/").pop() ?? path;
  chip.append(icon("file", 12), name);
  chip.addEventListener("click", (e) => {
    // Inside the line's summary: open the file, not the group.
    e.preventDefault();
    e.stopPropagation();
    openFile?.(path);
  });
  return chip;
}
/** Thumbnails and file chips shown on the line before "+N". */
const MAX_SHOWN = 3;

export function createToolGroup(openFile?: (path: string) => void): ToolGroup {
  const element = document.createElement("details");
  element.className = "tool tool-group";
  const summary = document.createElement("summary");
  const kind = document.createElement("span");
  kind.className = "tool-kind";
  kind.append(icon("search", 13));
  const action = document.createElement("span");
  action.className = "tool-action";
  const failures = document.createElement("span");
  failures.className = "tool-group-failed";
  const thumbs = document.createElement("span");
  thumbs.className = "tool-group-thumbs";
  const files = document.createElement("span");
  files.className = "tool-group-files";
  summary.append(kind, action, files, failures, thumbs, icon("chevron", 12));
  const rows = document.createElement("div");
  rows.className = "tool-group-rows";
  element.append(summary, rows);
  const members: { row: HTMLElement; kind: "read" | "search" }[] = [];

  const refresh = () => {
    const states = members.map((m) => m.row.dataset.status);
    const active = states.some((s) => s === "running" || s === "pending");
    const failed = states.filter((s) => s === "failed").length;
    const reads = members.filter((m) => m.kind === "read").length;
    const searches = members.length - reads;
    const counts = [reads ? count(reads, "file", "files") : "", searches ? count(searches, "search", "searches") : ""].filter(Boolean).join(", ");
    action.textContent = active ? `Exploring · ${counts}` : `Explored ${counts}`;
    failures.textContent = failed ? `· ${failed} failed` : "";
    failures.hidden = !failed;
    // Its own attribute: rows' status styles match any ancestor `.tool[data-status]`, so a group's would recolor its members.
    element.dataset.groupStatus = active ? "running" : failed ? "failed" : "done";
    summary.title = `${action.textContent}${failed ? ` ${failures.textContent}` : ""}`;
    // The files read, up to 3 chips, then how many more.
    const paths = [...new Set(members.flatMap((m) => (m.row.dataset.file ? [m.row.dataset.file] : [])))];
    files.replaceChildren(
      ...paths.slice(0, MAX_SHOWN).map((path) => fileChip(path, openFile)),
      ...(paths.length > MAX_SHOWN ? [Object.assign(document.createElement("span"), { className: "tool-file-more", textContent: `+${paths.length - MAX_SHOWN}` })] : []),
    );
    // The members' thumbnails, up to 3, then how many more.
    const images = members.flatMap((m) => [...m.row.querySelectorAll<HTMLImageElement>(":scope > summary > .tool-thumb")].map((t) => t.src));
    thumbs.replaceChildren(
      ...images.slice(0, MAX_SHOWN).map((src) => Object.assign(document.createElement("img"), { className: "tool-thumb", src, alt: "" })),
      ...(images.length > MAX_SHOWN ? [Object.assign(document.createElement("span"), { className: "tool-thumb-more", textContent: `+${images.length - MAX_SHOWN}` })] : []),
    );
  };

  return {
    element,
    add(row, k) {
      members.push({ row, kind: k });
      rows.append(row);
      refresh();
    },
    refresh,
  };
}
