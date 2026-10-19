// kernl's browser tools in plain words on approval cards and tool rows; other tools keep their name and JSON.
import { strict as assert } from "node:assert";
import { test } from "node:test";
import { browserCardTitle, browserRowTitle, describeBrowserCall } from "../../src/browser/describe";
import { toApprovalCard } from "../../src/ui/approvalCards";

const ws = { id: "main", label: "Main" };

test("a browser call reads as what it does, in any agent's form of the tool name", () => {
  const open = describeBrowserCall("mcp__kernl__browser_navigate", { url: "https://developers.brevo.com/docs/loyalty-setup" })!;
  assert.equal(browserCardTitle(open), "Open developers.brevo.com in kernl's browser");
  assert.equal(browserRowTitle(open), "Browser: open developers.brevo.com");
  assert.equal(open.detail, "https://developers.brevo.com/docs/loyalty-setup", "the card shows the exact URL being approved");
  assert.equal(browserRowTitle(describeBrowserCall("mcp.kernl.browser_click", { selector: "#buy" })!), "Browser: click #buy");
  assert.equal(describeBrowserCall("kernl_browser_type", { selector: "input[name=q]", text: "loyalty" })!.detail, "input[name=q]\nloyalty");
  assert.equal(browserRowTitle(describeBrowserCall("browser_screenshot", {})!), "Browser: take a screenshot");
  assert.equal(describeBrowserCall("mcp__notion__search", { q: "x" }), undefined);
});

test("approval cards: kernl's browser in plain words; any other tool keeps its name and arguments", () => {
  const browser = toApprovalCard("c1", ws, { kind: "tool", tool: "browser_navigate", args: { url: "https://developers.brevo.com/docs/loyalty-setup" } });
  assert.equal(browser.title, "Open developers.brevo.com in kernl's browser");
  assert.equal(browser.detail, "https://developers.brevo.com/docs/loyalty-setup");
  const other = toApprovalCard("c2", ws, { kind: "tool", tool: "search", args: { q: "x" } });
  assert.equal(other.title, "Use tool search");
  assert.match(other.detail, /"q": "x"/);
});

test("before the agent sends what it acts on, a row names a generic object, never a bare verb", () => {
  assert.equal(browserRowTitle(describeBrowserCall("mcp__kernl__browser_navigate", {})!), "Browser: open a page");
  assert.equal(browserRowTitle(describeBrowserCall("mcp__kernl__browser_click", undefined)!), "Browser: click an element");
  assert.equal(browserRowTitle(describeBrowserCall("browser_type", { text: "x" })!), "Browser: type into a field");
});
