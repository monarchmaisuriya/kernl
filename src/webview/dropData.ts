// What a drop on the panel carries. VS Code lets a drag into a webview through only while Shift is
// held (it blocks webviews during a drag otherwise). From the Explorer it carries URIs in several
// formats; from Finder or another app it carries file contents with no path (webviews can't see
// paths), which are attached as text when they are text.
import { type Attachment, MAX_ATTACHED_TEXT } from "../ui/protocol";

/** The parts of a DataTransfer a drop is read from. */
export interface DroppedData {
  getData(type: string): string;
  readonly types?: ReadonlyArray<string>;
  readonly files?: ArrayLike<File>;
}

const json = (text: string): unknown => {
  try {
    return JSON.parse(text);
  } catch {
    return undefined;
  }
};

const fileUri = (path: string) => `file://${path.split("/").map(encodeURIComponent).join("/")}`;

const uriLines = (text: string) => text.split(/\r?\n/).map((u) => u.trim()).filter((u) => u && !u.startsWith("#"));
const strings = (v: unknown) => (Array.isArray(v) ? v.filter((x): x is string => typeof x === "string" && x.length > 0) : []);

/**
 * Whether a drop is the panel's to handle: items from VS Code, files from the system, or links. A
 * plain-text drop (moving text within the composer) isn't, and keeps the browser's own behavior.
 */
export function isPanelDrop(types: ReadonlyArray<string> | undefined): boolean {
  return Array.from(types ?? []).some((t) => ["application/vnd.code.uri-list", "resourceurls", "codefiles", "text/uri-list", "files"].includes(t.toLowerCase()));
}

/**
 * Items dragged from VS Code (the Explorer, an editor tab), from the richest format it provides: its
 * own URI list (every item, folders included), then `resourceurls` (files), then `codefiles` (paths).
 */
export function vscodeUris(data: DroppedData): string[] {
  const code = uriLines(data.getData("application/vnd.code.uri-list"));
  if (code.length) return code;
  const resources = strings(json(data.getData("resourceurls")));
  if (resources.length) return resources;
  return strings(json(data.getData("codefiles"))).map(fileUri);
}

/** Links in a drop's `text/uri-list` (from a browser, say; Chromium keeps only the first of VS Code's items there). */
export function linkUris(data: DroppedData): string[] {
  return uriLines(data.getData("text/uri-list"));
}

/** Read past this many bytes and the text can't fit in an attachment anyway (4 bytes a character at most). */
const MAX_READ_BYTES = MAX_ATTACHED_TEXT * 4;
/** A NUL byte in the start of a file means it isn't text. */
const SNIFF_BYTES = 8192;

/**
 * Files dropped from outside VS Code, as text attachments named after the file. Each one that isn't
 * text, doesn't fit, or can't be read (a folder) is listed with the reason instead.
 */
export async function droppedFiles(files: ArrayLike<File>): Promise<{ attached: Attachment[]; skipped: string[] }> {
  const attached: Attachment[] = [];
  const skipped: string[] = [];
  for (const file of Array.from(files)) {
    if (file.size > MAX_READ_BYTES) {
      skipped.push(`${file.name} (over ${MAX_ATTACHED_TEXT.toLocaleString("en-US")} characters)`);
      continue;
    }
    try {
      const start = new Uint8Array(await file.slice(0, SNIFF_BYTES).arrayBuffer());
      if (start.includes(0) || file.type.startsWith("image/")) {
        skipped.push(`${file.name} (not text)`);
        continue;
      }
      const text = await file.text();
      if (text.length > MAX_ATTACHED_TEXT) skipped.push(`${file.name} (over ${MAX_ATTACHED_TEXT.toLocaleString("en-US")} characters)`);
      else attached.push({ kind: "text", path: file.name, text });
    } catch {
      // A folder dragged from Finder arrives as a File that can't be read.
      skipped.push(`${file.name} (a folder, or unreadable)`);
    }
  }
  return { attached, skipped };
}
