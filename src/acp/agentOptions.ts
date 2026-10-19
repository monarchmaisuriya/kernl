// A CLI agent's own switches, as the composer's chips: its model, how much it thinks, and fast mode.
// They come from the agent's ACP session config options, so kernl never keeps a model list of its own:
// each agent reports what the user's account offers (Claude Code's 1M-context models are separate
// model rows, e.g. `opus[1m]`). The permission mode is handled separately (see agents.ts).
import type * as acp from "@agentclientprotocol/sdk";
import type { AgentOptionView } from "../ui/protocol";

const ON_OFF = new Set(["on", "off"]);
/** Chip order, and the order remembered choices are applied in: a model change rebuilds the effort list and fast mode. */
const KINDS: AgentOptionView["kind"][] = ["model", "thinking", "fast"];

/** The options shown as chips, at most one per kind, from the agent's full list (mode and anything else left out). */
export function chipOptions(options: readonly acp.SessionConfigOption[] | null | undefined): AgentOptionView[] {
  const out: AgentOptionView[] = [];
  for (const o of options ?? []) {
    const view = toView(o);
    if (view && !out.some((v) => v.kind === view.kind)) out.push(view);
  }
  return KINDS.flatMap((k) => out.filter((v) => v.kind === k));
}

function toView(o: acp.SessionConfigOption): AgentOptionView | undefined {
  if (o.type === "boolean") return o.category === "model_config" ? { id: o.id, name: o.name, kind: "fast", type: "boolean", value: !!o.currentValue } : undefined;
  if (o.type !== "select") return undefined;
  const choices = (o.options as acp.SessionConfigSelectOptions).flatMap((c) => ("group" in c ? c.options : [c])).map((c) => ({
    value: c.value,
    name: c.name,
    // Claude Code's 1M-context models are their own rows (`opus[1m]`); say so when the name doesn't.
    ...(c.description ? { description: c.description } : /\[1m\]/i.test(c.value) && !/1m/i.test(c.name) ? { description: "1M context" } : {}),
  }));
  if (o.category === "model") return { id: o.id, name: o.name, kind: "model", type: "select", value: String(o.currentValue), choices };
  if (o.category === "thought_level") return { id: o.id, name: o.name, kind: "thinking", type: "select", value: String(o.currentValue), choices };
  // A fast-mode switch sent as an on/off select (to a client without boolean options).
  if (o.category === "model_config" && choices.length === 2 && choices.every((c) => ON_OFF.has(c.value))) return { id: o.id, name: o.name, kind: "fast", type: "select", value: o.currentValue === "on", choices };
  return undefined;
}

/** The ACP value to send for a chip's choice: a fast switch sent as a select takes "on"/"off". */
export function wireValue(option: AgentOptionView, value: string | boolean): { value: string | boolean; boolean: boolean } {
  if (option.type === "boolean") return { value: !!value, boolean: true };
  if (option.kind === "fast") return { value: value === true || value === "on" ? "on" : "off", boolean: false };
  return { value: String(value), boolean: false };
}

/**
 * The next remembered choice to apply to a fresh session, given what it offers now, or undefined when
 * every remembered choice is applied, gone, or already current. Called again after each change, since
 * a model change can change the other options.
 */
export function nextRemembered(options: readonly AgentOptionView[], remembered: Readonly<Record<string, string | boolean>>, done: ReadonlySet<string>): { option: AgentOptionView; value: string | boolean } | undefined {
  for (const kind of KINDS) {
    const option = options.find((o) => o.kind === kind);
    if (!option || done.has(option.id) || !(option.id in remembered)) continue;
    const value = remembered[option.id];
    if (option.type === "select" && option.kind !== "fast" && !option.choices?.some((c) => c.value === value)) continue;
    if (option.value === value) continue;
    return { option, value };
  }
  return undefined;
}
