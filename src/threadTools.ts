// read_thread: an agent reads more of a conversation the user tagged in this one (the message carries an
// excerpt with an outline; this fetches any turns, or the turns that mention some words). Reading
// doesn't ask, like reading a file; only threads tagged in the conversation can be read, and the text is
// scrubbed and marked untrusted (see WorkspaceRuntime.readThread).
import { tool } from "@langchain/core/tools";
import { z } from "zod";
import type { ApprovalGate } from "./gate/approvalGate";
import { gatedTool } from "./gate/gatedTool";

export function readThreadTool(gate: ApprovalGate, read: (thread: string, ask: { turns?: string; search?: string }) => Promise<string>) {
  const readThread = tool(async ({ thread, turns, search }: { thread: string; turns?: string; search?: string }) => read(thread, { turns, search }), {
    name: "read_thread",
    description:
      "Read more of a conversation the user tagged in this one (its excerpt names its thread handle and outlines its turns): the turns asked for (\"7\" or \"4-9\"), or the turns that mention some words. Without turns or search, it reads from the start. Up to 30,000 characters per call; it says where to read on.",
    schema: z.object({
      thread: z.string().describe("The thread handle from the tagged conversation's excerpt"),
      turns: z.string().optional().describe('Turn numbers from the outline: "7" or "4-9"'),
      search: z.string().optional().describe("Words a turn must contain (all of them), when the turn numbers aren't known"),
    }) as any,
  });
  return gatedTool(readThread, gate, "allow");
}
