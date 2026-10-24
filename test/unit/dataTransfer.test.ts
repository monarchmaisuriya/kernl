// Export and import of kernl's data: an export never carries a stored key or key-shaped text (and stops
// if a stored key survives), machine-only settings stay behind, and an import is validated whole and
// lands conversations in the right folder without overwriting any.
import { strict as assert } from "node:assert";
import { readFileSync } from "node:fs";
import { resolve } from "node:path";
import { test } from "node:test";
import {
  buildExport,
  DATA_VERSION,
  type ExportedFolder,
  exportableSettings,
  type ImportTarget,
  matchFolders,
  parseImport,
  planImport,
  type Scrubber,
  settingSpecs,
  settingsChanges,
} from "../../src/dataTransfer";
import { redact } from "../../src/log";
import type { SessionRecord } from "../../src/sessions";

const specs = settingSpecs(JSON.parse(readFileSync(resolve(__dirname, "../../package.json"), "utf8")));
const KEY = "sk-ant-api03-STOREDKEY0123456789abcdef";
const scrubber = (keys: string[]): Scrubber => ({ scrub: (t) => redact(t, keys), leaks: (t) => keys.some((k) => t.includes(k)) });
const conversation = (id: string, text: string, extra: Partial<SessionRecord> = {}): SessionRecord => ({
  id,
  title: text.slice(0, 20),
  harness: "deepagents",
  createdAt: 1,
  updatedAt: 2,
  events: [{ type: "userMessage", workspace: "main", text }] as SessionRecord["events"],
  ...extra,
});
const folder = (name: string, workspaces: ExportedFolder["workspaces"], previews: Record<string, string> = {}): ExportedFolder => ({ name, workspaces, previews });
const exported = (folders: ExportedFolder[], settings: Record<string, unknown> = {}, keys: string[] = []) =>
  buildExport({ kernlVersion: "0.11.0", exportedAt: "2026-10-21T09:30:00.000Z", settings, folders }, scrubber(keys));

test("settings: an export carries the user's kernl settings, never the machine-only ones (they can hold tokens)", () => {
  assert.equal(specs.get("kernl.mcpServers")?.machine, true);
  assert.equal(specs.get("kernl.agentCommands")?.machine, true);
  const out = exportableSettings({ "kernl.model": "m", "kernl.mcpServers": { gh: { url: "x", headers: { Authorization: "Bearer t" } } }, "kernl.agentCommands": { codex: { command: "c", env: { TOKEN: "t" } } }, "other.setting": 1, "kernl.tabs.max": undefined }, specs);
  assert.deepEqual(out, { "kernl.model": "m" });
});

test("export: stored keys and key-shaped text become [redacted] everywhere (transcript, history, settings, object keys), counted; images untouched", () => {
  const gh = `ghp_${"a".repeat(36)}`;
  const aws = "AKIAABCDEFGHIJKLMNOP";
  const pem = "-----BEGIN RSA PRIVATE KEY-----\nMIIabc\n-----END RSA PRIVATE KEY-----";
  const google = `AIza${"G".repeat(35)}`;
  const image = "QUtJQUFCQ0RFRkdISUpLTE1OT1A="; // base64 that decodes to an AKIA-shaped string: left alone
  const record = conversation("c1", `my key is ${KEY} and ${gh} and ${google}`, { history: [{ content: `env: ${aws}\n${pem}`, [KEY]: 1 }] });
  const { text, redacted } = exported([folder("kernl", [{ name: "Main", conversations: [record] }], { "c1/i-1.png": image })], { "kernl.model": `x ${KEY}` }, [KEY]);
  assert.ok(!text.includes(KEY) && !text.includes(gh) && !text.includes(google) && !text.includes(aws) && !text.includes("BEGIN RSA PRIVATE KEY"), text);
  assert.deepEqual(redacted, { storedKeys: 3, keyShaped: 4 });
  const doc = JSON.parse(text);
  assert.equal(doc.folders[0].previews["c1/i-1.png"], image, "image data is never rewritten");
  assert.equal(doc.settings["kernl.model"], "x [redacted]");
});

test("export: near misses stay as they are (no false redactions in ordinary text and code)", () => {
  const plain = "task-runner sk-short AKIA123 ghp_short github_pat_x xoxb-1 AIzaShort disk-0123456789012345678901234";
  const { text, redacted } = exported([folder("kernl", [{ name: "Main", conversations: [conversation("c1", plain)] }])]);
  assert.equal(JSON.parse(text).folders[0].workspaces[0].conversations[0].events[0].text, plain);
  assert.deepEqual(redacted, { storedKeys: 0, keyShaped: 0 });
});

test("export: a stored key that survives the scrub stops the export (nothing to write)", () => {
  const missing: Scrubber = { scrub: (t) => t, leaks: (t) => t.includes(KEY) };
  assert.throws(
    () => buildExport({ kernlVersion: "0.11.0", exportedAt: "", settings: {}, folders: [folder("kernl", [{ name: "Main", conversations: [conversation("c1", `x${KEY}x`)] }])] }, missing),
    /Export stopped: a stored key was still in the data\. Nothing was written\./,
  );
});

