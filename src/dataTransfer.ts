// kernl's data (conversations and settings) as one JSON file, never with an API key. The export is
// scrubbed with every stored key and key-shaped text, then checked: a stored key that survives stops
// it. The import is validated whole before anything is written. Pure: the controller does the
// dialogs, the storage, and the settings.
import type { SessionRecord } from "./sessions";
import { PREVIEW_MAX_BYTES } from "./sessions";
import { PREVIEW_FILE } from "./ui/protocol";

export const DATA_FORMAT = "kernl-data";
export const DATA_VERSION = 1;
/** The largest file Import reads: about 100 conversations with full image previews. */
export const IMPORT_MAX_BYTES = 500 * 1024 * 1024;

export interface ExportedWorkspace {
  name: string;
  /** A worktree workspace's branch; absent for the folder itself. */
  branch?: string;
  conversations: SessionRecord[];
}

export interface ExportedFolder {
  name: string;
  workspaces: ExportedWorkspace[];
  /** Tool images by their path under the previews folder (`<session>/<file>`), base64. */
  previews: Record<string, string>;
}

export interface DataFile {
  format: typeof DATA_FORMAT;
  version: number;
  exportedAt: string;
  kernlVersion: string;
  settings: Record<string, unknown>;
  folders: ExportedFolder[];
  redacted: { storedKeys: number; keyShaped: number };
}

/** A kernl setting as the manifest declares it: its JSON type(s) and whether it belongs to one machine. */
export interface SettingSpec {
  type?: string | string[];
  /** The only values allowed, when the manifest lists them. */
  enum?: readonly unknown[];
  machine: boolean;
}

/** Every `kernl.*` setting in the extension's manifest (package.json `contributes.configuration`). */
export function settingSpecs(manifest: unknown): Map<string, SettingSpec> {
  const specs = new Map<string, SettingSpec>();
  const configuration = (manifest as { contributes?: { configuration?: unknown } })?.contributes?.configuration;
  for (const section of Array.isArray(configuration) ? configuration : configuration ? [configuration] : []) {
    for (const [key, raw] of Object.entries((section as { properties?: Record<string, { type?: string | string[]; enum?: unknown[]; scope?: string }> }).properties ?? {})) {
      // VS Code's Settings Sync leaves these scopes on their machine; so does kernl (they can hold tokens: env, headers).
      specs.set(key, { type: raw.type, ...(raw.enum ? { enum: raw.enum } : {}), machine: raw.scope === "machine" || raw.scope === "machine-overridable" });
    }
  }
  return specs;
}

/** The user's settings that an export carries: known kernl settings with a value, none of them machine-only. */
export function exportableSettings(values: Record<string, unknown>, specs: Map<string, SettingSpec>): Record<string, unknown> {
  const out: Record<string, unknown> = {};
  for (const [key, value] of Object.entries(values)) {
    const spec = specs.get(key);
    if (spec && !spec.machine && value !== undefined) out[key] = value;
  }
  return out;
}

/** Text shaped like a credential: provider keys (OpenAI and Anthropic, Google), GitHub and Slack tokens, AWS access key ids, private key blocks. */
export const KEY_SHAPES: readonly RegExp[] = [
  /\bsk-(?:ant-)?[A-Za-z0-9_-]{20,}/g,
  /\bAIza[0-9A-Za-z_-]{35}\b/g,
  /\bgh[po]_[A-Za-z0-9]{30,}/g,
  /\bgithub_pat_[A-Za-z0-9_]{22,}/g,
  /\bAKIA[0-9A-Z]{16}\b/g,
  /\bxox[bp]-[A-Za-z0-9-]{10,}/g,
  /-----BEGIN [A-Z ]*PRIVATE KEY-----[\s\S]*?-----END [A-Z ]*PRIVATE KEY-----/g,
];
const REDACTED = "[redacted]";

/** What the export needs from the redactor, which owns the stored keys. */
export interface Scrubber {
  /** Every stored key replaced with [redacted]. */
  scrub(text: string): string;
  /** Whether any stored key occurs in `text`. */
  leaks(text: string): boolean;
}

