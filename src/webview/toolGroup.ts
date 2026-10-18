// Reads and searches that come in a row, as one line: "Exploring · 1 file, 2 searches" while any
// runs (shimmering), "Explored 1 file, 4 searches" when done, and "· 1 failed" in red when any failed. It opens to the
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

export function createToolGroup(): ToolGroup {
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
  summary.append(kind, action, failures, icon("chevron", 12));
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
