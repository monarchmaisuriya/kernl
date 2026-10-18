import { relative, sep } from "node:path";
import * as vscode from "vscode";
import type { Attachment } from "./ui/protocol";

/** Folders nobody wants to attach by accident; files.exclude (e.g. .git) applies on top. */
const SKIP = "**/{node_modules,.git,out,dist,build,.next,.venv}/**";

/** A path inside `root` as an attachment, or undefined when it's outside (attachments are workspace paths). */
export function toAttachment(root: string, fsPath: string, kind: Attachment["kind"]): Attachment | undefined {
  const rel = relative(root, fsPath);
  if (!rel || rel.startsWith("..") || rel.includes(`..${sep}`)) return undefined;
  return { path: rel.split(sep).join("/"), kind };
}

async function isFolder(uri: vscode.Uri): Promise<boolean> {
  try {
    return ((await vscode.workspace.fs.stat(uri)).type & vscode.FileType.Directory) !== 0;
  } catch {
    return false;
  }
}

/** Resolves file: URIs (a drop, the Explorer) to attachments; anything outside the workspace is returned separately. */
export async function resolveUris(root: string, uris: string[]): Promise<{ attachments: Attachment[]; outside: string[] }> {
  const attachments: Attachment[] = [];
  const outside: string[] = [];
  for (const raw of uris) {
    let uri: vscode.Uri;
    try {
      uri = vscode.Uri.parse(raw, true);
    } catch {
      continue;
    }
    if (uri.scheme !== "file") continue;
    const a = toAttachment(root, uri.fsPath, (await isFolder(uri)) ? "folder" : "file");
    if (a) attachments.push(a);
    else outside.push(uri.fsPath);
  }
  return { attachments, outside };
}

/** Workspace files and folders whose path contains `query` (case-insensitive), best matches first. */
export async function searchWorkspace(root: string, query: string, limit = 30): Promise<Attachment[]> {
  const q = query.replace(/[{}[\]*?\\]/g, "").trim();
  const base = vscode.Uri.file(root);
  const files = await vscode.workspace.findFiles(new vscode.RelativePattern(base, q ? `**/*${q}*` : "**/*"), SKIP, 200);
  const nested = q ? await vscode.workspace.findFiles(new vscode.RelativePattern(base, `**/*${q}*/**`), SKIP, 200) : [];
  const out = new Map<string, Attachment>();
  for (const f of files) {
    const a = toAttachment(root, f.fsPath, "file");
    if (a) out.set(`file:${a.path}`, a);
  }
  // Folders: the deepest folder on each nested match's path whose name contains the query.
  const needle = q.toLowerCase();
  for (const f of [...files, ...nested]) {
    const a = toAttachment(root, f.fsPath, "file");
    if (!a) continue;
    const parts = a.path.split("/").slice(0, -1);
    for (let i = parts.length; i > 0; i--) {
      if (!needle || parts[i - 1].toLowerCase().includes(needle)) {
        const folder = parts.slice(0, i).join("/");
        out.set(`folder:${folder}`, { path: folder, kind: "folder" });
        break;
      }
    }
  }
  const score = (a: Attachment) => {
    const name = a.path.split("/").pop()!.toLowerCase();
    return (name.startsWith(needle) ? 0 : name.includes(needle) ? 1 : 2) * 1000 + a.path.length;
  };
  return [...out.values()].sort((a, b) => score(a) - score(b)).slice(0, limit);
}
