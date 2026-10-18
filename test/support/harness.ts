import { mkdtempSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { AIMessage, ToolMessage } from "@langchain/core/messages";
import { createDeepAgent } from "deepagents";
import { composeBackend } from "../../src/backend/compose";
import { GatedBackend } from "../../src/backend/gatedBackend";
import { NodeWorkspaceFiles } from "../../src/backend/workspaceFiles";
import { ApprovalGate, type GateRequest } from "../../src/gate/approvalGate";
import { parseRules } from "../../src/gate/rules";
import { ScriptedChatModel } from "./scriptedModel";

export function toolCall(name: string, args: Record<string, unknown>, id = `c${Math.random().toString(36).slice(2, 8)}`) {
  return new AIMessage({ content: "", tool_calls: [{ name, args, id, type: "tool_call" }] });
}

/** A temp workspace with app.txt and .env, a gate that answers `approve`, and a recording command runner. */
export function workspace(approve: boolean | ((r: GateRequest) => boolean), allowList: string[] = []) {
  const root = mkdtempSync(join(tmpdir(), "yourstack-test-"));
  writeFileSync(join(root, "app.txt"), "hello world\n");
  writeFileSync(join(root, ".env"), "SECRET_TOKEN=abc123\n");
  const asked: GateRequest[] = [];
  const commands: string[] = [];
  const gate = new ApprovalGate(
    {
      ask: async (_id, r) => {
        asked.push(r);
        return typeof approve === "function" ? approve(r) : approve;
      },
    },
    { rules: () => parseRules({}, allowList).rules },
  );
  const runner = async (command: string) => {
    commands.push(command);
    return { output: `ran: ${command}`, exitCode: 0, truncated: false };
  };
  const workspaceBackend = new GatedBackend(root, gate, new NodeWorkspaceFiles(), runner);
  return { root, asked, commands, gate, workspaceBackend, backend: composeBackend(workspaceBackend) };
}

/** Runs a scripted Deep Agent; `extra` passes more createDeepAgent options (e.g. subagents). */
export async function runScript(backend: any, script: AIMessage[], tools: any[] = [], extra: Record<string, unknown> = {}) {
  const agent = createDeepAgent({ model: new ScriptedChatModel(script), backend, tools, ...extra });
  const out = await agent.invoke({ messages: [{ role: "user", content: "go" }] });
  return out.messages.filter((m: any) => ToolMessage.isInstance(m)).map((m: any) => messageText(m.content));
}

/** Tool message content is a string or a list of content blocks; tests compare the text. */
export function messageText(content: unknown): string {
  if (typeof content === "string") return content;
  if (Array.isArray(content)) return content.map((b: any) => (typeof b === "string" ? b : (b?.text ?? JSON.stringify(b)))).join("");
  return JSON.stringify(content);
}
