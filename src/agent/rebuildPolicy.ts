/** Something outside a workspace changed that may affect how its agent is built. */
export type InputChange =
  /** yourstack settings changed; `affects` is VS Code's ConfigurationChangeEvent.affectsConfiguration. */
  | { kind: "settings"; affects: (section: string) => boolean; mainHarness: string }
  /** An API key was stored or cleared; `harnesses` are the agents that read it ("deepagents" for provider keys). */
  | { kind: "keys"; harnesses: string[] }
  /** The workspace became trusted (Restricted Mode ended). */
  | { kind: "trust" }
  /** An instruction or agent file changed (AGENTS.md, .yourstack/, ~/.yourstack/). */
  | { kind: "customisation" };

export interface RuntimeShape {
  harness: string;
  isMain: boolean;
}

// The inputs each harness is built from. Approval rules are read live by the gate, so they need no rebuild.
const DEEP_AGENTS_SETTINGS = ["yourstack.provider", "yourstack.model", "yourstack.baseUrl", "yourstack.customProviders", "yourstack.modelOptions", "yourstack.sequentialThinking", "yourstack.mcpServers"];

/** Named agents (`deepagents:<name>`) are built by the Deep Agents harness and depend on the same inputs. */
const family = (harness: string) => (harness.startsWith("deepagents:") ? "deepagents" : harness);

/** Whether this change alters the inputs this workspace's agent was built from. Unrelated workspaces are untouched. */
export function needsRebuild(ws: RuntimeShape, change: InputChange): boolean {
  const harness = family(ws.harness);
  switch (change.kind) {
    case "trust":
      return true;
    case "customisation":
      return harness === "deepagents";
    case "keys":
      return change.harnesses.includes(harness);
    case "settings":
      if (ws.isMain && change.affects("yourstack.harness") && change.mainHarness !== ws.harness) return true;
      if (harness === "deepagents") return DEEP_AGENTS_SETTINGS.some((s) => change.affects(s));
      return change.affects("yourstack.agentCommands");
  }
}
