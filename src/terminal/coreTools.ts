// VS Code's own terminal tools (built into VS Code, exposed through vscode.lm): they read the active
// terminal's screen, so they cover what kernl's recorder can't (a command from before VS Code started
// kernl) and the user's selection. Their names are VS Code's internals: kernl looks them up each time
// and says so when they're missing (renamed, or VS Code's AI features turned off).
import * as vscode from "vscode";

export interface CoreTerminalTools {
  /** The active terminal's last command and output, as VS Code reads it from the screen; undefined when the tool isn't available. */
  lastCommand(): Promise<string | undefined>;
  /** The text the user selected in the active terminal; undefined when the tool isn't available. */
  selection(): Promise<string | undefined>;
}

async function invoke(name: string): Promise<string | undefined> {
  if (!vscode.lm?.tools?.some((t) => t.name === name)) return undefined;
  const result = await vscode.lm.invokeTool(name, { input: {}, toolInvocationToken: undefined });
  return result.content
    .map((part) => (part instanceof vscode.LanguageModelTextPart ? part.value : ""))
    .join("")
    .trim();
}

export const coreTerminalTools: CoreTerminalTools = {
  lastCommand: () => invoke("terminal_last_command"),
  selection: () => invoke("terminal_selection"),
};
