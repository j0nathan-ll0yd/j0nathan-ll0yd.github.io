export const meta = {
  name: 'Contribution Calendar',
  description: 'Last 90 days of contributions with larger cells, month headers, and day labels',
  api: 'graphql' as const,
};

export const query = `
  query($login: String!, $from: DateTime!, $to: DateTime!) {
    user(login: $login) {
      contributionsCollection(from: $from, to: $to) {
        contributionCalendar {
          weeks {
            firstDay
            contributionDays {
              date
              contributionCount
              contributionLevel
            }
          }
        }
      }
    }
  }
`;

const now = new Date();
const from = new Date(now);
from.setDate(from.getDate() - 90);

export const variables = {
  login: 'j0nathan-ll0yd',
  from: from.toISOString(),
  to: now.toISOString(),
};

export const sampleData = {
  weeks: [
    { firstDay: '2025-11-17', days: [
      { date: '2025-11-17', count: 0, level: 0 },{ date: '2025-11-18', count: 3, level: 2 },
      { date: '2025-11-19', count: 1, level: 1 },{ date: '2025-11-20', count: 5, level: 3 },
      { date: '2025-11-21', count: 2, level: 1 },{ date: '2025-11-22', count: 0, level: 0 },
      { date: '2025-11-23', count: 0, level: 0 },
    ]},
    { firstDay: '2025-11-24', days: [
      { date: '2025-11-24', count: 1, level: 1 },{ date: '2025-11-25', count: 4, level: 3 },
      { date: '2025-11-26', count: 2, level: 1 },{ date: '2025-11-27', count: 0, level: 0 },
      { date: '2025-11-28', count: 7, level: 4 },{ date: '2025-11-29', count: 1, level: 1 },
      { date: '2025-11-30', count: 0, level: 0 },
    ]},
    { firstDay: '2025-12-01', days: [
      { date: '2025-12-01', count: 3, level: 2 },{ date: '2025-12-02', count: 0, level: 0 },
      { date: '2025-12-03', count: 6, level: 3 },{ date: '2025-12-04', count: 2, level: 1 },
      { date: '2025-12-05', count: 1, level: 1 },{ date: '2025-12-06', count: 0, level: 0 },
      { date: '2025-12-07', count: 0, level: 0 },
    ]},
    { firstDay: '2025-12-08', days: [
      { date: '2025-12-08', count: 0, level: 0 },{ date: '2025-12-09', count: 2, level: 1 },
      { date: '2025-12-10', count: 5, level: 3 },{ date: '2025-12-11', count: 3, level: 2 },
      { date: '2025-12-12', count: 0, level: 0 },{ date: '2025-12-13', count: 1, level: 1 },
      { date: '2025-12-14', count: 0, level: 0 },
    ]},
    { firstDay: '2025-12-15', days: [
      { date: '2025-12-15', count: 4, level: 3 },{ date: '2025-12-16', count: 1, level: 1 },
      { date: '2025-12-17', count: 0, level: 0 },{ date: '2025-12-18', count: 8, level: 4 },
      { date: '2025-12-19', count: 2, level: 1 },{ date: '2025-12-20', count: 0, level: 0 },
      { date: '2025-12-21', count: 1, level: 1 },
    ]},
    { firstDay: '2025-12-22', days: [
      { date: '2025-12-22', count: 0, level: 0 },{ date: '2025-12-23', count: 3, level: 2 },
      { date: '2025-12-24', count: 0, level: 0 },{ date: '2025-12-25', count: 0, level: 0 },
      { date: '2025-12-26', count: 1, level: 1 },{ date: '2025-12-27', count: 2, level: 1 },
      { date: '2025-12-28', count: 0, level: 0 },
    ]},
    { firstDay: '2025-12-29', days: [
      { date: '2025-12-29', count: 2, level: 1 },{ date: '2025-12-30', count: 5, level: 3 },
      { date: '2025-12-31', count: 1, level: 1 },{ date: '2026-01-01', count: 0, level: 0 },
      { date: '2026-01-02', count: 3, level: 2 },{ date: '2026-01-03', count: 0, level: 0 },
      { date: '2026-01-04', count: 0, level: 0 },
    ]},
    { firstDay: '2026-01-05', days: [
      { date: '2026-01-05', count: 1, level: 1 },{ date: '2026-01-06', count: 4, level: 3 },
      { date: '2026-01-07', count: 0, level: 0 },{ date: '2026-01-08', count: 6, level: 3 },
      { date: '2026-01-09', count: 2, level: 1 },{ date: '2026-01-10', count: 0, level: 0 },
      { date: '2026-01-11', count: 1, level: 1 },
    ]},
    { firstDay: '2026-01-12', days: [
      { date: '2026-01-12', count: 0, level: 0 },{ date: '2026-01-13', count: 3, level: 2 },
      { date: '2026-01-14', count: 7, level: 4 },{ date: '2026-01-15', count: 1, level: 1 },
      { date: '2026-01-16', count: 0, level: 0 },{ date: '2026-01-17', count: 2, level: 1 },
      { date: '2026-01-18', count: 0, level: 0 },
    ]},
    { firstDay: '2026-01-19', days: [
      { date: '2026-01-19', count: 2, level: 1 },{ date: '2026-01-20', count: 0, level: 0 },
      { date: '2026-01-21', count: 4, level: 3 },{ date: '2026-01-22', count: 3, level: 2 },
      { date: '2026-01-23', count: 1, level: 1 },{ date: '2026-01-24', count: 5, level: 3 },
      { date: '2026-01-25', count: 0, level: 0 },
    ]},
    { firstDay: '2026-01-26', days: [
      { date: '2026-01-26', count: 0, level: 0 },{ date: '2026-01-27', count: 2, level: 1 },
      { date: '2026-01-28', count: 3, level: 2 },{ date: '2026-01-29', count: 0, level: 0 },
      { date: '2026-01-30', count: 6, level: 3 },{ date: '2026-01-31', count: 1, level: 1 },
      { date: '2026-02-01', count: 0, level: 0 },
    ]},
    { firstDay: '2026-02-02', days: [
      { date: '2026-02-02', count: 1, level: 1 },{ date: '2026-02-03', count: 5, level: 3 },
      { date: '2026-02-04', count: 2, level: 1 },{ date: '2026-02-05', count: 0, level: 0 },
      { date: '2026-02-06', count: 4, level: 3 },{ date: '2026-02-07', count: 3, level: 2 },
      { date: '2026-02-08', count: 1, level: 1 },
    ]},
    { firstDay: '2026-02-09', days: [
      { date: '2026-02-09', count: 0, level: 0 },{ date: '2026-02-10', count: 3, level: 2 },
      { date: '2026-02-11', count: 1, level: 1 },{ date: '2026-02-12', count: 7, level: 4 },
      { date: '2026-02-13', count: 2, level: 1 },{ date: '2026-02-14', count: 4, level: 3 },
      { date: '2026-02-15', count: 1, level: 1 },
    ]},
  ] as { firstDay: string; days: { date: string; count: number; level: number }[] }[],
  months: ['Nov', 'Dec', 'Jan', 'Feb'],
};

export const emptyData: typeof sampleData = {
  weeks: [] as { firstDay: string; days: { date: string; count: number; level: number }[] }[],
  months: [],
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
  const allWeeks = calendar.weeks;
  const last13 = allWeeks.slice(-13);

  const weeks = last13.map((week: any) => ({
    firstDay: week.firstDay,
    days: week.contributionDays.map((day: any) => ({
      date: day.date,
      count: day.contributionCount,
      level: levelMap[day.contributionLevel] ?? 0,
    })),
  }));

  const monthSet: string[] = [];
  const monthNames = ['Jan','Feb','Mar','Apr','May','Jun','Jul','Aug','Sep','Oct','Nov','Dec'];
  for (const week of weeks) {
    if (week.days.length > 0) {
      const m = monthNames[new Date(week.days[0].date + 'T00:00:00').getMonth()];
      if (!monthSet.includes(m)) {
        monthSet.push(m);
      }
    }
  }

  return { weeks, months: monthSet };
}
