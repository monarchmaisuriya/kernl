// Test-only ACP agent over stdio. FAKE_SCENARIO picks behavior; FAKE_LOG receives one line per
// notable event so tests can check what the agent saw and did.
//   write        asks to write hello.txt (with a diff); writes it only on allow_once
//   stuck-mode   reports mode "auto" no matter what it is set to
//   session-mode has no config options; confirms set_mode with a current_mode_update
//   crash        exits with code 3 during the prompt
//   cancel-on-reject  like write, but ends the turn as "cancelled" after a rejection (OpenCode does this)
// FAKE_LOAD=1 advertises session/load; loading replays one old message (the client must drop it).
// FAKE_FORK=1 advertises session/fork (unstable); a fork is "<id>-fork".
import { appendFileSync, writeFileSync } from "node:fs";
import { join } from "node:path";
import { Readable, Writable } from "node:stream";
import * as acp from "@agentclientprotocol/sdk";

const scenario = process.env.FAKE_SCENARIO ?? "write";
const log = (line: string) => process.env.FAKE_LOG && appendFileSync(process.env.FAKE_LOG, `${line}\n`);
let cwd = process.cwd();
let mode = "auto";
/** Set by session/cancel during the current prompt turn. */
let cancelled = false;
let sessionCount = 0;

const modeOption = () => ({ id: "mode", name: "Mode", type: "select", currentValue: mode, options: [{ value: "default", name: "Manual" }, { value: "auto", name: "Auto" }] });

new acp.AgentSideConnection((conn) => ({
  async initialize() {
    return { protocolVersion: acp.PROTOCOL_VERSION, agentCapabilities: { loadSession: process.env.FAKE_LOAD === "1", sessionCapabilities: process.env.FAKE_FORK === "1" ? { fork: {} } : {} }, authMethods: [] };
  },
  async newSession(p: any) {
    cwd = p.cwd;
    log(`newSession cwd=${cwd}`);
    sessionCount++;
    if (scenario === "session-mode") return { sessionId: `s${sessionCount}`, modes: { currentModeId: "auto", availableModes: [{ id: "auto", name: "Auto" }, { id: "read-only", name: "Read-only" }] } };
    return { sessionId: `s${sessionCount}`, configOptions: [modeOption()] } as any;
  },
  async unstable_forkSession(p: any) {
    log(`forkSession ${p.sessionId}`);
    return { sessionId: `${p.sessionId}-fork`, configOptions: [modeOption()] } as any;
  },
  async loadSession(p: any) {
    cwd = p.cwd;
    log(`loadSession ${p.sessionId}`);
    await conn.sessionUpdate({ sessionId: p.sessionId, update: { sessionUpdate: "agent_message_chunk", content: { type: "text", text: "REPLAYED-OLD-MESSAGE" } } as any });
    return { configOptions: [modeOption()] } as any;
  },
  async setSessionConfigOption(p: any) {
    log(`setConfig ${p.configId}=${p.value}`);
    if (scenario !== "stuck-mode") mode = p.value;
    return { configOptions: [modeOption()] } as any;
  },
  async setSessionMode(p: any) {
    log(`setMode ${p.modeId}`);
    await conn.sessionUpdate({ sessionId: p.sessionId, update: { sessionUpdate: "current_mode_update", currentModeId: p.modeId } as any });
    return {};
  },
  async authenticate() {
    return {};
  },
  async closeSession(p: any) {
    log(`closeSession ${p.sessionId}`);
    return {};
  },
  async cancel() {
    cancelled = true;
    log("cancel");
  },
  async prompt(p: any) {
    log("prompt");
    // A cancel ends only the turn it arrived in (ACP session/cancel), not later ones.
    cancelled = false;
    const sessionId = p.sessionId;
    // With a stored credential, echo what the launch env carried, so tests can see it arrive (and be redacted).
    const links = (p.prompt ?? []).filter((b: any) => b.type === "resource_link").map((b: any) => b.name);
    const attached = links.length ? ` [links: ${links.join(", ")}]` : "";
    const credential = process.env.ANTHROPIC_API_KEY ? ` [env ANTHROPIC_API_KEY=${process.env.ANTHROPIC_API_KEY} ANTHROPIC_BASE_URL=${process.env.ANTHROPIC_BASE_URL ?? "unset"} CLAUDE_CONFIG_DIR=${process.env.CLAUDE_CONFIG_DIR ?? "unset"}]` : "";
    await conn.sessionUpdate({ sessionId, update: { sessionUpdate: "agent_message_chunk", content: { type: "text", text: `hello from fake${credential}${attached}` } } as any });
    if (scenario === "crash") {
      process.stderr.write("fake agent: boom\n");
      process.exit(3);
    }
    const path = join(cwd, "hello.txt");
    await conn.sessionUpdate({ sessionId, update: { sessionUpdate: "tool_call", toolCallId: "t1", title: "Write hello.txt", kind: "edit", status: "pending" } as any });
    const answer: any = await conn.requestPermission({
      sessionId,
      toolCall: { toolCallId: "t1", title: "Write hello.txt", kind: "edit", locations: [{ path }], content: [{ type: "diff", path, oldText: null, newText: "hi\n" }] } as any,
      options: [
        { optionId: "yes", name: "Allow", kind: "allow_once" },
        { optionId: "always", name: "Always allow", kind: "allow_always" },
        { optionId: "no", name: "Reject", kind: "reject_once" },
      ],
    });
    log(`permission ${answer.outcome.outcome}${answer.outcome.optionId ? `:${answer.outcome.optionId}` : ""}`);
    if (answer.outcome.outcome === "selected" && answer.outcome.optionId === "yes") {
      writeFileSync(path, "hi\n");
      await conn.sessionUpdate({ sessionId, update: { sessionUpdate: "tool_call_update", toolCallId: "t1", status: "completed", content: [{ type: "content", content: { type: "text", text: "wrote hello.txt" } }] } as any });
    } else {
      await conn.sessionUpdate({ sessionId, update: { sessionUpdate: "tool_call_update", toolCallId: "t1", status: "failed", content: [{ type: "content", content: { type: "text", text: "not allowed" } }] } as any });
    }
    const rejected = answer.outcome.outcome === "selected" && answer.outcome.optionId !== "yes";
    return { stopReason: cancelled || answer.outcome.outcome === "cancelled" || (scenario === "cancel-on-reject" && rejected) ? "cancelled" : "end_turn" };
  },
}) as any, acp.ndJsonStream(Writable.toWeb(process.stdout) as WritableStream<Uint8Array>, Readable.toWeb(process.stdin) as ReadableStream<Uint8Array>));