/**
 * The export file's text. Every string (and object key) is scrubbed of stored keys and key-shaped
 * text, except the images' base64, where a chance letter run could match and replacing it would
 * corrupt the image; the whole text, images included, is then checked for stored keys.
 */
export function buildExport(
  input: { kernlVersion: string; exportedAt: string; settings: Record<string, unknown>; folders: ExportedFolder[] },
  redactor: Scrubber,
): { text: string; redacted: DataFile["redacted"] } {
  const redacted = { storedKeys: 0, keyShaped: 0 };
  const count = (text: string) => text.split(REDACTED).length - 1;
  const cleanText = (text: string) => {
    const scrubbed = redactor.scrub(text);
    redacted.storedKeys += count(scrubbed) - count(text);
    let out = scrubbed;
    for (const shape of KEY_SHAPES) out = out.replace(shape, () => (redacted.keyShaped++, REDACTED));
    return out;
  };
  const clean = (value: unknown): unknown => {
    if (typeof value === "string") return cleanText(value);
    if (Array.isArray(value)) return value.map(clean);
    if (value && typeof value === "object") return Object.fromEntries(Object.entries(value).map(([k, v]) => [cleanText(k), clean(v)]));
    return value;
  };
  const doc: DataFile = {
    format: DATA_FORMAT,
    version: DATA_VERSION,
    exportedAt: input.exportedAt,
    kernlVersion: input.kernlVersion,
    settings: clean(input.settings) as Record<string, unknown>,
    folders: input.folders.map((f) => ({ name: cleanText(f.name), workspaces: clean(f.workspaces) as ExportedWorkspace[], previews: f.previews })),
    redacted,
  };
  const text = JSON.stringify(doc);
  if (redactor.leaks(text)) throw new Error("Export stopped: a stored key was still in the data. Nothing was written.");
  return { text, redacted };
}

/** A setting in the file that Import won't apply, and why. */
export interface RefusedSetting {
  key: string;
  reason: string;
}

export interface ImportDoc {
  exportedAt: string;
  kernlVersion: string;
  settings: Record<string, unknown>;
  refusedSettings: RefusedSetting[];
  folders: ExportedFolder[];
}

const SAFE_ID = /^[A-Za-z0-9_-]{1,100}$/;
const BASE64 = /^[A-Za-z0-9+/]*={0,2}$/;
const isObject = (v: unknown): v is Record<string, unknown> => !!v && typeof v === "object" && !Array.isArray(v);

/** Whether `value` has one of the manifest's JSON types (no type declared: anything). */
function hasType(value: unknown, type: string | string[] | undefined): boolean {
  if (type === undefined) return true;
  return (Array.isArray(type) ? type : [type]).some((t) =>
    t === "string" ? typeof value === "string"
    : t === "boolean" ? typeof value === "boolean"
    : t === "number" ? typeof value === "number" && Number.isFinite(value)
    : t === "integer" ? Number.isInteger(value)
    : t === "array" ? Array.isArray(value)
    : t === "object" ? isObject(value)
    : t === "null" ? value === null
    : false,
  );
}

/** A conversation as stored, or the reason it isn't one (`at` names where in the file). */
function checkConversation(raw: unknown, at: string): SessionRecord {
  if (!isObject(raw)) throw new Error(`${at} must be an object`);
  if (typeof raw.id !== "string" || !SAFE_ID.test(raw.id)) throw new Error(`${at}.id must be letters, digits, - or _ (got ${JSON.stringify(raw.id)})`);
  for (const field of ["title", "harness"]) if (typeof raw[field] !== "string") throw new Error(`${at}.${field} must be a string`);
  for (const field of ["createdAt", "updatedAt"]) if (typeof raw[field] !== "number" || !Number.isFinite(raw[field])) throw new Error(`${at}.${field} must be a number`);
  if (!Array.isArray(raw.events)) throw new Error(`${at}.events must be an array`);
  raw.events.forEach((e, i) => {
    if (!isObject(e) || typeof e.type !== "string") throw new Error(`${at}.events[${i}] must be an object with a type`);
  });
  for (const field of ["forkOf", "agentTitle"]) if (raw[field] !== undefined && typeof raw[field] !== "string") throw new Error(`${at}.${field} must be a string`);
  if (raw.archivedAt !== undefined && (typeof raw.archivedAt !== "number" || !Number.isFinite(raw.archivedAt))) throw new Error(`${at}.archivedAt must be a number`);
  if (raw.importedFrom !== undefined) throw new Error(`${at} is a CLI agent's own session (importedFrom); those stay with the agent`);
  return raw as unknown as SessionRecord;
}

