export const meta = {
  name: 'Code Velocity',
  description: 'Additions vs deletions sparkline over 52 weeks with green/red area fills',
  api: 'rest' as const,
};

export const query = `GET /repos/{owner}/{repo}/stats/code_frequency`;

export const variables = { owner: 'j0nathan-ll0yd', repo: 'j0nathan-ll0yd.github.io' };

export const sampleData = {
  weeks: [
    { additions: 450, deletions: 120 },
    { additions: 780, deletions: 340 },
    { additions: 1200, deletions: 150 },
    { additions: 320, deletions: 180 },
    { additions: 560, deletions: 410 },
    { additions: 890, deletions: 220 },
    { additions: 1450, deletions: 680 },
    { additions: 340, deletions: 290 },
    { additions: 670, deletions: 150 },
    { additions: 1100, deletions: 530 },
    { additions: 420, deletions: 360 },
    { additions: 950, deletions: 200 },
    { additions: 280, deletions: 740 },
    { additions: 610, deletions: 180 },
    { additions: 1300, deletions: 450 },
    { additions: 390, deletions: 310 },
    { additions: 720, deletions: 160 },
    { additions: 1050, deletions: 580 },
    { additions: 480, deletions: 210 },
    { additions: 860, deletions: 370 },
    { additions: 1600, deletions: 720 },
    { additions: 310, deletions: 250 },
    { additions: 540, deletions: 130 },
    { additions: 970, deletions: 440 },
    { additions: 250, deletions: 680 },
    { additions: 1150, deletions: 300 },
    { additions: 430, deletions: 190 },
    { additions: 790, deletions: 520 },
    { additions: 1350, deletions: 610 },
    { additions: 360, deletions: 140 },
    { additions: 680, deletions: 280 },
    { additions: 1020, deletions: 460 },
    { additions: 470, deletions: 350 },
    { additions: 830, deletions: 170 },
    { additions: 1500, deletions: 800 },
    { additions: 290, deletions: 220 },
    { additions: 610, deletions: 100 },
    { additions: 940, deletions: 380 },
    { additions: 370, deletions: 590 },
    { additions: 1200, deletions: 270 },
    { additions: 520, deletions: 160 },
    { additions: 750, deletions: 430 },
    { additions: 1100, deletions: 550 },
    { additions: 400, deletions: 200 },
    { additions: 680, deletions: 310 },
    { additions: 1300, deletions: 620 },
    { additions: 350, deletions: 780 },
    { additions: 900, deletions: 240 },
    { additions: 560, deletions: 180 },
    { additions: 1050, deletions: 470 },
    { additions: 420, deletions: 330 },
    { additions: 740, deletions: 190 },
  ],
};

export const emptyData: typeof sampleData = {
  weeks: [],
};

export function transform(response: any): typeof sampleData {
  const raw: any[] = Array.isArray(response) ? response : [];

  const weeks = raw.map((entry: any) => ({
    additions: entry[1] || 0,
    deletions: Math.abs(entry[2] || 0),
  }));

  return { weeks };
}
