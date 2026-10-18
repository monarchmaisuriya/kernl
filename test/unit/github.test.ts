// GitHub attachments: remotes parsed to owner/name; open issues listed without pull requests;
// a pull request's text includes its changed files. Runs against a local stub server.
import { strict as assert } from "node:assert";
import { createServer } from "node:http";
import { test } from "node:test";
import { GitHubApi, parseGitHubRemote } from "../../src/github";

test("GitHub remotes parse; other hosts don't", () => {
  assert.deepEqual(parseGitHubRemote("https://github.com/acme/widgets.git"), { owner: "acme", name: "widgets" });
  assert.deepEqual(parseGitHubRemote("git@github.com:acme/widgets.git"), { owner: "acme", name: "widgets" });
  assert.deepEqual(parseGitHubRemote("https://github.com/acme/widgets"), { owner: "acme", name: "widgets" });
  assert.equal(parseGitHubRemote("https://gitlab.com/acme/widgets.git"), undefined);
  assert.equal(parseGitHubRemote(""), undefined);
});

test("issues are listed without pull requests; a pull request's text has its body and changed files; the token is sent as a bearer", async () => {
  const auth: string[] = [];
  const server = createServer((req, res) => {
    auth.push(String(req.headers.authorization));
    const body: Record<string, unknown> = {
      "/repos/acme/widgets/issues?state=open&per_page=50": [{ number: 7, title: "Login loops" }, { number: 8, title: "A PR", pull_request: {} }],
      "/repos/acme/widgets/pulls?state=open&per_page=50": [{ number: 8, title: "Fix redirect" }],
      "/repos/acme/widgets/pulls/8": { number: 8, title: "Fix redirect", html_url: "https://github.com/acme/widgets/pull/8", body: "Sets the cookie first." },
      "/repos/acme/widgets/pulls/8/files?per_page=100": [{ filename: "src/session.ts", additions: 3, deletions: 1 }],
    };
    const found = body[req.url ?? ""];
    res.writeHead(found ? 200 : 404, { "content-type": "application/json" });
    res.end(JSON.stringify(found ?? { message: "Not Found" }));
  });
  await new Promise<void>((r) => server.listen(0, "127.0.0.1", r));
  const api = new GitHubApi(async () => "gh-test-token-123", `http://127.0.0.1:${(server.address() as any).port}`);
  const repo = { owner: "acme", name: "widgets" };
  try {
    assert.deepEqual(await api.list("issue", repo), [{ number: 7, title: "Login loops" }]);
    assert.deepEqual(await api.list("pr", repo), [{ number: 8, title: "Fix redirect" }]);
    const text = await api.text("pr", repo, 8);
    assert.match(text, /^Pull request #8: Fix redirect\nhttps:\/\/github\.com\/acme\/widgets\/pull\/8\n\nSets the cookie first\.\n\nChanged files \(1\):\n- src\/session\.ts \(\+3 -1\)$/);
    await assert.rejects(api.text("issue", repo, 99), /GitHub answered 404/);
    assert.ok(auth.every((a) => a === "Bearer gh-test-token-123"));
  } finally {
    server.close();
  }
});
