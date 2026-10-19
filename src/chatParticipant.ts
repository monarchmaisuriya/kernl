// Registers "@kernl" in VS Code's chat; the handler is in chatRequest.ts.
import * as vscode from "vscode";
import { type ChatForwarding, handleKernlRequest } from "./chatRequest";

export type { ChatForwarding } from "./chatRequest";

/** Registers "@kernl" where VS Code's chat is available; undefined where it isn't. */
export function registerKernlParticipant(forwarding: ChatForwarding, iconPath: vscode.Uri): vscode.Disposable | undefined {
  if (typeof vscode.chat?.createChatParticipant !== "function") return undefined;
  const participant = vscode.chat.createChatParticipant("kernl.kernl", (request, _context, stream) => handleKernlRequest(request, stream, forwarding));
  participant.iconPath = iconPath;
  return participant;
}
