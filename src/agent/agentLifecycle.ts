import type { BuiltAgent } from "./createAgent";

/** What a build produces: the agent and how to release what it opened (MCP server processes). */
export interface BuiltParts {
  agent: BuiltAgent;
  close: () => Promise<void>;
}

/**
 * Owns the one current agent. Concurrent get() calls share a single build. invalidate() is the
 * only place resources are closed: it closes the current build, including one still starting,
 * whose get() then fails instead of handing out a closed agent. No MCP process is orphaned or closed twice.
 */
export class AgentLifecycle {
  private current: Promise<BuiltParts> | undefined;
  private generation = 0;

  constructor(private build: () => Promise<BuiltParts>) {}

  async get(): Promise<BuiltAgent> {
    if (!this.current) {
      const generation = this.generation;
      const building = this.build();
      this.current = building;
      building.catch(() => {
        if (this.current === building) this.current = undefined;
      });
      const parts = await building;
      // invalidate() owns closing; it awaited this same build and closed it.
      if (generation !== this.generation) throw new Error("Settings changed while the agent was starting; send the message again");
      return parts.agent;
    }
    return (await this.current).agent;
  }

  async invalidate(): Promise<void> {
    this.generation++;
    const previous = this.current;
    this.current = undefined;
    const parts = await previous?.catch(() => undefined);
    await parts?.close();
  }
}
