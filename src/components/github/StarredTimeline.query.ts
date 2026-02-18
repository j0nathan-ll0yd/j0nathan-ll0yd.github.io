export const meta = {
  name: 'Starred Timeline',
  description: 'Vertical timeline showing starring activity pattern over time with language-colored dots',
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
            description
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
    { owner: 'vercel', name: 'next.js', description: 'The React Framework', stars: 128000, language: 'JavaScript', languageColor: '#f1e05a', starredAt: '2 days ago' },
    { owner: 'astro-community', name: 'astro', description: 'The web framework for content-driven websites', stars: 48000, language: 'TypeScript', languageColor: '#3178c6', starredAt: '5 days ago' },
    { owner: 'denoland', name: 'deno', description: 'A modern runtime for JavaScript and TypeScript', stars: 101000, language: 'TypeScript', languageColor: '#3178c6', starredAt: '1 week ago' },
    { owner: 'rust-lang', name: 'rust', description: 'Empowering everyone to build reliable software', stars: 99000, language: 'Rust', languageColor: '#dea584', starredAt: '1 week ago' },
    { owner: 'golang', name: 'go', description: 'The Go programming language', stars: 125000, language: 'Go', languageColor: '#00ADD8', starredAt: '2 weeks ago' },
    { owner: 'huggingface', name: 'transformers', description: 'State-of-the-art ML for PyTorch, TensorFlow, and JAX', stars: 136000, language: 'Python', languageColor: '#3572A5', starredAt: '2 weeks ago' },
    { owner: 'tauri-apps', name: 'tauri', description: 'Build smaller, faster, and more secure desktop apps', stars: 86000, language: 'Rust', languageColor: '#dea584', starredAt: '3 weeks ago' },
    { owner: 'anthropics', name: 'claude-code', description: 'CLI for Claude AI', stars: 25000, language: 'TypeScript', languageColor: '#3178c6', starredAt: '3 weeks ago' },
  ],
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
      description: edge.node.description || '',
      stars: edge.node.stargazerCount,
      language: edge.node.primaryLanguage?.name || 'Unknown',
      languageColor: edge.node.primaryLanguage?.color || '#8b949e',
      starredAt,
    };
  });
  return { repos };
}
