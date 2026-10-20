// kernl's own slash commands: panel actions (new chat, new tab, Conversations, agent, model, mode...)
// that run instead of being sent, from the panel's message box, Ask kernl, or @kernl. They share the
// "/" menu with the agent's commands (or kernl's skills), and the agent wins a clash: a name the agent
// offers goes to the agent, and "/kernl:<name>" always reaches kernl's. Each runs the action its button
// runs and takes no text. The panel and the host both use this module; the host runs them.
import type { WorkspaceView } from "./protocol";

export interface PanelCommand {
  name: string;
  aliases: readonly string[];
  description: string;
  /** Said when the command can't run in the shown tab (it's then left out of the menu). */
  unavailable?: string;
}

export const PANEL_COMMANDS = [
  { name: "new", aliases: ["clear"], description: "New chat in this tab" },
  { name: "tab", aliases: [], description: "New tab" },
  { name: "close", aliases: [], description: "Close this tab", unavailable: "The first tab can't be closed." },
  { name: "conversations", aliases: ["resume"], description: "Open an earlier conversation" },
  { name: "agent", aliases: [], description: "Choose the agent", unavailable: "The agent can't be changed while it's working." },
  { name: "model", aliases: [], description: "Choose the model", unavailable: "This agent has no model to choose here." },
  { name: "mode", aliases: [], description: "Choose the permission mode", unavailable: "The permission mode can't be changed here." },
  { name: "connections", aliases: [], description: "Show logins, keys, and MCP servers" },
  { name: "settings", aliases: [], description: "kernl settings" },
  { name: "help", aliases: [], description: "What kernl can do, with examples" },
] as const satisfies readonly PanelCommand[];

export type PanelCommandName = (typeof PANEL_COMMANDS)[number]["name"];

const PREFIX = "kernl:";
const COMMAND = /^\/(kernl:)?([\w-]+)(?:\s+([\s\S]*))?$/;

const named = (word: string) => PANEL_COMMANDS.find((c) => c.name === word || (c.aliases as readonly string[]).includes(word));

/**
 * The kernl command a message names, a refusal to show instead of sending, or undefined to send the
 * text as usual. `agentNames`: the names the agent offers on "/" (its commands, or kernl's skills).
 */
export function commandFor(text: string, agentNames: ReadonlySet<string>): { command: PanelCommand } | { refusal: string } | undefined {
  const m = COMMAND.exec(text.trim());
  if (!m) return undefined;
  const [, explicit, word, rest] = m;
  const command = named(word);
  if (!command) return explicit ? { refusal: `kernl has no command /${PREFIX}${word}.` } : undefined;
  if (!explicit && agentNames.has(word)) return undefined;
  if (rest?.trim()) return { refusal: `/${explicit ?? ""}${word} takes nothing after it.` };
  return { command };
}

/**
 * Whether a command can run in a workspace now, from what the panel also shows: a tab to close, an agent
 * that isn't working, a model to choose, more than one permission mode outside Restricted Mode.
 */
export function commandAvailable(command: PanelCommand, view: WorkspaceView, restricted: boolean): boolean {
  switch (command.name) {
    case "close":
      return !!view.tabOf;
    case "agent":
      return !view.running;
    case "model":
      return view.harness.startsWith("deepagents") || (!view.running && !!view.agentOptions?.some((o) => o.kind === "model"));
    case "mode":
      return !restricted && view.modes.length > 1;
    default:
      return true;
  }
}

/**
 * kernl's rows for the "/" menu: the available commands whose name or alias starts with `query` (the
 * text after "/"), an exact match first so Enter picks it. An alias the agent offers doesn't match (it
 * goes to the agent), and a name the agent also offers is labelled "kernl:<name>" (`clash`).
 */
export function menuRows(query: string, agentNames: ReadonlySet<string>, available: (c: PanelCommand) => boolean) {
  const explicit = query.startsWith(PREFIX);
  const q = explicit ? query.slice(PREFIX.length) : query;
  const words = (c: PanelCommand) => [c.name, ...c.aliases.filter((a) => explicit || !agentNames.has(a))];
  const matching = PANEL_COMMANDS.filter((c) => available(c) && words(c).some((w) => w.startsWith(q)));
  const exact = (c: PanelCommand) => words(c).includes(q);
  return [...matching.filter(exact), ...matching.filter((c) => !exact(c))].map((command) => {
    const clash = agentNames.has(command.name);
    return { label: `/${clash || explicit ? PREFIX : ""}${command.name}`, detail: `${command.description} · kernl`, clash, command: command as PanelCommand };
  });
}
