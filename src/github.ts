/**
 * Issues and pull requests to attach, read from GitHub's REST API with the user's GitHub sign-in
 * (VS Code's authentication provider; the token is supplied by the caller and never stored here).
 * What it returns is attached as untrusted text: issue bodies can contain instructions aimed at the agent.
 */
export type GitHubKind = "issue" | "pr";

export interface GitHubSummary {
  number: number;
  title: string;
}

export interface GitHubSource {
  list(kind: GitHubKind, repo: GitHubRepo): Promise<GitHubSummary[]>;
  /** The item as text to attach: title, link, body, and for a pull request its changed files. */
  text(kind: GitHubKind, repo: GitHubRepo, number: number): Promise<string>;
}

export interface GitHubRepo {
  owner: string;
  name: string;
}

/** owner/name from a GitHub remote URL (https or ssh), or undefined for anything else. */
export function parseGitHubRemote(url: string): GitHubRepo | undefined {
  const m = /github\.com[:/]([^/\s]+)\/([^/\s]+?)(?:\.git)?\/?$/.exec(url.trim());
  return m ? { owner: m[1], name: m[2] } : undefined;
}

export class GitHubApi implements GitHubSource {
  constructor(private token: () => Promise<string>, private base = "https://api.github.com") {}

  private async get(path: string): Promise<any> {
    const res = await fetch(`${this.base}${path}`, {
      headers: { Authorization: `Bearer ${await this.token()}`, Accept: "application/vnd.github+json", "X-GitHub-Api-Version": "2022-11-28", "User-Agent": "YourStack" },
    });
    if (!res.ok) throw new Error(`GitHub answered ${res.status} for ${path}: ${(await res.text()).slice(0, 200)}`);
    return res.json();
  }

  async list(kind: GitHubKind, repo: GitHubRepo): Promise<GitHubSummary[]> {
    const items: any[] = await this.get(`/repos/${repo.owner}/${repo.name}/${kind === "pr" ? "pulls" : "issues"}?state=open&per_page=50`);
    // The issues endpoint also returns pull requests; they're listed under "Pull Request" instead.
    return items.filter((i) => kind === "pr" || !i.pull_request).map((i) => ({ number: i.number, title: i.title }));
  }

  async text(kind: GitHubKind, repo: GitHubRepo, number: number): Promise<string> {
    const item = await this.get(`/repos/${repo.owner}/${repo.name}/${kind === "pr" ? "pulls" : "issues"}/${number}`);
    const parts = [`${kind === "pr" ? "Pull request" : "Issue"} #${item.number}: ${item.title}`, item.html_url, "", item.body ?? "(no description)"];
    if (kind === "pr") {
      const files: any[] = await this.get(`/repos/${repo.owner}/${repo.name}/pulls/${number}/files?per_page=100`);
      parts.push("", `Changed files (${files.length}):`, ...files.map((f) => `- ${f.filename} (+${f.additions} -${f.deletions})`));
    }
    return parts.join("\n");
  }
}
