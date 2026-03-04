export const HYDRATION = {
  waterMax: 140,        // oz scale max
  caffeineMax: 500,     // mg scale max (visual headroom above FDA 400)
  waterRangeLo: 74,     // oz
  waterRangeHi: 125,    // oz
  caffeineRangeLo: 200, // mg
  caffeineRangeHi: 400, // mg FDA daily max
} as const;

export const STATUS_LABELS: Record<string, string> = {
  next: 'Up Next',
  in_progress: 'Reading',
  completed: 'Finished',
  finished: 'Finished',
} as const;

export const ACTIVITY_TYPE_MAP: Record<string, { label: string; url?: string }> = {
  'Other': { label: "Barry's Bootcamp", url: 'https://share.barrys.com/jsvsl' },
};

export const CLOUDFRONT_BASE = 'https://d2nfgi9u0n3jr6.cloudfront.net';

export const ENDPOINTS = {
  health: '/health.json',
  sleep: '/sleep.json',
  workouts: '/workouts.json',
  books: '/books.json',
  starredRepos: '/github-starred-repos.json',
  githubEvents: '/github-events.json',
  articles: '/articles.json',
  location: '/location.json',
  focus: '/focus.json',
} as const;
