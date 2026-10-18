import * as vscode from "vscode";
import { Controller } from "./controller";

export function activate(context: vscode.ExtensionContext) {
  const controller = new Controller(context);
  context.subscriptions.push(
    controller,
    vscode.commands.registerCommand("yourstack.setApiKey", () => controller.setApiKey()),
    vscode.commands.registerCommand("yourstack.addCustomProvider", () => controller.addCustomProvider()),
    vscode.commands.registerCommand("yourstack.useDeepSeekForClaudeCode", () => controller.useDeepSeekForClaudeCode()),
    vscode.commands.registerCommand("yourstack.clearKeys", () => controller.clearKeys()),
    vscode.commands.registerCommand("yourstack.newChat", () => controller.newChat()),
    vscode.commands.registerCommand("yourstack.newWorkspace", () => controller.newWorkspace()),
    vscode.commands.registerCommand("yourstack.openSettings", () => controller.openSettings()),
    vscode.commands.registerCommand("yourstack.manageProviders", () => controller.manageProviders()),
    vscode.commands.registerCommand("yourstack.agentLogins", () => controller.agentLogins()),
    vscode.commands.registerCommand("yourstack.pickHarness", () => controller.pickHarnessCommand()),
    vscode.commands.registerCommand("yourstack.sessions", () => controller.showSessions()),
    vscode.commands.registerCommand("yourstack.clearHistory", () => controller.clearHistory()),
    vscode.commands.registerCommand("yourstack.attachToChat", (uri?: vscode.Uri, uris?: vscode.Uri[]) =>
      controller.attachUris((uris?.length ? uris : uri ? [uri] : []).map((u) => u.toString())),
    ),
  );
  // Returned for the integration tests (test/vscode): the real SecretStorage-backed key stores and the controller seam.
  return { keys: controller.keys, agentCredentials: controller.agentCredentials, testing: controller.testingApi() };
}

export function deactivate() {}