test("import: an export reads back whole; settings Import won't apply are listed with why", () => {
  const { text } = exported([folder("kernl", [{ name: "Main", conversations: [conversation("c1", "hi")] }, { name: "ui-ws", branch: "kernl/ui-ws", conversations: [] }], { "c1/i-1.png": "aGk=" })], { "kernl.model": "m" });
  const doc = JSON.parse(text);
  doc.settings["kernl.mcpServers"] = {};
  doc.settings["kernl.tabs.max"] = "eight";
  doc.settings["kernl.thinkingDisplay"] = "bogus";
  doc.settings["other.thing"] = 1;
  const parsed = parseImport(JSON.stringify(doc), specs);
  assert.deepEqual(parsed.settings, { "kernl.model": "m" });
  assert.deepEqual(parsed.refusedSettings.map((r) => r.key), ["kernl.mcpServers", "kernl.tabs.max", "kernl.thinkingDisplay", "other.thing"]);
  assert.match(parsed.refusedSettings[0].reason, /machine-only/);
  assert.equal(parsed.refusedSettings[2].reason, 'expected one of "auto", "collapsed", "expanded"', "a value outside the setting's list is refused");
  assert.equal(parsed.folders[0].workspaces[1].branch, "kernl/ui-ws");
  assert.equal(parsed.folders[0].workspaces[0].conversations[0].id, "c1");
});

test("import: a bad file stops with what and where, before anything is written", () => {
  const good = () => JSON.parse(exported([folder("kernl", [{ name: "Main", conversations: [conversation("c1", "hi")] }])]).text);
  const bad = (change: (d: any) => void) => {
    const d = good();
    change(d);
    return JSON.stringify(d);
  };
  assert.throws(() => parseImport("{nope", specs), /Not a kernl data file: it isn't JSON/);
  assert.throws(() => parseImport(bad((d) => (d.format = "other")), specs), /format is "other"/);
  assert.throws(() => parseImport(bad((d) => (d.version = DATA_VERSION + 1)), specs), /made by a newer kernl \(data version 2\); update kernl/);
  assert.throws(() => parseImport(bad((d) => (d.folders[0].workspaces[0].conversations[0].id = "../x")), specs), /folders\[0\]\.workspaces\[0\]\.conversations\[0\]\.id must be/);
  assert.throws(() => parseImport(bad((d) => (d.folders[0].workspaces[0].conversations[0].events = "x")), specs), /conversations\[0\]\.events must be an array/);
  assert.throws(() => parseImport(bad((d) => (d.folders[0].workspaces[0].conversations[0].importedFrom = { agent: "codex", sessionId: "s" })), specs), /CLI agent's own session/);
  assert.throws(() => parseImport(bad((d) => (d.folders[0].workspaces[0].conversations[0].archivedAt = "yesterday")), specs), /conversations\[0\]\.archivedAt must be a number/);
  assert.throws(() => parseImport(bad((d) => (d.folders[0].previews = { "../../etc/x.png": "aGk=" })), specs), /a path kernl doesn't keep images at/);
  assert.throws(() => parseImport(bad((d) => (d.folders[0].previews = { "c1/i-1.png": "not base64!" })), specs), /must be base64 image data/);
  assert.throws(() => parseImport(bad((d) => (d.folders[0].previews = { "c1/i-1.png": "" })), specs), /must be base64 image data/);
  assert.throws(() => parseImport(bad((d) => (d.folders[0].previews = { "c1/i-1.png": "A".repeat(8 * 1024 * 1024) })), specs), /larger than 5242880 bytes/);
});

test("import: a folder goes to the one open folder with its name; none or several means the user picks", () => {
  const target = (name: string): ImportTarget => ({ name, key: name, existing: new Set(), worktrees: [] });
  const doc = parseImport(exported([folder("kernl", []), folder("api", []), folder("web", [])]).text, specs);
  assert.deepEqual(matchFolders(doc, [target("kernl"), target("web"), target("web")]), [0, undefined, undefined]);
});

test("import: worktree conversations go to the worktree on the same branch, else the folder; existing ids are skipped, never overwritten", () => {
  const doc = parseImport(
    exported([
      folder(
        "kernl",
        [
          { name: "Main", conversations: [conversation("a", "1"), conversation("here", "2")] },
          { name: "ui-ws", branch: "kernl/ui-ws", conversations: [conversation("b", "3")] },
          { name: "gone", branch: "kernl/gone", conversations: [conversation("c", "4"), conversation("a", "dup")] },
        ],
        { "a/i-1.png": "aGk=", "here/i-2.png": "aGk=", "b/i-3.png": "aGk=" },
      ),
      folder("other", [{ name: "Main", conversations: [conversation("d", "5")] }]),
    ]).text,
    specs,
  );
  const target: ImportTarget = { name: "kernl", key: "K", existing: new Set(["here"]), worktrees: [{ branch: "kernl/ui-ws", key: "W", existing: new Set() }] };
  const plan = planImport(doc, [target], [0, undefined]);
  assert.deepEqual(plan.conversations.map((c) => `${c.key}:${c.record.id}`), ["K:a", "W:b", "K:c"], "the folder that wasn't placed is skipped");
  assert.equal(plan.skipped, 2, "'here' already exists; 'a' appears twice in the same folder");
  assert.deepEqual(plan.previews.map((p) => p.path), ["a/i-1.png", "b/i-3.png"], "only images of conversations being written");
});

test("settings changes: equal values left out (the same object with its keys in another order too); settings that let more run without asking are marked", () => {
  const changes = settingsChanges(
    { "kernl.model": "m", "kernl.tabs.max": 4, "kernl.approvals.allow": ["run(npm test)"], "kernl.modelProfiles": { "a/b": { temperature: 0, maxOutputTokens: 9 } } },
    { "kernl.model": "m", "kernl.tabs.max": 8, "kernl.modelProfiles": { "a/b": { maxOutputTokens: 9, temperature: 0 } } },
  );
  assert.deepEqual(changes, [
    { key: "kernl.tabs.max", from: 8, to: 4, widens: false },
    { key: "kernl.approvals.allow", from: undefined, to: ["run(npm test)"], widens: true },
  ]);
});
