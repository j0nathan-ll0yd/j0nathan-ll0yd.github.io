export const meta = {
  name: 'Contribution Breakdown',
  description: 'Four stat pills showing commits, PRs, issues, and reviews for the year',
  api: 'graphql' as const,
};

export const query = `
  query($login: String!) {
    user(login: $login) {
      contributionsCollection {
        totalCommitContributions
        totalPullRequestContributions
        totalIssueContributions
        totalPullRequestReviewContributions
      }
    }
  }
`;

export const variables = { login: 'j0nathan-ll0yd' };

export const sampleData = {
  commits: 847,
  pullRequests: 124,
  issues: 56,
  reviews: 203,
};

export function transform(response: any): typeof sampleData {
  const c = response.data.user.contributionsCollection;
  return {
    commits: c.totalCommitContributions,
    pullRequests: c.totalPullRequestContributions,
    issues: c.totalIssueContributions,
    reviews: c.totalPullRequestReviewContributions,
  };
}
