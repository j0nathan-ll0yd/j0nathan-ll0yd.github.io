export const HYDRATION = {
  waterMax: 140,        // oz scale max
  coffeeMax: 48,        // oz scale max (kept for mug visual)
  caffeineMax: 400,     // mg FDA daily max
  waterRangeLo: 74,     // oz
  waterRangeHi: 125,    // oz
  coffeeRangeLo: 24,    // oz
  coffeeRangeHi: 40,    // oz
  coffeeCautionMax: 20, // oz
} as const;

export const STATUS_LABELS: Record<string, string> = {
  next: 'Up Next',
  in_progress: 'Reading',
  completed: 'Recently Finished',
} as const;

export const CLOUDFRONT_BASE = 'https://d2nfgi9u0n3jr6.cloudfront.net';

export const ENDPOINTS = {
  health: '/health.json',
  sleep: '/sleep.json',
  workouts: '/workouts.json',
  books: '/books.json',
} as const;
