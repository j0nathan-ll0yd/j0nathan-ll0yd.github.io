export const meta = {
  name: 'Coding Hours',
  description: '7-day x 24-hour punch card heatmap showing coding activity patterns',
  api: 'rest' as const,
};

export const query = `GET /repos/{owner}/{repo}/stats/punch_card`;

export const variables = {
  owner: 'j0nathan-ll0yd',
  repo: 'myapp',
};

// grid[day][hour] where day 0=Sun, 6=Sat and hour 0-23. Values 0-4.
export const sampleData = {
  grid: [
    //  0  1  2  3  4  5  6  7  8  9 10 11 12 13 14 15 16 17 18 19 20 21 22 23
    [0, 0, 0, 0, 0, 0, 0, 0, 0, 1, 1, 2, 1, 0, 1, 1, 0, 0, 0, 0, 0, 0, 0, 0], // Sun
    [0, 0, 0, 0, 0, 0, 0, 1, 2, 3, 4, 3, 2, 2, 3, 4, 3, 2, 1, 1, 0, 0, 0, 0], // Mon
    [0, 0, 0, 0, 0, 0, 0, 1, 3, 4, 3, 4, 2, 3, 4, 3, 4, 3, 2, 1, 0, 1, 0, 0], // Tue
    [0, 0, 0, 0, 0, 0, 0, 2, 3, 3, 4, 3, 1, 2, 3, 4, 3, 2, 1, 0, 1, 0, 0, 0], // Wed
    [0, 0, 0, 0, 0, 0, 1, 1, 2, 4, 3, 4, 2, 3, 4, 3, 3, 2, 1, 1, 0, 0, 0, 0], // Thu
    [0, 0, 0, 0, 0, 0, 0, 1, 2, 3, 3, 2, 1, 2, 3, 2, 2, 1, 0, 0, 0, 0, 0, 0], // Fri
    [0, 0, 0, 0, 0, 0, 0, 0, 0, 1, 2, 1, 0, 1, 2, 1, 0, 0, 0, 1, 0, 0, 0, 0], // Sat
  ],
};

export function transform(response: any): typeof sampleData {
  // punch_card response is array of [day, hour, commits]
  // day 0=Sun..6=Sat, hour 0-23
  const grid: number[][] = Array.from({ length: 7 }, () => Array(24).fill(0));

  // Find max commits to normalize to 0-4 scale
  let maxCommits = 0;
  for (const entry of response) {
    if (entry[2] > maxCommits) maxCommits = entry[2];
  }

  if (maxCommits === 0) return { grid };

  for (const entry of response) {
    const day = entry[0];
    const hour = entry[1];
    const commits = entry[2];
    // Normalize to 0-4 scale
    const level = commits === 0 ? 0 : Math.min(4, Math.ceil((commits / maxCommits) * 4));
    grid[day][hour] = level;
  }

  return { grid };
}
