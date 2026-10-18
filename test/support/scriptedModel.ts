import { BaseChatModel } from "@langchain/core/language_models/chat_models";
import { AIMessage, type BaseMessage } from "@langchain/core/messages";
import type { ChatResult } from "@langchain/core/outputs";

/** A chat model that replays fixed replies, so tests need no API key or network. */
export class ScriptedChatModel extends BaseChatModel {
  constructor(private script: AIMessage[]) {
    super({});
  }
  _llmType() {
    return "scripted";
  }
  bindTools(): any {
    return this;
  }
  async _generate(_messages: BaseMessage[]): Promise<ChatResult> {
    const next = this.script.shift() ?? new AIMessage("done");
    return { generations: [{ message: next, text: String(next.content) }] };
  }
}
