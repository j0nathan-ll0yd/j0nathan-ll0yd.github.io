export const meta = {
  name: 'Top Repos',
  description: 'Ranked list of top repositories by stars with terminal-style compact layout',
  api: 'graphql' as const,
};

export const query = `
  query($login: String!) {
    user(login: $login) {
      repositories(first: 8, orderBy: {field: STARGAZERS, direction: DESC}, ownerAffiliations: OWNER, privacy: PUBLIC) {
        nodes {
          name
          stargazerCount
          primaryLanguage {
            name
            color
          }
        }
      }
    }
  }
`;

export const variables = { login: 'j0nathan-ll0yd' };

export const sampleData = {
  repos: [
    { rank: 1, name: 'neural-mesh', stars: 234, language: 'Python', languageColor: '#3572A5' },
    { rank: 2, name: 'cmd-center', stars: 156, language: 'TypeScript', languageColor: '#3178c6' },
    { rank: 3, name: 'rustq', stars: 89, language: 'Rust', languageColor: '#dea584' },
    { rank: 4, name: 'go-stream', stars: 67, language: 'Go', languageColor: '#00ADD8' },
    { rank: 5, name: 'ml-pipeline', stars: 45, language: 'Python', languageColor: '#3572A5' },
    { rank: 6, name: 'api-gateway', stars: 34, language: 'TypeScript', languageColor: '#3178c6' },
    { rank: 7, name: 'realtime-service', stars: 23, language: 'Go', languageColor: '#00ADD8' },
    { rank: 8, name: 'dotfiles', stars: 12, language: 'Shell', languageColor: '#89e051' },
  ],
};

export function transform(response: any): typeof sampleData {
  const nodes = response.data.user.repositories.nodes;
  const repos = nodes.map((repo: any, index: number) => ({
    rank: index + 1,
    name: repo.name,
    stars: repo.stargazerCount,
    language: repo.primaryLanguage?.name || 'Unknown',
    languageColor: repo.primaryLanguage?.color || '#8b949e',
  }));
  return { repos };
}