/**
 * The file's content, validated whole: format, version, every conversation, every image, every
 * setting. A problem throws with where it is; nothing is half-read. Settings Import won't apply
 * (unknown, machine-only, or the wrong type) are listed, not thrown.
 */
export function parseImport(text: string, specs: Map<string, SettingSpec>): ImportDoc {
  let raw: unknown;
  try {
    raw = JSON.parse(text);
  } catch (err: any) {
    throw new Error(`Not a kernl data file: it isn't JSON (${err?.message ?? err})`);
  }
  if (!isObject(raw)) throw new Error("Not a kernl data file: expected a JSON object");
  if (raw.format !== DATA_FORMAT) throw new Error(`Not a kernl data file: format is ${JSON.stringify(raw.format)}, expected "${DATA_FORMAT}"`);
  if (!Number.isInteger(raw.version) || (raw.version as number) < 1) throw new Error(`Not a kernl data file: version is ${JSON.stringify(raw.version)}`);
  if ((raw.version as number) > DATA_VERSION) throw new Error(`This file was made by a newer kernl (data version ${raw.version}); update kernl to import it.`);
  if (!isObject(raw.settings)) throw new Error("settings must be an object");
  if (!Array.isArray(raw.folders)) throw new Error("folders must be an array");

  const settings: Record<string, unknown> = {};
  const refusedSettings: RefusedSetting[] = [];
  for (const [key, value] of Object.entries(raw.settings)) {
    const spec = specs.get(key);
    if (!spec) refusedSettings.push({ key, reason: "not a kernl setting" });
    else if (spec.machine) refusedSettings.push({ key, reason: "machine-only (it can hold tokens or start programs)" });
    else if (!hasType(value, spec.type)) refusedSettings.push({ key, reason: `expected ${[spec.type].flat().join(" or ")}` });
    else if (spec.enum && !spec.enum.includes(value)) refusedSettings.push({ key, reason: `expected one of ${spec.enum.map((v) => JSON.stringify(v)).join(", ")}` });
    else settings[key] = value;
  }

  const folders = raw.folders.map((f, fi): ExportedFolder => {
    const at = `folders[${fi}]`;
    if (!isObject(f)) throw new Error(`${at} must be an object`);
    if (typeof f.name !== "string" || !f.name) throw new Error(`${at}.name must be a non-empty string`);
    if (!Array.isArray(f.workspaces)) throw new Error(`${at}.workspaces must be an array`);
    const workspaces = f.workspaces.map((w, wi): ExportedWorkspace => {
      const wat = `${at}.workspaces[${wi}]`;
      if (!isObject(w)) throw new Error(`${wat} must be an object`);
      if (typeof w.name !== "string" || !w.name) throw new Error(`${wat}.name must be a non-empty string`);
      if (w.branch !== undefined && typeof w.branch !== "string") throw new Error(`${wat}.branch must be a string`);
      if (!Array.isArray(w.conversations)) throw new Error(`${wat}.conversations must be an array`);
      return { name: w.name, ...(w.branch !== undefined ? { branch: w.branch } : {}), conversations: w.conversations.map((c, ci) => checkConversation(c, `${wat}.conversations[${ci}]`)) };
    });
    if (!isObject(f.previews)) throw new Error(`${at}.previews must be an object`);
    for (const [path, data] of Object.entries(f.previews)) {
      if (!PREVIEW_FILE.test(path)) throw new Error(`${at}.previews has a path kernl doesn't keep images at: ${JSON.stringify(path)}`);
      if (typeof data !== "string" || !data || !BASE64.test(data)) throw new Error(`${at}.previews["${path}"] must be base64 image data`);
      if (Math.floor((data.length * 3) / 4) - (data.match(/=*$/)?.[0].length ?? 0) > PREVIEW_MAX_BYTES) throw new Error(`${at}.previews["${path}"] is larger than ${PREVIEW_MAX_BYTES} bytes`);
    }
    return { name: f.name, workspaces, previews: f.previews as Record<string, string> };
  });

  return { exportedAt: typeof raw.exportedAt === "string" ? raw.exportedAt : "", kernlVersion: typeof raw.kernlVersion === "string" ? raw.kernlVersion : "", settings, refusedSettings, folders };
}

