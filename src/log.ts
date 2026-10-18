/** Replaces every occurrence of each secret in `text` with [redacted]. Secrets shorter than 8 chars are ignored. */
export function redact(text: string, secrets: Iterable<string>): string {
  let out = text;
  for (const secret of secrets) {
    if (secret.length < 8) continue;
    out = out.split(secret).join("[redacted]");
  }
  return out;
}

/**
 * The one place log lines and webview messages are scrubbed. Every API key the extension
 * loads is registered here, and every outgoing string passes through scrub().
 */
export class Redactor {
  private secrets = new Set<string>();
  register(secret: string | undefined) {
    if (secret) this.secrets.add(secret);
  }
  forget(secret: string | undefined) {
    if (secret) this.secrets.delete(secret);
  }
  scrub(text: string): string {
    return redact(text, this.secrets);
  }
}

export interface LineSink {
  appendLine(line: string): void;
}

export class Logger {
  constructor(private sink: LineSink, private redactor: Redactor) {}
  info(message: string) {
    this.sink.appendLine(`[${new Date().toISOString()}] ${this.redactor.scrub(message)}`);
  }
  error(message: string, err?: unknown) {
    const detail = err instanceof Error ? `${err.name}: ${err.message}` : err === undefined ? "" : String(err);
    this.info(`ERROR ${message}${detail ? ` - ${detail}` : ""}`);
  }
}
