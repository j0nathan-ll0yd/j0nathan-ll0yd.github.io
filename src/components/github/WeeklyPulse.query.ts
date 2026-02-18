export const meta = {
  name: 'Weekly Pulse',
  description: 'Bar chart sparkline of last 12 weeks of contribution activity',
  api: 'graphql' as const,
};

export const query = `
  query($login: String!) {
    user(login: $login) {
      contributionsCollection {
        contributionCalendar {
          weeks {
            firstDay
            contributionDays {
              contributionCount
            }
          }
        }
      }
    }
  }
`;

export const variables = { login: 'j0nathan-ll0yd' };

export const sampleData = {
  weeks: [
    { total: 23, label: 'Nov 4' },
    { total: 45, label: 'Nov 11' },
    { total: 12, label: 'Nov 18' },
    { total: 67, label: 'Nov 25' },
    { total: 34, label: 'Dec 2' },
    { total: 89, label: 'Dec 9' },
    { total: 56, label: 'Dec 16' },
    { total: 41, label: 'Dec 23' },
    { total: 73, label: 'Dec 30' },
    { total: 28, label: 'Jan 6' },
    { total: 52, label: 'Jan 13' },
    { total: 38, label: 'Jan 20' },
  ],
  maxWeek: 89,
};

function formatWeekLabel(dateStr: string): string {
  const d = new Date(dateStr);
  const months = ['Jan','Feb','Mar','Apr','May','Jun','Jul','Aug','Sep','Oct','Nov','Dec'];
  return months[d.getMonth()] + ' ' + d.getDate();
}

export function transform(response: any): typeof sampleData {
  const calendar = response.data.user.contributionsCollection.contributionCalendar;
  const allWeeks = calendar.weeks;
  const recent = allWeeks.slice(-12);

  const weeks = recent.map((week: any) => {
    const total = week.contributionDays.reduce(
      (sum: number, day: any) => sum + day.contributionCount, 0
    );
    return { total, label: formatWeekLabel(week.firstDay) };
  });

  const maxWeek = Math.max(...weeks.map((w: { total: number }) => w.total), 1);

  return { weeks, maxWeek };
}
