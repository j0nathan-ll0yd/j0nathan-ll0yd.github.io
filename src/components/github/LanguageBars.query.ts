export const meta = {
  name: 'Language Bars',
  description: 'Horizontal progress bars per language with percentage labels and colored dots',
  api: 'graphql' as const,
};

export const query = `
query($login: String!, $first: Int!) {
  user(login: $login) {
    repositories(first: $first, ownerAffiliations: OWNER, isFork: false, orderBy: {field: STARGAZERS, direction: DESC}) {
      nodes {
        languages(first: 10, orderBy: {field: SIZE, direction: DESC}) {
          edges {
            size
            node {
              name
              color
            }
          }
        }
      }
    }
  }
}`;

export const variables = {
  login: 'j0nathan-ll0yd',
  first: 20,
};

export const sampleData = {
  languages: [
    { name: 'TypeScript', pct: 34.2, color: '#3178c6' },
    { name: 'Python', pct: 22.1, color: '#3572A5' },
    { name: 'JavaScript', pct: 15.8, color: '#f1e05a' },
    { name: 'Go', pct: 10.5, color: '#00ADD8' },
    { name: 'Rust', pct: 8.3, color: '#dea584' },
    { name: 'CSS', pct: 5.9, color: '#563d7c' },
    { name: 'Other', pct: 3.2, color: '#9ca3af' },
  ],
};

export function transform(response: any): typeof sampleData {
  const sizeByLang: Record<string, { size: number; color: string }> = {};
  let totalSize = 0;

  for (const repo of response.data.user.repositories.nodes) {
    if (!repo.languages?.edges) continue;
    for (const edge of repo.languages.edges) {
      const name = edge.node.name;
      const color = edge.node.color || '#9ca3af';
      if (!sizeByLang[name]) {
        sizeByLang[name] = { size: 0, color };
      }
      sizeByLang[name].size += edge.size;
      totalSize += edge.size;
    }
  }

  if (totalSize === 0) return { languages: [] };

  const sorted = Object.entries(sizeByLang)
    .map(([name, { size, color }]) => ({
      name,
      pct: Math.round((size / totalSize) * 1000) / 10,
      color,
    }))
    .sort((a, b) => b.pct - a.pct);

  const top6 = sorted.slice(0, 6);
  const otherPct = sorted.slice(6).reduce((sum, l) => sum + l.pct, 0);

  const languages = [...top6];
  if (otherPct > 0) {
    languages.push({ name: 'Other', pct: Math.round(otherPct * 10) / 10, color: '#9ca3af' });
  }

  return { languages };
}
