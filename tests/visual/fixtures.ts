/**
 * Fixture scenario compositions for visual regression tests.
 *
 * Maps scenario names to raw fixture file paths owned by `@lifegames/fixtures`
 * (Plan #04). Each scenario defines which JSON file serves each of the 10
 * CloudFront endpoints; the Playwright route-interception layer (helpers.ts)
 * fulfills `${CLOUDFRONT_BASE}/<endpoint>` from these files.
 */
import { createRequire } from 'node:module';

const require = createRequire(import.meta.url);

/** Map of CloudFront endpoint path -> absolute fixture file path */
export type FixtureSet = Record<string, string>;

/**
 * Resolve a raw fixture to its on-disk path inside `@lifegames/fixtures`.
 *
 * The package's `generated/<dir>` directories are kebab-case (identical to the
 * web's historical layout), but the variation FILE names are the factories'
 * camelCase keys (e.g. `over-ten` -> `overTen.json`). We keep the kebab token
 * here (it reads naturally in the scenario maps) and normalize to the package's
 * camelCase filename at resolution time. `require.resolve` uses the package
 * `exports` map (`./generated/*`), so this works under yalc linking.
 */
function fixture(dir: string, file: string): string {
  const camelFile = file.replace(/-([a-z0-9])/g, (_, c) => c.toUpperCase());
  return require.resolve(`@lifegames/fixtures/generated/${dir}/${camelFile}.json`);
}

/** Baseline fixtures for all 10 endpoints */
const BASELINE: FixtureSet = {
  '/health.json': fixture('health', 'baseline'),
  '/sleep.json': fixture('sleep', 'baseline'),
  '/workouts.json': fixture('workouts', 'baseline'),
  '/books.json': fixture('books', 'baseline'),
  '/github-starred-repos.json': fixture('github-starred-repos', 'baseline'),
  '/github-events.json': fixture('github-events', 'baseline'),
  '/articles.json': fixture('articles', 'baseline'),
  '/location.json': fixture('location', 'baseline'),
  '/focus.json': fixture('focus', 'no-focus'),
  '/theatre-reviews.json': fixture('theatre-reviews', 'baseline'),
};

/**
 * Dashboard-level scenarios — each defines all 10 endpoints.
 */
const DASHBOARD_SCENARIOS: Record<string, FixtureSet> = {
  populated: { ...BASELINE },

  empty: {
    ...BASELINE,
    '/health.json': fixture('health', 'missing-optional'),
    '/sleep.json': fixture('sleep', 'empty'),
    '/workouts.json': fixture('workouts', 'empty'),
    '/books.json': fixture('books', 'empty'),
    '/github-events.json': fixture('github-events', 'empty'),
    '/articles.json': fixture('articles', 'empty'),
    '/location.json': fixture('location', 'empty-top-places'),
    '/theatre-reviews.json': fixture('theatre-reviews', 'empty'),
  },

  complex: {
    ...BASELINE,
    '/health.json': fixture('health', 'max-hydration'),
    '/sleep.json': fixture('sleep', 'long-sleep'),
    '/workouts.json': fixture('workouts', 'multi-workout'),
    '/books.json': fixture('books', 'six-books'),
    '/github-events.json': fixture('github-events', 'over-ten'),
    '/articles.json': fixture('articles', 'over-thirty'),
    '/location.json': fixture('location', 'full90-days'),
    '/theatre-reviews.json': fixture('theatre-reviews', 'max-reviews'),
  },
};

/**
 * Per-widget variation scenarios — each overrides a single endpoint from baseline.
 *
 * HEALTH ENDPOINT COUPLING: Variations that swap /health.json (hr-*, hydration-*)
 * affect HeartRate, Hydration, and NightSummary simultaneously.
 * This is acceptable because only the target widget is screenshotted in variation
 * tests — side effects on other widgets are cosmetic and not captured.
 */
const WIDGET_VARIATION_SCENARIOS: Record<string, FixtureSet> = {
  // Heart Rate variations (also affects Hydration, NightSummary)
  'hr-bradycardia': { ...BASELINE, '/health.json': fixture('health', 'bradycardia') },
  'hr-peak': { ...BASELINE, '/health.json': fixture('health', 'peak') },
  'hr-resting': { ...BASELINE, '/health.json': fixture('health', 'resting') },

  // Hydration variations (also affects HeartRate, NightSummary)
  'hydration-zero': { ...BASELINE, '/health.json': fixture('health', 'zero-hydration') },
  'hydration-max': { ...BASELINE, '/health.json': fixture('health', 'max-hydration') },

  // Night Summary variations
  'sleep-deep-dominant': { ...BASELINE, '/sleep.json': fixture('sleep', 'deep-dominant') },
  'sleep-rem-dominant': { ...BASELINE, '/sleep.json': fixture('sleep', 'rem-dominant') },
  'sleep-short': { ...BASELINE, '/sleep.json': fixture('sleep', 'short-sleep') },

  // Bookshelf variations
  'books-all-reading': { ...BASELINE, '/books.json': fixture('books', 'all-reading') },
  'books-all-completed': { ...BASELINE, '/books.json': fixture('books', 'all-completed') },
  'books-no-covers': { ...BASELINE, '/books.json': fixture('books', 'no-covers') },

  // Dev Activity Log variations
  'github-commits-only': { ...BASELINE, '/github-events.json': fixture('github-events', 'commits-only') },
  'github-prs-only': { ...BASELINE, '/github-events.json': fixture('github-events', 'prs-only') },

  // Workouts variations
  'workouts-multi': { ...BASELINE, '/workouts.json': fixture('workouts', 'multi-workout') },
  'workouts-barrys': { ...BASELINE, '/workouts.json': fixture('workouts', 'barrys-bootcamp') },

  // Theatre Reviews variations
  'theatre-all-grades': { ...BASELINE, '/theatre-reviews.json': fixture('theatre-reviews', 'all-grades') },
  'theatre-no-images': { ...BASELINE, '/theatre-reviews.json': fixture('theatre-reviews', 'no-images') },

  // Overlay variations
  'focus-work': { ...BASELINE, '/focus.json': fixture('focus', 'baseline') },
  'focus-dnd': { ...BASELINE, '/focus.json': fixture('focus', 'dnd') },
};

/** All available scenario names */
export type ScenarioName = keyof typeof DASHBOARD_SCENARIOS | keyof typeof WIDGET_VARIATION_SCENARIOS;

/** Get the fixture set for a given scenario */
export function getScenarioFixtures(scenario: ScenarioName): FixtureSet {
  if (scenario in DASHBOARD_SCENARIOS) {
    return DASHBOARD_SCENARIOS[scenario];
  }
  if (scenario in WIDGET_VARIATION_SCENARIOS) {
    return WIDGET_VARIATION_SCENARIOS[scenario];
  }
  throw new Error(`Unknown scenario: ${scenario}`);
}

/** Whether a scenario includes non-empty workouts data */
export function scenarioHasWorkouts(scenario: ScenarioName): boolean {
  const fixtures = getScenarioFixtures(scenario);
  const workoutsPath = fixtures['/workouts.json'];
  // Empty workouts fixture has no data to trigger the card
  return !workoutsPath.includes('/empty.json');
}
