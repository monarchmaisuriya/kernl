// Settings that run programs, skip approvals, or choose where keys are sent must come from the
// user, never from a workspace's .vscode/settings.json, and are restricted in untrusted workspaces.
import { strict as assert } from "node:assert";
import { readFileSync } from "node:fs";
import { resolve } from "node:path";
import { test } from "node:test";

const pkg = JSON.parse(readFileSync(resolve(__dirname, "../../package.json"), "utf8"));
const properties: Record<string, any> = Object.assign({}, ...pkg.contributes.configuration.map((c: any) => c.properties));
const USER_ONLY = ["kernl.customProviders", "kernl.baseUrl", "kernl.commandAllowList", "kernl.approvals.allow", "kernl.approvals.ask", "kernl.approvals.deny", "kernl.mcpServers", "kernl.agentCommands"];

test("settings that run programs, skip cards, or pick endpoints are user-level only and restricted", () => {
  for (const key of USER_ONLY) {
    assert.ok(["application", "machine"].includes(properties[key]?.scope), `${key} has scope ${properties[key]?.scope}`);
    assert.ok(pkg.capabilities.untrustedWorkspaces.restrictedConfigurations.includes(key), `${key} is not restricted`);
  }
});

test("every setting sits in a titled, ordered category with a description", () => {
  for (const category of pkg.contributes.configuration) {
    assert.ok(category.title && typeof category.order === "number", JSON.stringify(category.title));
    for (const [key, v] of Object.entries<any>(category.properties)) assert.ok(v.markdownDescription || v.description, `${key} has no description`);
  }
});

test("commands have plain titles; the kernl prefix comes from the category (Command Palette only)", () => {
  for (const c of pkg.contributes.commands) {
    assert.equal(c.category, "kernl", c.command);
    assert.doesNotMatch(c.title, /^kernl/, c.command);
  }
});
