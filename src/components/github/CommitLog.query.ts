export const meta = {
  name: 'Commit Log',
  description: 'Terminal-style commit list with hash, message, repo, date, and line change stats',
  api: 'graphql' as const,
};

export const query = `
query($login: String!, $first: Int!) {
  user(login: $login) {
    repositories(first: $first, orderBy: {field: PUSHED_AT, direction: DESC}, ownerAffiliations: OWNER) {
      nodes {
        name
        defaultBranchRef {
          target {
            ... on Commit {
              history(first: 5) {
                nodes {
                  abbreviatedOid
                  message
                  committedDate
                  additions
                  deletions
                }
              }
            }
          }
        }
      }
    }
  }
}`;

export const variables = {
  login: 'j0nathan-ll0yd',
  first: 10,
};

export const sampleData = {
  commits: [
    { hash: 'a1b2c3d', message: 'Fix auth token refresh logic', repo: 'myapp', date: '2h ago', additions: 24, deletions: 8 },
    { hash: 'e4f5g6h', message: 'Add rate limiting middleware', repo: 'api-gateway', date: '5h ago', additions: 156, deletions: 12 },
    { hash: 'i7j8k9l', message: 'Update dependencies to latest', repo: 'myapp', date: '8h ago', additions: 48, deletions: 52 },
    { hash: 'm0n1o2p', message: 'Implement WebSocket handlers', repo: 'realtime-service', date: '1d ago', additions: 312, deletions: 45 },
    { hash: 'q3r4s5t', message: 'Refactor database query layer', repo: 'api-gateway', date: '1d ago', additions: 89, deletions: 134 },
    { hash: 'u6v7w8x', message: 'Add unit tests for auth module', repo: 'myapp', date: '2d ago', additions: 203, deletions: 4 },
    { hash: 'y9z0a1b', message: 'Fix memory leak in event loop', repo: 'realtime-service', date: '3d ago', additions: 17, deletions: 31 },
    { hash: 'c2d3e4f', message: 'Update CI pipeline config', repo: 'ml-pipeline', date: '4d ago', additions: 42, deletions: 18 },
  ],
};

export const emptyData: typeof sampleData = {
  commits: [],
};

export function transform(response: any): typeof sampleData {
  const commits: typeof sampleData.commits = [];
  const now = Date.now();

  for (const repo of response.data.user.repositories.nodes) {
    const history = repo.defaultBranchRef?.target?.history?.nodes;
    if (!history) continue;

    for (const commit of history) {
      const msAgo = now - new Date(commit.committedDate).getTime();
      const hoursAgo = Math.floor(msAgo / 3600000);
      const daysAgo = Math.floor(hoursAgo / 24);
      const date = daysAgo > 0 ? `${daysAgo}d ago` : `${hoursAgo}h ago`;

      commits.push({
        hash: commit.abbreviatedOid,
        message: commit.message.split('\n')[0],
        repo: repo.name,
        date,
        additions: commit.additions,
        deletions: commit.deletions,
      });
    }
  }

  commits.sort((a, b) => {
    const parseTime = (d: string) => {
      const num = parseInt(d);
      return d.includes('d') ? num * 24 : num;
    };
    return parseTime(a.date) - parseTime(b.date);
  });

  return { commits: commits.slice(0, 8) };
}
