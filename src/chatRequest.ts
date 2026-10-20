// "@kernl" in VS Code's own chat (the chat the title bar's chat button opens): the request, and the
// files it references, go to kernl's panel exactly as if typed there (same send path, queued while the
// agent runs). The work, approvals, and reply stay in the panel, where the diffs and checkpoints are.

export interface ChatForwarding {
  /** Sends to the shown kernl workspace, or runs one of kernl's own commands there; says where it went, or why it couldn't. */
  forward(text: string, files: readonly string[]): Promise<{ workspace: string; agent: string; queued: boolean } | { workspace: string; ran: string } | { error: string }>;
}

/** The parts of a chat request and response stream the handler uses (so tests can pass fakes). */
export interface ChatRequestLike {
  prompt: string;
  /** One of kernl's commands picked in VS Code's chat (`@kernl /new`): the prompt is then what follows it. */
  command?: string;
  references: readonly { value: unknown }[];
}
export interface ChatStreamLike {
  markdown(text: string): void;
  button(command: { command: string; title: string }): void;
}

/** A URI as the chat API gives it (vscode.Uri), by its shape. */
type UriLike = { scheme: string; toString(): string };
const isUri = (v: any): v is UriLike => typeof v?.scheme === "string" && typeof v?.fsPath === "string";

/** The file URIs a request references (`#file`, a selection's file), as strings; other references are left out. */
export function referencedFiles(references: ChatRequestLike["references"]): string[] {
  const uris = references.map((r) => {
    const v = r.value as any;
    if (isUri(v)) return v;
    if (isUri(v?.uri)) return v.uri; // a Location
    return undefined;
  });
  return [...new Set(uris.filter((u): u is UriLike => !!u && u.scheme === "file").map((u) => u.toString()))];
}

export async function handleKernlRequest(request: ChatRequestLike, stream: ChatStreamLike, forwarding: ChatForwarding): Promise<void> {
  const text = (request.command ? `/${request.command} ${request.prompt}` : request.prompt).trim();
  if (!text) {
    stream.markdown("Tell kernl what to do, for example `@kernl fix the failing test`. It goes to the kernl panel.");
    stream.button({ command: "kernl.open", title: "Open kernl" });
    return;
  }
  const result = await forwarding.forward(text, referencedFiles(request.references));
  if ("error" in result) {
    stream.markdown(`kernl couldn't take this: ${result.error}`);
  } else if ("ran" in result) {
    stream.markdown(`Ran kernl's **/${result.ran}** in **${result.workspace}**.`);
  } else {
    stream.markdown(`${result.queued ? "Queued in" : "Sent to"} kernl: **${result.agent}** in **${result.workspace}**. The work and any approvals are in the kernl panel.`);
  }
  stream.button({ command: "kernl.open", title: "Open kernl" });
}
