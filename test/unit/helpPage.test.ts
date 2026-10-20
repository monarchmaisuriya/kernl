// The help page (/help, kernl: Help) and the guides it links to ship with the extension: the page lists
// every kernl command, and every link between guides opens a file and heading that exist.
import { strict as assert } from "node:assert";
import { readdirSync, readFileSync } from "node:fs";
import { resolve } from "node:path";
import { test } from "node:test";
import { PANEL_COMMANDS } from "../../src/ui/panelCommands";

const guides = resolve(__dirname, "../../docs/guides");
const read = (file: string) => readFileSync(resolve(guides, file), "utf8");

/** A heading's anchor as VS Code's Markdown preview makes it: lowercase, spaces to hyphens, punctuation dropped. */
const slug = (heading: string) =>
  heading
    .trim()
    .toLowerCase()
    .replace(/\s+/g, "-")
    .replace(/[^\p{L}\p{N}_-]/gu, "");

test("the help page lists every kernl command and alias", () => {
  const help = read("help.md");
  for (const c of PANEL_COMMANDS) for (const name of [c.name, ...c.aliases]) assert.ok(help.includes(`\`/${name}\``), `/${name} is on the help page`);
});

test("every link between guides opens a guide that ships, at a heading it has", () => {
  const files = readdirSync(guides).filter((f) => f.endsWith(".md"));
  assert.ok(files.includes("help.md"));
  for (const file of files) {
    for (const [, target] of read(file).matchAll(/\]\(([^)\s]+)\)/g)) {
      if (/^https?:/.test(target)) continue;
      const [path, anchor] = target.split("#");
      const into = path || file;
      assert.ok(files.includes(into), `${file} links to ${target}, outside docs/guides`);
      if (!anchor) continue;
      const headings = [...read(into).matchAll(/^#+\s+(.+)$/gm)].map((m) => slug(m[1]));
      assert.ok(headings.includes(anchor), `${file} links to ${target}: no such heading in ${into}`);
    }
  }
});

test("the guides are packaged with the extension", () => {
  const ignore = readFileSync(resolve(__dirname, "../../.vscodeignore"), "utf8").split("\n");
  assert.ok(ignore.includes("!docs/guides/**"));
});
