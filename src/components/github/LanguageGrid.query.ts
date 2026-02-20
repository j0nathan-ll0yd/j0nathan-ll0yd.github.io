export const meta = {
  name: 'Language Grid',
  description: 'Grid of language badges showing colored dot, name, percentage, and repo count',
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
    { name: 'TypeScript', pct: 34.2, color: '#3178c6', repos: 18 },
    { name: 'Python', pct: 22.1, color: '#3572A5', repos: 12 },
    { name: 'JavaScript', pct: 15.8, color: '#f1e05a', repos: 8 },
    { name: 'Go', pct: 10.5, color: '#00ADD8', repos: 6 },
    { name: 'Rust', pct: 8.3, color: '#dea584', repos: 4 },
    { name: 'CSS', pct: 5.9, color: '#563d7c', repos: 3 },
    { name: 'Other', pct: 3.2, color: '#9ca3af', repos: 5 },
  ],
};

export const emptyData: typeof sampleData = {
  languages: [],
};

export function transform(response: any): typeof sampleData {
  const sizeByLang: Record<string, { size: number; color: string; repos: Set<number> }> = {};
  let totalSize = 0;

  for (const [repoIdx, repo] of response.data.user.repositories.nodes.entries()) {
    if (!repo.languages?.edges) continue;
    for (const edge of repo.languages.edges) {
      const name = edge.node.name;
      const color = edge.node.color || '#9ca3af';
      if (!sizeByLang[name]) {
        sizeByLang[name] = { size: 0, color, repos: new Set() };
      }
      sizeByLang[name].size += edge.size;
      sizeByLang[name].repos.add(repoIdx);
      totalSize += edge.size;
    }
  }

  if (totalSize === 0) return { languages: [] };

  const sorted = Object.entries(sizeByLang)
    .map(([name, { size, color, repos }]) => ({
      name,
      pct: Math.round((size / totalSize) * 1000) / 10,
      color,
      repos: repos.size,
    }))
    .sort((a, b) => b.pct - a.pct);

  const top6 = sorted.slice(0, 6);
  const otherPct = sorted.slice(6).reduce((sum, l) => sum + l.pct, 0);
  const otherRepos = new Set<number>();
  for (const lang of sorted.slice(6)) {
    const entry = sizeByLang[lang.name];
    for (const r of entry.repos) otherRepos.add(r);
  }

  const languages = [...top6];
  if (otherPct > 0) {
    languages.push({
      name: 'Other',
      pct: Math.round(otherPct * 10) / 10,
      color: '#9ca3af',
      repos: otherRepos.size,
    });
  }

  return { languages };
}
