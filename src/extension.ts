import * as vscode from "vscode";
import { registerKernlParticipant } from "./chatParticipant";
import { Controller } from "./controller";

export function activate(context: vscode.ExtensionContext) {
  const controller = new Controller(context);
  context.subscriptions.push(
    controller,
    vscode.commands.registerCommand("kernl.setApiKey", () => controller.setApiKey()),
    vscode.commands.registerCommand("kernl.addCustomProvider", () => controller.addCustomProvider()),
    vscode.commands.registerCommand("kernl.useDeepSeekForClaudeCode", () => controller.useDeepSeekForClaudeCode()),
    vscode.commands.registerCommand("kernl.clearKeys", () => controller.clearKeys()),
    vscode.commands.registerCommand("kernl.newChat", () => controller.newChat()),
    vscode.commands.registerCommand("kernl.newWorkspace", () => controller.newWorkspace()),
    vscode.commands.registerCommand("kernl.openSettings", () => controller.openSettings()),
    vscode.commands.registerCommand("kernl.help", () => controller.showHelp()),
    vscode.commands.registerCommand("kernl.showSources", () => controller.showSources()),
    vscode.commands.registerCommand("kernl.showConnections", () => controller.showConnections()),
    vscode.commands.registerCommand("kernl.open", () => controller.open()),
    vscode.commands.registerCommand("kernl.ask", () => controller.ask()),
    vscode.commands.registerCommand("kernl.askAboutSelection", () => controller.askAboutSelection()),
    vscode.commands.registerCommand("kernl.quickMenu", () => controller.quickMenu()),
    vscode.commands.registerCommand("kernl.manageProviders", () => controller.manageProviders()),
    vscode.commands.registerCommand("kernl.agentLogins", () => controller.agentLogins()),
    vscode.commands.registerCommand("kernl.pickHarness", () => controller.pickHarnessCommand()),
    vscode.commands.registerCommand("kernl.sessions", () => controller.showSessions()),
    vscode.commands.registerCommand("kernl.newTab", () => controller.newTabCommand()),
    vscode.commands.registerCommand("kernl.closeTab", () => controller.closeShownTab()),
    vscode.commands.registerCommand("kernl.nextTab", () => controller.showTab(1)),
    vscode.commands.registerCommand("kernl.previousTab", () => controller.showTab(-1)),
    vscode.commands.registerCommand("kernl.clearHistory", () => controller.clearHistory()),
    vscode.commands.registerCommand("kernl.attachToChat", (uri?: vscode.Uri, uris?: vscode.Uri[]) =>
      controller.attachUris((uris?.length ? uris : uri ? [uri] : []).map((u) => u.toString())),
    ),
  );
  // "@kernl" in VS Code's own chat, where it's available.
  const participant = registerKernlParticipant(controller.chatForwarding(), vscode.Uri.joinPath(context.extensionUri, "media", "icon.png"));
  if (participant) context.subscriptions.push(participant);
  // Returned for the integration tests (test/vscode): the real SecretStorage-backed key stores and the controller seam.
  return { keys: controller.keys, agentCredentials: controller.agentCredentials, testing: controller.testingApi() };
}

export function deactivate() {}
