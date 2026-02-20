export const meta = {
  name: 'Starred Repo List',
  description: 'Compact chronological list of recently starred repos with terminal-style layout',
  api: 'graphql' as const,
};

export const query = `
  query($login: String!) {
    user(login: $login) {
      starredRepositories(first: 15, orderBy: { field: STARRED_AT, direction: DESC }) {
        edges {
          starredAt
          node {
            name
            stargazerCount
            owner { login }
            primaryLanguage { name color }
          }
        }
      }
    }
  }
`;

export const variables = { login: 'j0nathan-ll0yd' };

export const sampleData = {
  repos: [
    { owner: 'vercel', name: 'next.js', stars: 128000, language: 'JavaScript', languageColor: '#f1e05a', starredAt: '2 days ago' },
    { owner: 'astro-community', name: 'astro', stars: 48000, language: 'TypeScript', languageColor: '#3178c6', starredAt: '5 days ago' },
    { owner: 'denoland', name: 'deno', stars: 101000, language: 'TypeScript', languageColor: '#3178c6', starredAt: '1 week ago' },
    { owner: 'rust-lang', name: 'rust', stars: 99000, language: 'Rust', languageColor: '#dea584', starredAt: '1 week ago' },
    { owner: 'golang', name: 'go', stars: 125000, language: 'Go', languageColor: '#00ADD8', starredAt: '2 weeks ago' },
    { owner: 'huggingface', name: 'transformers', stars: 136000, language: 'Python', languageColor: '#3572A5', starredAt: '2 weeks ago' },
    { owner: 'tauri-apps', name: 'tauri', stars: 86000, language: 'Rust', languageColor: '#dea584', starredAt: '3 weeks ago' },
    { owner: 'anthropics', name: 'claude-code', stars: 25000, language: 'TypeScript', languageColor: '#3178c6', starredAt: '3 weeks ago' },
  ],
};

export const emptyData: typeof sampleData = {
  repos: [],
};

export function transform(response: any): typeof sampleData {
  const edges = response.data.user.starredRepositories.edges;
  const now = Date.now();
  const repos = edges.map((edge: any) => {
    const msAgo = now - new Date(edge.starredAt).getTime();
    const hoursAgo = Math.floor(msAgo / 3600000);
    const daysAgo = Math.floor(hoursAgo / 24);
    const weeksAgo = Math.floor(daysAgo / 7);
    let starredAt: string;
    if (weeksAgo > 0) starredAt = `${weeksAgo} week${weeksAgo > 1 ? 's' : ''} ago`;
    else if (daysAgo > 0) starredAt = `${daysAgo} day${daysAgo > 1 ? 's' : ''} ago`;
    else starredAt = `${hoursAgo}h ago`;

    return {
      owner: edge.node.owner.login,
      name: edge.node.name,
      stars: edge.node.stargazerCount,
      language: edge.node.primaryLanguage?.name || 'Unknown',
      languageColor: edge.node.primaryLanguage?.color || '#8b949e',
      starredAt,
    };
  });
  return { repos };
}
