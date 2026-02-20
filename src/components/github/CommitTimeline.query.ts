export const meta = {
  name: 'Commit Timeline',
  description: 'Vertical timeline with commit dots, messages, and colored repo badges',
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
              history(first: 3) {
                nodes {
                  abbreviatedOid
                  message
                  committedDate
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
    { hash: 'a1b2c3d', message: 'Fix auth token refresh logic', repo: 'myapp', date: '2h ago', repoColor: '#06d6a0' },
    { hash: 'e4f5g6h', message: 'Add rate limiting middleware', repo: 'api-gateway', date: '5h ago', repoColor: '#3a86ff' },
    { hash: 'm0n1o2p', message: 'Implement WebSocket handlers', repo: 'realtime-service', date: '1d ago', repoColor: '#ff006e' },
    { hash: 'q3r4s5t', message: 'Refactor database query layer', repo: 'api-gateway', date: '1d ago', repoColor: '#3a86ff' },
    { hash: 'c2d3e4f', message: 'Update CI pipeline config', repo: 'ml-pipeline', date: '3d ago', repoColor: '#f59e0b' },
    { hash: 'g5h6i7j', message: 'Add Swift package manifest', repo: 'ios-app', date: '4d ago', repoColor: '#a855f7' },
  ],
};

export const emptyData: typeof sampleData = {
  commits: [],
};

const repoColors = ['#06d6a0', '#3a86ff', '#ff006e', '#f59e0b', '#a855f7'];

export function transform(response: any): typeof sampleData {
  const commits: typeof sampleData.commits = [];
  const colorMap: Record<string, string> = {};
  let colorIndex = 0;
  const now = Date.now();

  for (const repo of response.data.user.repositories.nodes) {
    const history = repo.defaultBranchRef?.target?.history?.nodes;
    if (!history) continue;

    if (!(repo.name in colorMap)) {
      colorMap[repo.name] = repoColors[colorIndex % repoColors.length];
      colorIndex++;
    }

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
        repoColor: colorMap[repo.name],
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

  return { commits: commits.slice(0, 6) };
}
