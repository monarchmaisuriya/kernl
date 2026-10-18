import { randomUUID } from "node:crypto";
import { AIMessageChunk, type BaseMessage, mapChatMessagesToStoredMessages, mapStoredMessagesToChatMessages, type StoredMessage, ToolMessage } from "@langchain/core/messages";
import { type Attachment, attachmentNote, type PlanEntryView, type SkillView, type ToolInfo } from "../ui/protocol";
import type { BuiltAgent } from "./createAgent";
import type { Runner } from "./runner";
import { untracedRunConfig } from "./tracing";

export interface SessionEvents {
  text(delta: string): void;
  /** Reported again with the same id as the call progresses (`info`: status, kind, locations, diff size). */
  toolCall(id: string, name: string, args: unknown, info?: ToolInfo): void;
  /** An edit's full before and after, kept by the host for "View diff". */
  toolDiff?(id: string, diff: { path: string; before: string | null; after: string }): void;
  /** The model's or agent's thinking, streamed. */
  thinking?(delta: string): void;
  /** The agent's whole plan (each call replaces it). */
  plan?(entries: PlanEntryView[]): void;
  /** How full the context window is (agents that report it). */
  context?(usage: { used: number; size: number; cost?: { amount: number; currency: string } }): void;
  /** The agent's own slash commands. */
  commands?(items: SkillView[]): void;
  /** A title the agent gave the conversation. */
  title?(title: string): void;
  /** The agent changed its own config options (e.g. left plan mode): option id -> current value. */
  configChanged?(values: Record<string, string>): void;
  /** `failed`: the tool reported an error (LangChain status "error", ACP status "failed"). */
  toolResult(id: string, name: string, output: string, failed?: boolean): void;
  /** An image a tool returned (a read image, a browser screenshot), base64, for the panel's preview. */
  toolImage?(id: string, image: ToolImage): void;
  /** Text a delegated subagent writes, for the `task` call that started it (not the main reply). */
  subagentText?(taskId: string, delta: string): void;
  usage(inputTokens: number, outputTokens: number): void;
  finished(reason: "done" | "stopped" | "error", message?: string): void;
}

/** An image a tool read or produced (base64), as agents send it. */
export interface ToolImage {
  mimeType: string;
  data: string;
}

/** Images in a tool result: `{ type: "image", mimeType, data }` (kernl's tools) or a base64 `data:` image_url. */
export function imagesOf(content: unknown): ToolImage[] {
  if (!Array.isArray(content)) return [];
  return content.flatMap((b: any): ToolImage[] => {
    const mimeType = b?.mimeType ?? b?.mime_type;
    if (b?.type === "image" && typeof b.data === "string" && typeof mimeType === "string") return [{ mimeType, data: b.data }];
    const url = typeof b?.image_url === "string" ? b.image_url : b?.image_url?.url;
    const dataUrl = b?.type === "image_url" && typeof url === "string" ? /^data:([^;,]+);base64,(.*)$/s.exec(url) : null;
    return dataUrl ? [{ mimeType: dataUrl[1], data: dataUrl[2] }] : [];
  });
}

function textOf(content: unknown): string {
  if (typeof content === "string") return content;
  if (Array.isArray(content)) return content.map((b: any) => (typeof b === "string" ? b : b?.type === "text" ? b.text : "")).join("");
  return "";
}

/**
 * A message's thinking: Anthropic `thinking` parts, LangChain's normalized `reasoning` parts, and
 * DeepSeek's `reasoning_content` (which arrives outside the content).
 */
function thinkingOf(message: any): string {
  const parts = Array.isArray(message.content) ? message.content.map((b: any) => (b?.type === "thinking" ? (b.thinking ?? "") : b?.type === "reasoning" ? (b.reasoning ?? "") : "")).join("") : "";
  const deepseek = message.additional_kwargs?.reasoning_content;
  return parts + (typeof deepseek === "string" ? deepseek : "");
}

/** The kernl agent's to-do tool is shown as the plan, not as a tool row. */
const TODO_TOOL = "write_todos";

/**
 * One chat thread with the agent. Streams tokens and tool activity to the UI, keeps history
 * in the agent's checkpointer (keyed by thread id), and cancels through one AbortController.
 */
export class AgentSession implements Runner {
  private threadId = randomUUID();
  /** Messages a new thread starts from (a resumed or cut-back conversation), applied on the next send. */
  private seed: BaseMessage[] | undefined;
  private controller: AbortController | undefined;
  private seenToolCalls = new Set<string>();
  /** Calls shown some other way (the to-do list as the plan): their results aren't shown as tool output. */
  private hiddenCalls = new Set<string>();

  constructor(private agent: () => Promise<BuiltAgent>, private events: SessionEvents, private onStop: () => void = () => {}) {}

  get running() {
    return this.controller !== undefined;
  }

  /** The current run's signal; tools that block (terminal) listen to it. */
  get signal(): AbortSignal | undefined {
    return this.controller?.signal;
  }

