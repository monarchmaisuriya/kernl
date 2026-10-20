// The panel's colors come from one block of roles at the top of media/panel.css: only that block names
// VS Code's theme colors, so one meaning keeps one color (the accent, links, each status) and a new
// rule can't drift onto a stray theme color. Every role a rule uses must be defined there.
import { strict as assert } from "node:assert";
import { readFileSync } from "node:fs";
import { resolve } from "node:path";
import { test } from "node:test";

const css = readFileSync(resolve(__dirname, "../../media/panel.css"), "utf8");
const root = /^:root \{[\s\S]*?^\}/m.exec(css)![0];
const rules = css.replace(root, "");

test("only the role block names VS Code's colors or literal colors", () => {
  const raw = rules.split("\n").filter((line) => /--vscode-|#[0-9a-fA-F]{3,8}\b|rgba?\(/.test(line));
  assert.deepEqual(raw, [], "use a role from :root instead");
});

test("every role a rule uses is defined in the role block", () => {
  const defined = new Set([...root.matchAll(/^\s*(--[a-z0-9-]+):/gm)].map((m) => m[1]));
  const used = new Set([...rules.matchAll(/var\((--[a-z0-9-]+)/g)].map((m) => m[1]));
  assert.deepEqual([...used].filter((v) => !defined.has(v)), []);
});

test("one accent: the send arrow, primary buttons, the working mark, running dots, the plan step in progress, the context ring, and approval cards all use it", () => {
  const ruleFor = (selector: string) => rules.split("\n").find((l) => l.startsWith(selector))!;
  for (const selector of [".send.ready svg {", "button.primary {", ".working-mark {", ".dot {", '.plan-entry[data-status="in_progress"] .plan-mark', ".context-fill {", ".card {", ".card-head .icon"]) {
    assert.match(ruleFor(selector), /var\(--accent\)/, selector);
  }
  assert.ok(!/(?<![\w-])color:\s*var\(--accent\)\s*;/.test(rules.replace(/\.card-head \.icon \{[^}]*\}|\.working-mark \{[^}]*\}/g, "")), "the accent colors icons and fills, not text");
  assert.ok(!/var\(--link\)/.test(rules.replace(/\.md a \{[^}]*\}|button\.link \{[^}]*\}|\.tool-site \{[^}]*\}/g, "")), "the link color is for links only");
});

test("every row's first text or icon sits on one content line: each left offset derives from --content-inset", () => {
  const rule = (selector: string) => {
    const at = css.indexOf(`\n${selector} {`);
    assert.ok(at >= 0, `${selector} exists`);
    return css.slice(at, css.indexOf("}", at));
  };
  assert.match(css, /--content-inset: 10px;/);
  for (const selector of [".tab-button", ".composer", ".footer", ".plan-bar > summary", ".banner"]) assert.match(rule(selector), /var\(--content-inset\)/, `${selector} uses the content line`);
  assert.match(rule(".tab-bar"), /padding: \S+ \S+ \S+ 0;/, "the first tab starts at the edge line (no left padding)");
  assert.match(rule(".composer .attach"), /margin-left: -4px;/, "the + sits on the line with the text");
  assert.match(rule(".tab-button"), /justify-content: center;/, "a short title held at the pill's minimum width is centered, not left with a gap after it");
});
