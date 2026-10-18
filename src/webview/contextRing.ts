// How full the agent's context window is, as a small ring in the footer: the percentage, with the
// session-usage RFD's thresholds (yellow from 75%, orange from 90%, red from 95%) and the exact
// numbers and cost in its tooltip. Built with createElement + setAttribute only.
const NS = "http://www.w3.org/2000/svg";
const R = 6;
const CIRCUMFERENCE = 2 * Math.PI * R;

export interface ContextUsage {
  used: number;
  size: number;
  cost?: { amount: number; currency: string };
}

const compact = (n: number) => (n >= 1_000_000 ? `${(n / 1_000_000).toFixed(1)}M` : n >= 1000 ? `${Math.round(n / 1000)}k` : String(n));

export function contextLevel(percent: number): "normal" | "filling" | "high" | "full" {
  return percent >= 95 ? "full" : percent >= 90 ? "high" : percent >= 75 ? "filling" : "normal";
}

export function createContextRing() {
  const ring = document.createElement("span");
  ring.className = "context-ring";
  ring.hidden = true;
  ring.setAttribute("role", "img");
  const svg = document.createElementNS(NS, "svg");
  for (const [k, v] of [["viewBox", "0 0 16 16"], ["width", "14"], ["height", "14"], ["aria-hidden", "true"]]) svg.setAttribute(k, v);
  const track = document.createElementNS(NS, "circle");
  const fill = document.createElementNS(NS, "circle");
  for (const c of [track, fill]) for (const [k, v] of [["cx", "8"], ["cy", "8"], ["r", String(R)], ["fill", "none"], ["stroke-width", "2.5"]]) c.setAttribute(k, v);
  track.setAttribute("class", "context-track");
  fill.setAttribute("class", "context-fill");
  fill.setAttribute("transform", "rotate(-90 8 8)");
  fill.setAttribute("stroke-dasharray", String(CIRCUMFERENCE));
  svg.append(track, fill);
  const label = document.createElement("span");
  label.className = "context-label";
  ring.append(svg, label);

  function show(usage: ContextUsage | undefined) {
    ring.hidden = !usage;
    if (!usage) return;
    const percent = Math.min(100, Math.round((usage.used / usage.size) * 100));
    fill.setAttribute("stroke-dashoffset", String(CIRCUMFERENCE * (1 - percent / 100)));
    ring.dataset.level = contextLevel(percent);
    label.textContent = `${percent}%`;
    const cost = usage.cost ? ` · ${new Intl.NumberFormat(undefined, { style: "currency", currency: usage.cost.currency }).format(usage.cost.amount)}` : "";
    const warning = percent >= 95 ? " · nearly full: the next message may fail; start a new conversation" : percent >= 75 ? " · filling up" : "";
    const text = `Context: ${compact(usage.used)} of ${compact(usage.size)} tokens (${percent}%)${cost}${warning}`;
    ring.title = text;
    ring.setAttribute("aria-label", text);
  }
  return { ring, show };
}
