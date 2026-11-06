import type { GithubRepoSummary } from '@gitcity/shared';
import { z } from 'zod';

const tokenSchema = z.object({ access_token: z.string().min(1) });
const userSchema = z.object({
  id: z.number().int(),
  login: z.string(),
  name: z.string().nullable(),
  avatar_url: z.string().url().nullable(),
  bio: z.string().nullable(),
  html_url: z.string().url(),
  public_repos: z.number().int(),
});
export type GitHubUser = z.infer<typeof userSchema>;

export class GitHubError extends Error {}

/** Minimal GitHub client. Only the `read:user` scope is ever requested — no repo access. */
interface RawRepo {
  name: string;
  description: string | null;
  language: string | null;
  stargazers_count: number;
  html_url: string;
  fork: boolean;
  forks_count?: number;
  topics?: string[];
  pushed_at?: string | null;
}

/** Public, non-fork repos -> language counts, total stars, top 5 and the full (capped) list, most-starred first. */
export function summarizeRepos(raw: RawRepo[]): {
  languages: Record<string, number>;
  stars: number;
  topRepos: GithubRepoSummary[];
  repos: GithubRepoSummary[];
} {
  const own = raw.filter((r) => !r.fork);
  const languages: Record<string, number> = {};
  let stars = 0;
  for (const r of own) {
    stars += r.stargazers_count;
    if (r.language) languages[r.language] = (languages[r.language] ?? 0) + 1;
  }
  const repos: GithubRepoSummary[] = [...own]
    .sort((x, y) => y.stargazers_count - x.stargazers_count)
    .slice(0, 60)
    .map((r) => ({
      name: r.name,
      description: r.description,
      language: r.language,
      stars: r.stargazers_count,
      url: r.html_url,
      forks: r.forks_count ?? 0,
      topics: (r.topics ?? []).slice(0, 4),
      pushedAt: r.pushed_at ?? null,
    }));
  return { languages, stars, topRepos: repos.slice(0, 5), repos };
}

/** Unauthenticated read of a user's public repos (60 req/h per IP on GitHub's side). Returns null on any failure. */
export async function fetchPublicRepos(login: string): Promise<GithubRepoSummary[] | null> {
  try {
    const res = await fetch(`https://api.github.com/users/${encodeURIComponent(login)}/repos?per_page=100&type=owner&sort=pushed`, {
      headers: { Accept: 'application/vnd.github+json', 'User-Agent': 'GitCity3D', 'X-GitHub-Api-Version': '2022-11-28' },
    });
    if (!res.ok) return null;
    return summarizeRepos((await res.json()) as RawRepo[]).repos;
  } catch {
    return null;
  }
}

export class GitHubClient {
  constructor(
    private readonly clientId: string,
    private readonly clientSecret: string,
  ) {}

  authorizeUrl(state: string, redirectUri: string): string {
    const u = new URL('https://github.com/login/oauth/authorize');
    u.searchParams.set('client_id', this.clientId);
    u.searchParams.set('redirect_uri', redirectUri);
    u.searchParams.set('scope', 'read:user');
    u.searchParams.set('state', state);
    u.searchParams.set('allow_signup', 'true');
    return u.toString();
  }

  async exchangeCode(code: string, redirectUri: string): Promise<string> {
    const res = await fetch('https://github.com/login/oauth/access_token', {
      method: 'POST',
      headers: { Accept: 'application/json', 'Content-Type': 'application/json' },
      body: JSON.stringify({
        client_id: this.clientId,
        client_secret: this.clientSecret,
        code,
        redirect_uri: redirectUri,
      }),
    });
    if (!res.ok) throw new GitHubError(`token exchange failed: ${res.status}`);
    const parsed = tokenSchema.safeParse(await res.json());
    if (!parsed.success) throw new GitHubError('token exchange rejected by GitHub');
    return parsed.data.access_token;
  }

  async fetchUser(accessToken: string): Promise<GitHubUser> {
    const res = await fetch('https://api.github.com/user', {
      headers: {
        Authorization: `Bearer ${accessToken}`,
        Accept: 'application/vnd.github+json',
        'User-Agent': 'GitCity3D',
        'X-GitHub-Api-Version': '2022-11-28',
      },
    });
    if (res.status === 403 || res.status === 429) throw new GitHubError('GitHub rate limit reached');
    if (!res.ok) throw new GitHubError(`GitHub user fetch failed: ${res.status}`);
    const parsed = userSchema.safeParse(await res.json());
    if (!parsed.success) throw new GitHubError('Unexpected GitHub user payload');
    return parsed.data;
  }

  private headers(accessToken: string) {
    return {
      Authorization: `Bearer ${accessToken}`,
      Accept: 'application/vnd.github+json',
      'User-Agent': 'GitCity3D',
      'X-GitHub-Api-Version': '2022-11-28',
    };
  }

  /** Public, non-fork repositories: language counts, total stars and the most-starred few. Best effort. */
  async fetchRepoSummary(
    accessToken: string,
    login: string,
  ): Promise<{ languages: Record<string, number>; stars: number; topRepos: GithubRepoSummary[]; repos: GithubRepoSummary[] }> {
    const res = await fetch(
      `https://api.github.com/users/${encodeURIComponent(login)}/repos?per_page=100&type=owner&sort=pushed`,
      { headers: this.headers(accessToken) },
    );
    if (!res.ok) return { languages: {}, stars: 0, topRepos: [], repos: [] };
    return summarizeRepos((await res.json()) as RawRepo[]);
  }

  /** Public contribution counts for the last 12 months (GitHub GraphQL, read:user scope). Best effort. */
  async fetchContributions(accessToken: string) {
    const res = await fetch('https://api.github.com/graphql', {
      method: 'POST',
      headers: { ...this.headers(accessToken), 'Content-Type': 'application/json' },
      body: JSON.stringify({
        query: `query { viewer { followers { totalCount } contributionsCollection {
          totalCommitContributions totalPullRequestContributions
          totalIssueContributions totalPullRequestReviewContributions
          contributionCalendar { totalContributions } } } }`,
      }),
    });
    if (!res.ok) return null;
    const json = (await res.json()) as {
      data?: {
        viewer: {
          followers: { totalCount: number };
          contributionsCollection: {
            totalCommitContributions: number;
            totalPullRequestContributions: number;
            totalIssueContributions: number;
            totalPullRequestReviewContributions: number;
            contributionCalendar: { totalContributions: number };
          };
        };
      };
    };
    const v = json.data?.viewer;
    if (!v) return null;
    const c = v.contributionsCollection;
    return {
      followers: v.followers.totalCount,
      commits: c.totalCommitContributions,
      pullRequests: c.totalPullRequestContributions,
      issues: c.totalIssueContributions,
      reviews: c.totalPullRequestReviewContributions,
      totalContributions: c.contributionCalendar.totalContributions,
    };
  }
}
