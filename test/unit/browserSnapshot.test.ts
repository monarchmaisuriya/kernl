// The page as the agent sees it: an outline from the accessibility tree, with a ref for each element a person acts on.
import { strict as assert } from "node:assert";
import { test } from "node:test";
import { type AxNode, newRefs, outline } from "../../src/browser/snapshot";

const page = { href: "http://localhost/shop", title: "Shop" };
let id = 0;
/** A tree node: role, name, children, and extras (value, properties, DOM node id). */
function n(role: string, name: string, children: AxNode[] = [], extra: Partial<AxNode> = {}): AxNode[] {
  const self: AxNode = { nodeId: String(++id), role: { value: role }, name: { value: name }, childIds: children.filter((c) => !c.parentId).map((c) => c.nodeId), ...extra };
  for (const c of children) c.parentId ??= self.nodeId;
  return [self, ...children];
}
const tree = (...nodes: AxNode[][]) => nodes.flat();

test("actionable elements get refs in page order; headings, text, and values show; a button's own label text isn't repeated", () => {
  const nodes = tree(
    n("RootWebArea", "Shop", [
      ...n("heading", "Cookies", [...n("StaticText", "Cookies")], { properties: [{ name: "level", value: { value: 2 } }] }),
      ...n("StaticText", "We use cookies."),
      ...n("button", "Accept All Cookies", [...n("StaticText", "Accept All Cookies")], { backendDOMNodeId: 11 }),
      ...n("textbox", "Email", [], { backendDOMNodeId: 12, value: { value: "a@b.c" } }),
      ...n("checkbox", "Remember me", [], { backendDOMNodeId: 13, properties: [{ name: "checked", value: { value: "true" } }] }),
      ...n("button", "Pay", [], { backendDOMNodeId: 14, properties: [{ name: "disabled", value: { value: true } }] }),
      ...n("generic", "", [...n("link", "Home", [], { backendDOMNodeId: 15 })]),
    ]),
  );
  const snap = outline(nodes, page);
  assert.equal(
    snap.text,
    [
      "url: http://localhost/shop",
      "title: Shop",
      "",
      '- heading "Cookies" level=2',
      "  - text: Cookies",
      "- text: We use cookies.",
      '- button "Accept All Cookies" [ref=e1]',
      '- textbox "Email" value="a@b.c" [ref=e2]',
      '- checkbox "Remember me" checked [ref=e3]',
      '- button "Pay" disabled [ref=e4]',
      '- link "Home" [ref=e5]',
    ].join("\n"),
  );
  assert.deepEqual(snap.refs.get("e1"), { backendNodeId: 11, role: "button", name: "Accept All Cookies" });
  assert.equal(snap.refs.get("e5")?.backendNodeId, 15, "an element inside an unshown wrapper still gets its ref");
});

test("ignored nodes are skipped but their children still show; an element with no DOM node gets no ref", () => {
  const snap = outline(tree(n("RootWebArea", "", [...n("none", "", [...n("button", "Go", [], { backendDOMNodeId: 1 })], { ignored: true }), ...n("button", "Ghost")])), page);
  assert.match(snap.text, /- button "Go" \[ref=e1\]/);
  assert.match(snap.text, /- button "Ghost"$/m);
  assert.equal(snap.refs.size, 1);
});

test("an empty page says so; a long one is cut with a note to scroll", () => {
  assert.match(outline(tree(n("RootWebArea", "")), page).text, /\(nothing on the page\)$/);
  const many = n("RootWebArea", "", Array.from({ length: 900 }, (_, i) => n("StaticText", `line ${i}`)).flat());
  const snap = outline(many, page);
  assert.match(snap.text, /scroll and take another snapshot/);
  assert.ok(!snap.text.includes("line 850"));
});

test("with the browser's numbering, an element keeps its ref in every snapshot and a ref is never given to another element", () => {
  const refOf = newRefs();
  const first = outline(tree(n("RootWebArea", "", [...n("button", "Accept", [], { backendDOMNodeId: 7 })])), page, refOf);
  // The page adds a button above it: the new one gets a new ref; Accept keeps e1.
  const second = outline(tree(n("RootWebArea", "", [...n("button", "Delete", [], { backendDOMNodeId: 9 }), ...n("button", "Accept", [], { backendDOMNodeId: 7 })])), page, refOf);
  assert.deepEqual(first.refs.get("e1"), { backendNodeId: 7, role: "button", name: "Accept" });
  assert.deepEqual(second.refs.get("e1"), { backendNodeId: 7, role: "button", name: "Accept" });
  assert.deepEqual(second.refs.get("e2"), { backendNodeId: 9, role: "button", name: "Delete" });
  assert.match(second.text, /- button "Delete" \[ref=e2\]\n- button "Accept" \[ref=e1\]/);
});

test("frames are outlined after the page under their address, with refs that keep counting; a frame kernl can't read says so", () => {
  const refOf = newRefs();
  const snap = outline(
    tree(n("RootWebArea", "", [...n("button", "Outer", [], { backendDOMNodeId: 1 })])),
    page,
    refOf,
    [
      { id: "F1", url: "http://site.test/inner", nodes: tree(n("RootWebArea", "", [...n("button", "Inner Buy", [], { backendDOMNodeId: 2 })])) },
      { url: "https://ads.example/x" },
    ],
  );
  assert.match(snap.text, /- button "Outer" \[ref=e1\]\n- frame "http:\/\/site\.test\/inner"\n  - button "Inner Buy" \[ref=e2\]\n- frame "https:\/\/ads\.example\/x" \(from another site: kernl can't read inside it\)/);
  assert.deepEqual(snap.refs.get("e2"), { backendNodeId: 2, role: "button", name: "Inner Buy", frameId: "F1" }, "a frame's ref knows its frame (dropped when it navigates)");
  assert.equal(snap.refs.get("e1")!.frameId, undefined, "the page's own refs have none");
});
