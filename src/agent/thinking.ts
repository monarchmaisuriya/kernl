import { tool } from "@langchain/core/tools";
import { z } from "zod";
import type { ApprovalGate } from "../gate/approvalGate";
import { gatedTool } from "../gate/gatedTool";

/**
 * Sequential thinking, built in. The logic follows the Model Context Protocol reference server
 * "sequentialthinking" (github.com/modelcontextprotocol/servers, MIT License): numbered thoughts
 * that can be revised or branched, with the total adjusted as the agent goes. It has no side
 * effects, so it never asks for approval. One log per conversation.
 */
export interface Thought {
  thought: string;
  thoughtNumber: number;
  totalThoughts: number;
  nextThoughtNeeded: boolean;
  isRevision?: boolean;
  revisesThought?: number;
  branchFromThought?: number;
  branchId?: string;
  needsMoreThoughts?: boolean;
}

export class ThinkingLog {
  private history: Thought[] = [];
  private branches = new Map<string, Thought[]>();

  /** Records a thought; returns what the reference server returns. */
  process(input: Thought) {
    const t = { ...input, totalThoughts: Math.max(input.totalThoughts, input.thoughtNumber) };
    this.history.push(t);
    if (t.branchFromThought && t.branchId) this.branches.set(t.branchId, [...(this.branches.get(t.branchId) ?? []), t]);
    return {
      thoughtNumber: t.thoughtNumber,
      totalThoughts: t.totalThoughts,
      nextThoughtNeeded: t.nextThoughtNeeded,
      branches: [...this.branches.keys()],
      thoughtHistoryLength: this.history.length,
    };
  }

  reset() {
    this.history = [];
    this.branches.clear();
  }
}

// Models sometimes send numbers and booleans as strings; accept those like the reference server does.
// (The schema stays transform-free so it can be shown to the model as JSON Schema; values are normalized below.)
const bool = z.union([z.boolean(), z.enum(["true", "false"])]);
const count = z.union([z.number().int().min(1), z.string().regex(/^\d+$/)]);
const toBool = (v: unknown) => (v === undefined ? undefined : v === true || v === "true");
const toCount = (v: unknown) => (v === undefined ? undefined : Number(v));

function normalize(raw: Record<string, unknown>): Thought {
  return {
    thought: String(raw.thought),
    thoughtNumber: toCount(raw.thoughtNumber)!,
    totalThoughts: toCount(raw.totalThoughts)!,
    nextThoughtNeeded: toBool(raw.nextThoughtNeeded)!,
    isRevision: toBool(raw.isRevision),
    revisesThought: toCount(raw.revisesThought),
    branchFromThought: toCount(raw.branchFromThought),
    branchId: raw.branchId === undefined ? undefined : String(raw.branchId),
    needsMoreThoughts: toBool(raw.needsMoreThoughts),
  };
}

export const THINKING_TOOL = "sequential_thinking";

const DESCRIPTION = [
  "Think through a problem step by step before acting, when the task is complex, the approach is unclear, or a plan may need revising.",
  "Each call records one numbered thought. Estimate totalThoughts and adjust it as you go; you may go past it.",
  "You can revise an earlier thought (isRevision, revisesThought) or explore an alternative (branchFromThought, branchId).",
  "Set nextThoughtNeeded to false only when you have a hypothesis you've checked against your reasoning; then act on it.",
  "Thoughts are shown to the user; they don't change any files.",
].join(" ");

export function thinkingTool(log: ThinkingLog, gate: ApprovalGate) {
  const inner = tool(async (input: Record<string, unknown>) => JSON.stringify(log.process(normalize(input)), null, 2), {
    name: THINKING_TOOL,
    description: DESCRIPTION,
    schema: z.object({
      thought: z.string().describe("Your current thinking step"),
      nextThoughtNeeded: bool.describe("Whether another thought step is needed"),
      thoughtNumber: count.describe("Current thought number, from 1"),
      totalThoughts: count.describe("Estimated total thoughts needed"),
      isRevision: bool.optional().describe("Whether this revises previous thinking"),
      revisesThought: count.optional().describe("Which thought is being reconsidered"),
      branchFromThought: count.optional().describe("Which thought this branches from"),
      branchId: z.string().optional().describe("Identifier of this branch"),
      needsMoreThoughts: bool.optional().describe("Reached the end but more thoughts are needed"),
    }) as any,
  });
  return gatedTool(inner as any, gate, "allow");
}
