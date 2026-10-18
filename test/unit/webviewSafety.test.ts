// The panel renders untrusted text (model output, files, web pages). These checks keep it from
// ever being parsed as HTML or script, which could otherwise click "Approve" by itself.
import { strict as assert } from "node:assert";
import { readdirSync, readFileSync } from "node:fs";
import { resolve } from "node:path";
import { test } from "node:test";

const root = resolve(__dirname, "../..");
const webviewFiles = readdirSync(resolve(root, "src/webview")).filter((f) => f.endsWith(".ts"));
const panelSource = readFileSync(resolve(root, "src/ui/panel.ts"), "utf8");

test("webview code never turns strings into HTML", () => {
  assert.deepEqual(webviewFiles.sort(), ["attachments.ts", "contextRing.ts", "highlight.ts", "icons.ts", "main.ts", "markdown.ts", "menu.ts", "messageActions.ts", "modeMenu.ts", "planBar.ts", "sendMenu.ts", "thinking.ts", "toolGroup.ts", "toolRow.ts"], "every webview file is checked");
  for (const file of webviewFiles) {
    const source = readFileSync(resolve(root, "src/webview", file), "utf8");
    for (const sink of ["innerHTML", "outerHTML", "insertAdjacentHTML", "document.write", "eval(", "new Function", "DOMParser", "createContextualFragment"]) {
      assert.ok(!source.includes(sink), `src/webview/${file} uses ${sink}`);
    }
  }
});

test("panel CSP blocks inline and foreign scripts", () => {
  const match = panelSource.match(/\[`default-src 'none'`[^\]]+\]/);
  assert.ok(match, "CSP definition not found");
  const csp = match[0];
  assert.match(csp, /script-src 'nonce-\$\{nonce\}'/);
  assert.ok(!/unsafe-inline|unsafe-eval|\*/.test(csp), `CSP is too loose: ${csp}`);
});