  /**
   * Claims the run before any await, so a second send() while the first is still starting
   * (building the agent) is refused instead of starting a second agent.
   */
  async send(userText: string, attachments: readonly Attachment[] = []): Promise<void> {
    if (this.controller) throw new Error("A run is already in progress; press Stop first");
    const controller = new AbortController();
    this.controller = controller;
    let inputTokens = 0;
    let outputTokens = 0;
    try {
      const agent = await this.agent();
      if (controller.signal.aborted) throw new Error("stopped before start");
      if (this.seed) {
        await (agent as any).updateState({ configurable: { thread_id: this.threadId } }, { messages: this.seed });
        this.seed = undefined;
      }
      const stream = await agent.stream(
        { messages: [{ role: "user", content: userText + attachmentNote(attachments) }] },
        { streamMode: ["messages"], signal: controller.signal, configurable: { thread_id: this.threadId }, recursionLimit: 200, ...untracedRunConfig() } as any,
      );
      // The task a delegated subagent is working for: its messages stream under a "tools:" namespace.
      let task: { id: string; subagent: string } | undefined;
      // A streaming model sends a tool call's arguments in pieces; a call is reported once its message
      // is complete (the next message, a tool result, or the end of the stream), with whole arguments.
      let pending: { key: string; nested: boolean; calls: Map<number, { id?: string; name?: string; args: string; parsed?: unknown }> } | undefined;
      const flush = () => {
        for (const c of pending?.calls.values() ?? []) {
          if (!c.id || !c.name || this.seenToolCalls.has(c.id)) continue;
          this.seenToolCalls.add(c.id);
          let args: any = c.parsed;
          if (args === undefined) {
            try {
              args = c.args ? JSON.parse(c.args) : {};
            } catch {
              args = { arguments: c.args };
            }
          }
          if (!pending!.nested && c.name === "task") task = { id: c.id, subagent: String(args?.subagent_type ?? "subagent") };
          if (!pending!.nested && c.name === TODO_TOOL && Array.isArray(args?.todos)) {
            this.hiddenCalls.add(c.id);
            this.events.plan?.(args.todos.map((t: any) => ({ content: String(t?.content ?? ""), status: String(t?.status ?? "pending") })));
            continue;
          }
          this.events.toolCall(c.id, pending!.nested && task ? `${task.subagent} > ${c.name}` : c.name, args);
        }
        pending = undefined;
      };
      for await (const item of stream as AsyncIterable<any>) {
        const [, payload] = item as [string, [unknown, unknown]];
        const message: any = payload?.[0];
        const nested = String((payload?.[1] as any)?.langgraph_checkpoint_ns ?? "").startsWith("tools:");
        if (AIMessageChunk.isInstance(message) || message?.getType?.() === "ai") {
          const key = `${nested}:${message.id ?? ""}`;
          if (pending && pending.key !== key) flush();
          pending ??= { key, nested, calls: new Map() };
          const thought = nested ? "" : thinkingOf(message);
          if (thought) this.events.thinking?.(thought);
          const delta = textOf(message.content);
          if (delta && !nested) this.events.text(delta);
          else if (delta && task) this.events.subagentText?.(task.id, delta);
          if (message.tool_call_chunks?.length) {
            for (const ch of message.tool_call_chunks) {
              const c = pending.calls.get(ch.index ?? 0) ?? { args: "" };
              c.id ??= ch.id ?? undefined;
              c.name ??= ch.name ?? undefined;
              c.args += ch.args ?? "";
              pending.calls.set(ch.index ?? 0, c);
            }
          } else {
            // A whole message (not streamed): its tool calls are already complete.
            (message.tool_calls ?? []).forEach((call: any, i: number) => pending!.calls.set(i, { id: call.id, name: call.name, args: "", parsed: call.args }));
          }
          if (message.usage_metadata) {
            inputTokens += message.usage_metadata.input_tokens ?? 0;
            outputTokens += message.usage_metadata.output_tokens ?? 0;
            this.events.usage(inputTokens, outputTokens); // live, not only at the end
          }
        } else if (ToolMessage.isInstance(message)) {
          flush();
          if (this.hiddenCalls.has(message.tool_call_id)) continue;
          this.events.toolResult(message.tool_call_id, message.name ?? "", textOf(message.content), message.status === "error");
          for (const image of imagesOf(message.content)) this.events.toolImage?.(message.tool_call_id, image);
        }
      }
      flush();
      this.events.usage(inputTokens, outputTokens);
      // Our controller, not the library, says whether the user stopped the run: an abort that
      // lands as the graph is finishing can complete without throwing.
      this.events.finished(controller.signal.aborted ? "stopped" : "done");
    } catch (err: any) {
      if (controller.signal.aborted) this.events.finished("stopped");
      else this.events.finished("error", err?.message ?? String(err));
    } finally {
      this.controller = undefined;
    }
  }

  stop() {
    if (!this.controller) return;
    this.controller.abort();
    this.onStop();
  }

  /** `history` is a StoredMessage[] from exportHistory; it seeds the new thread on the next send. */
  newThread(history?: unknown) {
    this.stop();
    this.threadId = randomUUID();
    this.seenToolCalls.clear();
    this.seed = Array.isArray(history) && history.length ? mapStoredMessagesToChatMessages(history as StoredMessage[]) : undefined;
  }

  /** The thread's messages, serializable (StoredMessage[]). */
  async exportHistory(): Promise<unknown> {
    // The thread is read now, before any await: a New Chat right after this call starts a new one.
    const threadId = this.threadId;
    const seed = this.seed;
    const agent: any = await this.agent();
    const state = await agent.getState({ configurable: { thread_id: threadId } });
    const messages = state?.values?.messages ?? seed ?? [];
    return messages.length ? mapChatMessagesToStoredMessages(messages) : undefined;
  }

  dispose() {
    this.stop();
  }
}
