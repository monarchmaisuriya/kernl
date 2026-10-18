// The agent's plan, pinned above the input: collapsed it says what's being done now ("Current: …")
// and how far along it is; open, it lists every step. Each plan update replaces it whole.
// Built with createElement + textContent only.
import type { PlanEntryView } from "../ui/protocol";
import { icon } from "./icons";

export function createPlanBar() {
  const bar = document.createElement("details");
  bar.className = "plan-bar";
  bar.hidden = true;
  const summary = document.createElement("summary");
  const current = document.createElement("span");
  current.className = "plan-current";
  const count = document.createElement("span");
  count.className = "plan-count";
  summary.append(icon("check", 13), current, count, icon("chevron", 12));
  const list = document.createElement("ol");
  list.className = "plan-list";
  bar.append(summary, list);

  function show(entries: PlanEntryView[] | undefined) {
    bar.hidden = !entries?.length;
    if (!entries?.length) return;
    const done = entries.filter((e) => e.status === "completed").length;
    const now = entries.find((e) => e.status === "in_progress") ?? entries.find((e) => e.status === "pending");
    current.textContent = now ? `Current: ${now.content}` : "Plan complete";
    count.textContent = `${done}/${entries.length}`;
    summary.title = `Plan: ${done} of ${entries.length} steps done`;
    list.replaceChildren(
      ...entries.map((e) => {
        const item = document.createElement("li");
        item.className = "plan-entry";
        item.dataset.status = e.status;
        const mark = document.createElement("span");
        mark.className = "plan-mark";
        if (e.status === "completed") mark.append(icon("check", 12));
        const text = document.createElement("span");
        text.textContent = e.content;
        item.append(mark, text);
        if (e.priority === "high") item.title = "High priority";
        return item;
      }),
    );
  }
  return { bar, show };
}
