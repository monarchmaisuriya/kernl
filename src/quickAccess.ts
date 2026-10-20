// kernl one click from the top of the window: the kernl menu (the editor title toolbar's kernl
// button, the status bar item, Ctrl+Alt+K) with kernl's version of the title bar chat button's
// actions, and the option that hides VS Code's chat button in its favor. VS Code doesn't let an
// extension into the Command Center, so kernl's button sits in the editor toolbar right below it.

/** The menu's actions, in order; the editor title submenu in package.json lists the same commands. */
export const QUICK_ACTIONS: readonly { command: string; label: string; detail: string }[] = [
  { command: "kernl.open", label: "Open kernl", detail: "Show the kernl panel" },
  { command: "kernl.ask", label: "Ask kernl…", detail: "Type a request; it goes to the shown workspace" },
  { command: "kernl.askAboutSelection", label: "Ask kernl about this file or selection", detail: "Attach it to the message box" },
  { command: "kernl.newChat", label: "New chat", detail: "In the shown workspace" },
  { command: "kernl.newWorkspace", label: "New workspace (git worktree)", detail: "A separate folder and branch for an agent" },
  { command: "kernl.sessions", label: "Conversations", detail: "Open an earlier conversation" },
  { command: "kernl.pickHarness", label: "Choose agent", detail: "kernl, Claude Code, Codex, OpenCode" },
  { command: "kernl.agentLogins", label: "Agent logins", detail: "Log in, or use an API key" },
  { command: "kernl.showConnections", label: "Show connections", detail: "Logins, keys, MCP servers, plugins" },
  { command: "kernl.openSettings", label: "kernl settings", detail: "" },
  { command: "kernl.help", label: "kernl help", detail: "What kernl can do, with examples" },
];

/** The status bar item: "kernl", or "kernl: 2 need you" with a warning when connections need the user. */
export function statusBarText(needYou: number): { text: string; tooltip: string } {
  // Plain "kernl": a status bar item can only show VS Code's own icons, not the kernl mark.
  if (!needYou) return { text: "kernl", tooltip: "kernl: open the kernl menu" };
  return { text: `$(warning) kernl: ${needYou} need${needYou === 1 ? "s" : ""} you`, tooltip: `kernl: ${needYou} connection${needYou === 1 ? "" : "s"} need${needYou === 1 ? "s" : ""} you. Open the kernl menu` };
}

/** VS Code's setting for its chat button in the Command Center ("hidden", "badge", "compact"). */
export const CHAT_BUTTON_SETTING = "chat.agentsControl.enabled";

/** VS Code's user setting, as kernl reads and writes it (user scope only). */
export interface UserSetting {
  /** Whether this VS Code knows the setting at all (it's marked experimental). */
  exists(): boolean;
  /** The user's own value, or undefined when unset. */
  get(): unknown;
  /** Writes the user value; undefined removes it. */
  set(value: unknown): Promise<void>;
}

/** What the user had before kernl hid the button: `{ value }` (undefined when it was unset), or undefined when kernl changed nothing. */
export interface SavedValue {
  get(): { value: unknown } | undefined;
  set(saved: { value: unknown } | undefined): Promise<void>;
}

/**
 * kernl.replaceChatButton on: save the user's value of chat.agentsControl.enabled and set it to
 * "hidden". Off: put back what was saved, unless the user has changed it since (then theirs stays).
 * Returns what happened, for the notice.
 */
export async function applyChatButtonReplacement(on: boolean, setting: UserSetting, saved: SavedValue): Promise<"hidden" | "restored" | "kept" | "unchanged" | "unsupported"> {
  if (on) {
    if (!setting.exists()) return "unsupported";
    if (saved.get()) {
      if (setting.get() === "hidden") return "unchanged";
      // Saved earlier but shown again (changed by hand): hide it again, keeping the first saved value.
      await setting.set("hidden");
      return "hidden";
    }
    await saved.set({ value: setting.get() });
    await setting.set("hidden");
    return "hidden";
  }
  const before = saved.get();
  if (!before) return "unchanged";
  await saved.set(undefined);
  if (setting.get() !== "hidden") return "kept";
  await setting.set(before.value);
  return "restored";
}
