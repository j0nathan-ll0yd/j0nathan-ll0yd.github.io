export const meta = {
  name: 'Contribution Rings',
  description: 'Apple Watch-style concentric rings for commits, PRs, issues, and reviews',
  api: 'graphql' as const,
};

export const query = `
  query($login: String!, $from: DateTime!, $to: DateTime!) {
    user(login: $login) {
      contributionsCollection(from: $from, to: $to) {
        totalCommitContributions
        totalPullRequestContributions
        totalIssueContributions
        totalPullRequestReviewContributions
        contributionCalendar {
          totalContributions
        }
      }
    }
  }
`;

const year = new Date().getFullYear();

export const variables = {
  login: 'j0nathan-ll0yd',
  from: `${year}-01-01T00:00:00Z`,
  to: `${year}-12-31T23:59:59Z`,
};

export const sampleData = {
  commits: { count: 847, pct: 85 },
  pullRequests: { count: 124, pct: 62 },
  issues: { count: 56, pct: 45 },
  reviews: { count: 203, pct: 78 },
};

export const emptyData: typeof sampleData = {
  commits: { count: 0, pct: 0 },
  pullRequests: { count: 0, pct: 0 },
  issues: { count: 0, pct: 0 },
  reviews: { count: 0, pct: 0 },
};

export function transform(response: any): typeof sampleData {
  const c = response.data.user.contributionsCollection;
  const total = c.contributionCalendar.totalContributions || 1;

  const commits = c.totalCommitContributions;
  const pullRequests = c.totalPullRequestContributions;
  const issues = c.totalIssueContributions;
  const reviews = c.totalPullRequestReviewContributions;

  // Percentages relative to the total contribution count, capped at 100
  const pct = (n: number) => Math.min(Math.round((n / total) * 100), 100);

  return {
    commits: { count: commits, pct: pct(commits) },
    pullRequests: { count: pullRequests, pct: pct(pullRequests) },
    issues: { count: issues, pct: pct(issues) },
    reviews: { count: reviews, pct: pct(reviews) },
  };
}
