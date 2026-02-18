export const meta = {
  name: 'Year In Review',
  description: 'Annual summary card with 5 key stats for the year',
  api: 'graphql' as const,
};

export const query = `
  query($login: String!, $from: DateTime!, $to: DateTime!) {
    user(login: $login) {
      contributionsCollection(from: $from, to: $to) {
        totalCommitContributions
        totalPullRequestContributions
        totalIssueContributions
        totalRepositoriesWithContributedCommits
        contributionCalendar {
          totalContributions
          weeks {
            firstDay
            contributionDays {
              contributionCount
              date
            }
          }
        }
      }
      repositories(first: 100, orderBy: {field: CREATED_AT, direction: DESC}, ownerAffiliations: OWNER) {
        nodes {
          createdAt
          primaryLanguage {
            name
          }
        }
      }
    }
  }
`;

const year = new Date().getFullYear();

export const variables = {
  login: 'j0nathan-ll0yd',
  from: `${year}-01-01T00:00:00Z`,
  to: `${year}-12-31T23:59:59Z`,
};

export const sampleData = {
  totalContributions: 1247,
  topLanguage: 'TypeScript',
  mostActiveMonth: 'October',
  reposCreated: 8,
  longestStreak: 47,
};

export function transform(response: any): typeof sampleData {
  const collection = response.data.user.contributionsCollection;
  const calendar = collection.contributionCalendar;
  const totalContributions = calendar.totalContributions;

  // Find most active month
  const monthTotals: number[] = new Array(12).fill(0);
  const monthNames = ['January','February','March','April','May','June','July','August','September','October','November','December'];
  for (const week of calendar.weeks) {
    for (const day of week.contributionDays) {
      const month = new Date(day.date + 'T00:00:00').getMonth();
      monthTotals[month] += day.contributionCount;
    }
  }
  const maxMonthIdx = monthTotals.indexOf(Math.max(...monthTotals));
  const mostActiveMonth = monthNames[maxMonthIdx];

  // Find longest streak
  let longestStreak = 0;
  let currentStreak = 0;
  for (const week of calendar.weeks) {
    for (const day of week.contributionDays) {
      if (day.contributionCount > 0) {
        currentStreak++;
        if (currentStreak > longestStreak) {
          longestStreak = currentStreak;
        }
      } else {
        currentStreak = 0;
      }
    }
  }

  // Count repos created this year
  const yr = new Date().getFullYear();
  const reposCreated = response.data.user.repositories.nodes.filter(
    (repo: any) => new Date(repo.createdAt).getFullYear() === yr
  ).length;

  // Find top language
  const langCounts: Record<string, number> = {};
  for (const repo of response.data.user.repositories.nodes) {
    const lang = repo.primaryLanguage?.name;
    if (lang) {
      langCounts[lang] = (langCounts[lang] || 0) + 1;
    }
  }
  const topLanguage = Object.entries(langCounts).sort((a, b) => b[1] - a[1])[0]?.[0] || 'Unknown';

  return {
    totalContributions,
    topLanguage,
    mostActiveMonth,
    reposCreated,
    longestStreak,
  };
}
