export const meta = {
  name: 'Starred Repo Cards',
  description: 'Rich card grid of recently starred repos with descriptions, stats, and language badges',
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
            url
            stargazerCount
            forkCount
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
    { owner: 'vercel', name: 'next.js', description: 'The React Framework', stars: 128000, forks: 27000, language: 'JavaScript', languageColor: '#f1e05a', url: '#' },
    { owner: 'astro-community', name: 'astro', description: 'The web framework for content-driven websites', stars: 48000, forks: 2500, language: 'TypeScript', languageColor: '#3178c6', url: '#' },
    { owner: 'denoland', name: 'deno', description: 'A modern runtime for JavaScript and TypeScript', stars: 101000, forks: 5400, language: 'TypeScript', languageColor: '#3178c6', url: '#' },
    { owner: 'rust-lang', name: 'rust', description: 'Empowering everyone to build reliable software', stars: 99000, forks: 12800, language: 'Rust', languageColor: '#dea584', url: '#' },
    { owner: 'golang', name: 'go', description: 'The Go programming language', stars: 125000, forks: 17400, language: 'Go', languageColor: '#00ADD8', url: '#' },
    { owner: 'huggingface', name: 'transformers', description: 'State-of-the-art ML for PyTorch, TensorFlow, and JAX', stars: 136000, forks: 27200, language: 'Python', languageColor: '#3572A5', url: '#' },
    { owner: 'tauri-apps', name: 'tauri', description: 'Build smaller, faster, and more secure desktop apps', stars: 86000, forks: 2600, language: 'Rust', languageColor: '#dea584', url: '#' },
    { owner: 'anthropics', name: 'claude-code', description: 'CLI for Claude AI', stars: 25000, forks: 1800, language: 'TypeScript', languageColor: '#3178c6', url: '#' },
  ],
};

export function transform(response: any): typeof sampleData {
  const edges = response.data.user.starredRepositories.edges;
  const repos = edges.map((edge: any) => ({
    owner: edge.node.owner.login,
    name: edge.node.name,
    description: edge.node.description || '',
    stars: edge.node.stargazerCount,
    forks: edge.node.forkCount,
    language: edge.node.primaryLanguage?.name || 'Unknown',
    languageColor: edge.node.primaryLanguage?.color || '#8b949e',
    url: edge.node.url,
  }));
  return { repos };
}
