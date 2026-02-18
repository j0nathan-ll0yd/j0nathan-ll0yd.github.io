export const meta = {
  name: 'Contribution Grid',
  description: 'Full 52-week GitHub contribution heatmap with summary stats',
  api: 'graphql' as const,
};

export const query = `
  query($login: String!) {
    user(login: $login) {
      contributionsCollection {
        contributionCalendar {
          totalContributions
          weeks {
            contributionDays {
              contributionCount
              contributionLevel
            }
          }
        }
      }
      repositories(ownerAffiliations: OWNER, privacy: PUBLIC) {
        totalCount
      }
      starredRepositories {
        totalCount
      }
    }
  }
`;

export const variables = { login: 'j0nathan-ll0yd' };

export const sampleData = {
  contributions: [
    [0,2,3,3,0,0,1],[2,1,1,0,4,1,0],[0,1,0,2,0,0,0],[0,0,1,1,1,2,0],
    [2,1,2,2,0,1,0],[0,3,2,3,1,0,0],[0,1,1,2,1,3,0],[0,2,3,0,2,1,0],
    [2,4,3,3,0,0,0],[0,1,1,0,1,3,1],[1,4,1,0,0,2,1],[0,0,3,2,0,1,0],
    [0,1,2,2,2,0,0],[2,0,0,1,2,1,0],[0,3,1,1,0,0,0],[1,1,1,0,0,1,2],
    [0,0,1,0,1,1,1],[1,0,2,0,1,1,0],[0,1,2,4,2,2,0],[1,0,1,1,2,3,0],
    [0,1,4,1,0,1,0],[2,1,2,0,2,2,1],[1,0,1,0,4,0,0],[1,0,4,1,0,2,0],
    [2,1,0,1,2,1,3],[2,1,2,0,0,2,0],[1,0,3,1,1,2,3],[2,1,1,0,2,0,0],
    [0,1,2,2,4,0,2],[0,0,2,1,2,1,0],[0,1,0,2,1,3,0],[0,0,1,2,1,1,0],
    [0,0,1,2,2,0,2],[0,1,0,3,0,0,0],[0,2,0,1,1,0,0],[1,3,2,2,1,1,0],
    [0,4,2,2,2,0,0],[0,4,0,1,1,1,1],[0,2,1,3,3,3,2],[1,3,1,1,3,3,0],
    [0,0,3,0,3,1,0],[3,1,0,1,0,2,1],[1,2,0,3,0,3,1],[0,0,0,3,2,1,0],
    [2,0,0,3,0,2,2],[2,2,2,0,0,0,0],[0,1,1,1,4,3,0],[0,2,1,1,1,2,2],
    [1,2,2,0,1,0,0],[0,0,3,3,1,1,0],[0,0,2,0,0,1,0],[0,1,3,0,1,2,0],
  ] as number[][],
  stats: {
    repos: 42,
    stars: 156,
    contributions: 1247,
  },
};

const levelMap: Record<string, number> = {
  NONE: 0,
  FIRST_QUARTILE: 1,
  SECOND_QUARTILE: 2,
  THIRD_QUARTILE: 3,
  FOURTH_QUARTILE: 4,
};

export function transform(response: any): typeof sampleData {
  const calendar = response.data.user.contributionsCollection.contributionCalendar;
  const contributions = calendar.weeks.map((week: any) =>
    week.contributionDays.map((day: any) => levelMap[day.contributionLevel] ?? 0)
  );
  return {
    contributions,
    stats: {
      repos: response.data.user.repositories.totalCount,
      stars: response.data.user.starredRepositories.totalCount,
      contributions: calendar.totalContributions,
    },
  };
}