/** An open folder an import can write to: its main workspace and its worktree workspaces, each with its storage key and the conversation ids already there. */
export interface ImportTarget {
  name: string;
  key: string;
  existing: ReadonlySet<string>;
  worktrees: { branch: string; key: string; existing: ReadonlySet<string> }[];
}

/** For each folder in the file: the index of the one open folder with its name, or undefined when none or several match (the user picks). */
export function matchFolders(doc: ImportDoc, targets: readonly ImportTarget[]): (number | undefined)[] {
  return doc.folders.map((f) => {
    const same = targets.flatMap((t, i) => (t.name === f.name ? [i] : []));
    return same.length === 1 ? same[0] : undefined;
  });
}

export interface ImportPlan {
  /** Conversations to write, each under its workspace's storage key. */
  conversations: { key: string; record: SessionRecord }[];
  /** Already here (same id): left as they are. */
  skipped: number;
  /** Images of the conversations being written. */
  previews: { path: string; data: string }[];
}

/**
 * Where each conversation goes: a folder's to the chosen open folder (`placement[i]`, undefined:
 * skipped); a worktree's to the open worktree on the same branch, or else that folder's main
 * workspace. A conversation already in its target (same id) is skipped, never overwritten.
 */
export function planImport(doc: ImportDoc, targets: readonly ImportTarget[], placement: readonly (number | undefined)[]): ImportPlan {
  const plan: ImportPlan = { conversations: [], skipped: 0, previews: [] };
  const taken = new Map<string, Set<string>>();
  doc.folders.forEach((folder, fi) => {
    const target = placement[fi] === undefined ? undefined : targets[placement[fi]!];
    if (!target) return;
    const written = new Set<string>();
    for (const ws of folder.workspaces) {
      const worktree = ws.branch !== undefined ? target.worktrees.find((w) => w.branch === ws.branch) : undefined;
      const { key, existing } = worktree ?? target;
      const here = taken.get(key) ?? new Set(existing);
      taken.set(key, here);
      for (const record of ws.conversations) {
        if (here.has(record.id)) {
          plan.skipped++;
          continue;
        }
        here.add(record.id);
        written.add(record.id);
        plan.conversations.push({ key, record });
      }
    }
    for (const [path, data] of Object.entries(folder.previews)) if (written.has(path.split("/")[0])) plan.previews.push({ path, data });
  });
  return plan;
}

/** Settings that let more run without a card: marked when an import changes them. */
export const WIDENING_SETTINGS: ReadonlySet<string> = new Set(["kernl.approvals.allow", "kernl.commandAllowList"]);

export interface SettingChange {
  key: string;
  from: unknown;
  to: unknown;
  /** It lets more run without asking. */
  widens: boolean;
}

/** A value as text with every object's keys in order, so the same content compares equal however it was written. */
function canonical(value: unknown): string {
  const sort = (v: unknown): unknown => (Array.isArray(v) ? v.map(sort) : isObject(v) ? Object.fromEntries(Object.keys(v).sort().map((k) => [k, sort(v[k])])) : v);
  return JSON.stringify(sort(value)) ?? "undefined";
}

/** The settings an import would change (equal values left out), compared with the user's current values. */
export function settingsChanges(incoming: Record<string, unknown>, current: Record<string, unknown>): SettingChange[] {
  return Object.entries(incoming)
    .filter(([key, to]) => canonical(current[key]) !== canonical(to))
    .map(([key, to]) => ({ key, from: current[key], to, widens: WIDENING_SETTINGS.has(key) }));
}
