// The reply renderer: every supported element, hostile input, link filtering, and partial text
// while a reply streams in. Runs the real renderer against a jsdom document.
import { strict as assert } from "node:assert";
import { test } from "node:test";
import { JSDOM } from "jsdom";
import { httpUrl } from "../../src/ui/protocol";
import { renderMarkdown } from "../../src/webview/markdown";

const { window } = new JSDOM("<!DOCTYPE html><body></body>");
Object.assign(globalThis, { document: window.document });

function render(text: string) {
  const opened: string[] = [];
  const copied: string[] = [];
  const root = window.document.createElement("div");
  root.append(renderMarkdown(text, { openLink: (u) => opened.push(u), copy: (t) => copied.push(t) }));
  return { root, opened, copied, q: (sel: string) => [...root.querySelectorAll<HTMLElement>(sel)] };
}

test("renders each supported element as its own element", () => {
  const { q } = render(
    ["# Title", "## Sub", "Some **bold**, *em*, ~~gone~~, and `code`.", "", "- one", "- two", "  1. nested", "", "> quoted", "", "---", "", "| a | b |", "|:--|--:|", "| 1 | 2 |", "", "```ts", "const x = 1;", "```"].join("\n"),
  );
  assert.equal(q("h1")[0].textContent, "Title");
  assert.equal(q("h2")[0].textContent, "Sub");
  assert.deepEqual([q("strong")[0].textContent, q("em")[0].textContent, q("del")[0].textContent], ["bold", "em", "gone"]);
  assert.equal(q("p code")[0].textContent, "code");
  assert.deepEqual(q("ul > li").map((li) => li.firstChild!.textContent), ["one", "two"]);
  assert.equal(q("ul ol li")[0].textContent, "nested");
  assert.equal(q("blockquote")[0].textContent!.trim(), "quoted");
  assert.equal(q("hr").length, 1);
  assert.deepEqual(q("th").map((c) => c.textContent), ["a", "b"]);
  assert.deepEqual(q("td").map((c) => c.className), ["md-align-left", "md-align-right"]);
  assert.equal(q(".md-code pre code")[0].textContent, "const x = 1;");
  assert.equal(q(".md-lang")[0].textContent, "ts");
});

test("raw HTML, scripts, and event handlers in a reply are shown as text and never become elements", () => {
  const hostile = '<img src=x onerror="alert(1)">\n\n<script>alert(2)</script>\n\nhi <b onclick="x()">bold?</b> <iframe src="https://e.com"></iframe>';
  const { root, q } = render(hostile);
  assert.equal(q("img, script, b, iframe").length, 0);
  assert.ok(root.textContent!.includes('<img src=x onerror="alert(1)">'));
  assert.ok(root.textContent!.includes("<script>alert(2)</script>"));
  assert.ok(root.textContent!.includes('<b onclick="x()">'));
  assert.equal(root.querySelectorAll("[onerror], [onclick], [src]").length, 0);
});

test("only http(s) links are clickable; they open through the host, and the webview never navigates", () => {
  const { q, opened } = render("[docs](https://example.com/a?b=1) [bad](javascript:alert(1)) [file](file:///etc/passwd) <https://auto.example> [rel](/x)");
  const links = q("a");
  assert.deepEqual(links.map((a) => a.textContent), ["docs", "https://auto.example"]);
  assert.ok(links.every((a) => !a.hasAttribute("href")), "no href, so nothing can navigate the webview");
  assert.deepEqual(q(".md-link-blocked").map((s) => s.textContent), ["bad", "file", "rel"]);
  links[0].dispatchEvent(new window.MouseEvent("click", { bubbles: true, cancelable: true }));
  assert.deepEqual(opened, ["https://example.com/a?b=1"]);
  assert.equal(httpUrl("JAVASCRIPT:alert(1)"), undefined);
  assert.equal(httpUrl("https://e.com"), "https://e.com/");
});

test("images are never loaded: they become links labeled with their alt text", () => {
  const { q } = render("![diagram](https://example.com/d.png) ![local](file:///tmp/x.png)");
  assert.equal(q("img").length, 0);
  assert.deepEqual(q("a").map((a) => a.textContent), ["diagram"]);
  assert.deepEqual(q(".md-link-blocked").map((s) => s.textContent), ["local"]);
});

test("Copy sends the code block's exact text to the host", () => {
  const code = "line 1\n  <b>not html</b>\n\tline 3";
  const { q, copied } = render("```\n" + code + "\n```");
  q(".md-copy")[0].click();
  assert.deepEqual(copied, [code]);
  assert.equal(q(".md-lang")[0].textContent, "text");
});

test("a code fence streamed in pieces is an open code block after every piece, and text after the fence is outside it", () => {
  const full = "Here:\n\n```js\nconsole.log(1);\nconsole.log(2);\n```\n\nDone.";
  for (let i = 1; i <= full.length; i++) {
    const { q } = render(full.slice(0, i));
    assert.ok(q(".md-code").length <= 1, `at ${i}: at most one code block`);
  }
  const midway = render(full.slice(0, full.indexOf("console.log(2)") + 4));
  assert.equal(midway.q(".md-code pre code")[0].textContent, "console.log(1);\ncons");
  const done = render(full);
  assert.equal(done.q(".md-code pre code")[0].textContent, "console.log(1);\nconsole.log(2);");
  assert.equal(done.q("p").at(-1)!.textContent, "Done.");
});

test("character references display as characters, task lists as checkboxes, and escapes as literal text", () => {
  const { root, q } = render("Tom &amp; Jerry &lt;3 &#x1F600; \\*not em\\*\n\n- [x] done\n- [ ] todo");
  assert.ok(root.textContent!.includes("Tom & Jerry <3 \u{1F600} *not em*"));
  assert.equal(q("em").length, 0);
  assert.deepEqual(q("input[type=checkbox]").map((c) => (c as HTMLInputElement).checked), [true, false]);
  assert.ok(q("input").every((c) => (c as HTMLInputElement).disabled));
});

test("code blocks in known languages are highlighted with spans, never HTML; unknown languages stay plain; Copy gets the raw code", () => {
  const code = 'const greet = (name: string) => `hi ${name}`; // <script>alert(1)</script>\nreturn 42;';
  const { q, copied } = render("```ts\n" + code + "\n```\n\n```nonsense-lang\nplain <b>text</b>\n```");
  const ts = q(".md-code code")[0];
  assert.ok(ts.classList.contains("hljs"));
  assert.ok(q(".md-code code .hljs-keyword").some((s) => s.textContent === "const"));
  assert.ok(q(".md-code code .hljs-number").some((s) => s.textContent === "42"));
  assert.ok(q(".md-code code .hljs-comment")[0].textContent!.includes("<script>alert(1)</script>"));
  assert.equal(ts.textContent, code, "highlighting changes no characters");
  assert.equal(q("script, b").length, 0);
  const plain = q(".md-code code")[1];
  assert.equal(plain.children.length, 0);
  assert.equal(plain.textContent, "plain <b>text</b>");
  q(".md-copy")[0].click();
  assert.deepEqual(copied, [code]);
});

test("common language aliases highlight (js, py, sh, yml, html)", () => {
  for (const lang of ["js", "py", "sh", "yml", "html", "rs", "go", "sql"]) {
    const { q } = render("```" + lang + "\nx\n```");
    assert.ok(q(".md-code code")[0].classList.contains("hljs"), lang);
  }
});
