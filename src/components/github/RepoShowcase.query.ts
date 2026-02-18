export const meta = {
  name: 'Repo Showcase',
  description: 'Rich repo cards with description, stats, language, and topic tags in a 2-column grid',
  api: 'graphql' as const,
};

export const query = `
  query($login: String!) {
    user(login: $login) {
      pinnedItems(first: 6, types: [REPOSITORY]) {
        nodes {
          ... on Repository {
            name
            description
            stargazerCount
            forkCount
            url
            primaryLanguage {
              name
              color
            }
            repositoryTopics(first: 5) {
              nodes {
                topic {
                  name
                }
              }
            }
          }
        }
      }
    }
  }
`;

export const variables = { login: 'j0nathan-ll0yd' };

export const sampleData = {
  repos: [
    { name: 'neural-mesh', description: 'A lightweight neural network framework for edge computing', stars: 234, forks: 45, language: 'Python', languageColor: '#3572A5', topics: ['machine-learning', 'edge-computing', 'python'], url: '#' },
    { name: 'cmd-center', description: 'Personal dashboard with real-time data visualization', stars: 156, forks: 23, language: 'TypeScript', languageColor: '#3178c6', topics: ['dashboard', 'astro', 'visualization'], url: '#' },
    { name: 'rustq', description: 'Lock-free concurrent queue implementation in Rust', stars: 89, forks: 12, language: 'Rust', languageColor: '#dea584', topics: ['rust', 'concurrency', 'data-structures'], url: '#' },
    { name: 'go-stream', description: 'Reactive stream processing library for Go', stars: 67, forks: 8, language: 'Go', languageColor: '#00ADD8', topics: ['golang', 'streaming', 'reactive'], url: '#' },
  ],
};

export function transform(response: any): typeof sampleData {
  const nodes = response.data.user.pinnedItems.nodes;
  const repos = nodes.map((repo: any) => ({
    name: repo.name,
    description: repo.description || '',
    stars: repo.stargazerCount,
    forks: repo.forkCount,
    language: repo.primaryLanguage?.name || 'Unknown',
    languageColor: repo.primaryLanguage?.color || '#8b949e',
    topics: repo.repositoryTopics.nodes.map((t: any) => t.topic.name),
    url: repo.url,
  }));
  return { repos };
}
