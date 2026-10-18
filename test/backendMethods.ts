// Upgrade guard: GatedBackend gates exactly FilesystemBackend's disk-mutating methods. If a Deep
// Agents upgrade adds a new one, this fails until GatedBackend overrides it too.
import { FilesystemBackend } from "deepagents";
import { GatedBackend } from "../src/backend/gatedBackend";

const KNOWN_READS = new Set(["constructor", "resolvePath", "assertRealPathWithinRoot", "resolveRealPath", "resolveDeletePath", "ls", "read", "readRaw", "grep", "ripgrepSearch", "literalSearch", "glob", "downloadFiles"]);
const GATED = new Set(["write", "edit", "delete", "uploadFiles"]);

const methods = Object.getOwnPropertyNames(FilesystemBackend.prototype);
const unknown = methods.filter((m) => !KNOWN_READS.has(m) && !GATED.has(m));
const notOverridden = [...GATED].filter((m) => !Object.getOwnPropertyNames(GatedBackend.prototype).includes(m));

if (unknown.length || notOverridden.length) {
  console.error(`FAIL  FilesystemBackend changed. New methods to classify (read or mutating): ${unknown.join(", ") || "none"}. Mutating methods GatedBackend does not override: ${notOverridden.join(", ") || "none"}.`);
  process.exit(1);
}
console.log(`PASS  FilesystemBackend methods unchanged (${methods.length}); all ${GATED.size} mutating methods are gated`);
