export const meta = {
  name: 'Streak Counter',
  description: 'Current and longest contribution streaks with 30-day activity dots',
  api: 'graphql' as const,
};

export const query = `
  query($login: String!, $from: DateTime!, $to: DateTime!) {
    user(login: $login) {
      contributionsCollection(from: $from, to: $to) {
        contributionCalendar {
          weeks {
            contributionDays {
              date
              contributionCount
            }
          }
        }
      }
    }
  }
`;

const now = new Date();
const from = new Date(now);
from.setFullYear(from.getFullYear() - 1);

export const variables = {
  login: 'j0nathan-ll0yd',
  from: from.toISOString(),
  to: now.toISOString(),
};

export const sampleData = {
  current: 12,
  longest: 47,
  recentDays: [
    { date: '2026-01-18', active: true },
    { date: '2026-01-19', active: false },
    { date: '2026-01-20', active: true },
    { date: '2026-01-21', active: true },
    { date: '2026-01-22', active: true },
    { date: '2026-01-23', active: false },
    { date: '2026-01-24', active: true },
    { date: '2026-01-25', active: false },
    { date: '2026-01-26', active: true },
    { date: '2026-01-27', active: true },
    { date: '2026-01-28', active: false },
    { date: '2026-01-29', active: true },
    { date: '2026-01-30', active: true },
    { date: '2026-01-31', active: true },
    { date: '2026-02-01', active: false },
    { date: '2026-02-02', active: true },
    { date: '2026-02-03', active: true },
    { date: '2026-02-04', active: true },
    { date: '2026-02-05', active: false },
    { date: '2026-02-06', active: true },
    { date: '2026-02-07', active: true },
    { date: '2026-02-08', active: true },
    { date: '2026-02-09', active: true },
    { date: '2026-02-10', active: false },
    { date: '2026-02-11', active: true },
    { date: '2026-02-12', active: true },
    { date: '2026-02-13', active: true },
    { date: '2026-02-14', active: true },
    { date: '2026-02-15', active: true },
    { date: '2026-02-16', active: true },
  ] as { date: string; active: boolean }[],
};

export const emptyData: typeof sampleData = {
  current: 0,
  longest: 0,
  recentDays: [] as { date: string; active: boolean }[],
};

export function transform(response: any): typeof sampleData {
  const calendar = response.data.user.contributionsCollection.contributionCalendar;

  // Flatten all days and sort by date
  const allDays: { date: string; count: number }[] = [];
  for (const week of calendar.weeks) {
    for (const day of week.contributionDays) {
      allDays.push({ date: day.date, count: day.contributionCount });
    }
  }
  allDays.sort((a, b) => a.date.localeCompare(b.date));

  // Compute streaks
  let current = 0;
  let longest = 0;
  let streak = 0;

  for (let i = 0; i < allDays.length; i++) {
    if (allDays[i].count > 0) {
      streak++;
      if (streak > longest) longest = streak;
    } else {
      streak = 0;
    }
  }

  // Current streak: count backwards from the most recent day
  current = 0;
  for (let i = allDays.length - 1; i >= 0; i--) {
    if (allDays[i].count > 0) {
      current++;
    } else {
      break;
    }
  }

  // Last 30 days
  const last30 = allDays.slice(-30).map((d) => ({
    date: d.date,
    active: d.count > 0,
  }));

  return { current, longest, recentDays: last30 };
}
