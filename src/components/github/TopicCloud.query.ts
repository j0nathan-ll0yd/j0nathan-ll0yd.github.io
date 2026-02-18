export const meta = {
  name: 'Topic Cloud',
  description: 'Repository topics displayed as a tag cloud with varying sizes',
  api: 'graphql' as const,
};

export const query = `
query($login: String!, $first: Int!) {
  user(login: $login) {
    repositories(first: $first, ownerAffiliations: OWNER, isFork: false) {
      nodes {
        repositoryTopics(first: 20) {
          nodes {
            topic {
              name
            }
          }
        }
      }
    }
  }
}`;

export const variables = {
  login: 'j0nathan-ll0yd',
  first: 50,
};

export const sampleData = {
  topics: [
    { name: 'api', count: 5, size: 'md' as const },
    { name: 'aws', count: 2, size: 'sm' as const },
    { name: 'ci-cd', count: 1, size: 'sm' as const },
    { name: 'cli', count: 4, size: 'md' as const },
    { name: 'docker', count: 3, size: 'sm' as const },
    { name: 'edge-computing', count: 1, size: 'sm' as const },
    { name: 'graphql', count: 3, size: 'sm' as const },
    { name: 'kubernetes', count: 2, size: 'sm' as const },
    { name: 'machine-learning', count: 5, size: 'md' as const },
    { name: 'python', count: 7, size: 'lg' as const },
    { name: 'react', count: 8, size: 'lg' as const },
    { name: 'rust', count: 3, size: 'sm' as const },
    { name: 'testing', count: 2, size: 'sm' as const },
    { name: 'typescript', count: 12, size: 'xl' as const },
    { name: 'websockets', count: 1, size: 'sm' as const },
  ],
};

function countToSize(count: number, max: number): 'sm' | 'md' | 'lg' | 'xl' {
  const ratio = count / max;
  if (ratio >= 0.75) return 'xl';
  if (ratio >= 0.45) return 'lg';
  if (ratio >= 0.25) return 'md';
  return 'sm';
}

export function transform(response: any): typeof sampleData {
  const topicCounts: Record<string, number> = {};

  for (const repo of response.data.user.repositories.nodes) {
    const topicNodes = repo.repositoryTopics?.nodes || [];
    for (const t of topicNodes) {
      const name = t.topic.name;
      topicCounts[name] = (topicCounts[name] || 0) + 1;
    }
  }

  const entries = Object.entries(topicCounts);
  if (entries.length === 0) return { topics: [] };

  const max = Math.max(...entries.map(([, c]) => c));

  const topics = entries
    .map(([name, count]) => ({
      name,
      count,
      size: countToSize(count, max),
    }))
    .sort((a, b) => a.name.localeCompare(b.name));

  return { topics };
}
