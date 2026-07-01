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
  '/focus.json': fixture('focus', 'empty'),
  '/theatre-reviews.json': fixture('theatre-reviews', 'baseline'),
};

/**
 * Dashboard-level scenarios — each defines all 10 endpoints.
 */
const DASHBOARD_SCENARIOS: Record<string, FixtureSet> = {
  populated: { ...BASELINE },

  // True-empty state for every domain. Uses the DS triad `empty` variations
  // (real empties that did not exist before the triad — health/location formerly
  // borrowed `missing-optional`/`empty-top-places` as the closest stand-ins).
  // The `missing-optional` health render path it no longer exercises here is
  // preserved by the `health-missing-optional` widget variation below.
  empty: {
    ...BASELINE,
    '/health.json': fixture('health', 'empty'),
    '/sleep.json': fixture('sleep', 'empty'),
    '/workouts.json': fixture('workouts', 'empty'),
    '/books.json': fixture('books', 'empty'),
    '/github-events.json': fixture('github-events', 'empty'),
    '/articles.json': fixture('articles', 'empty'),
    '/location.json': fixture('location', 'empty'),
    '/theatre-reviews.json': fixture('theatre-reviews', 'empty'),
  },

  // The DS standard-triad `full` variation for every domain: the single
  // maximally-populated dashboard scenario (all nullable-but-required fields
  // non-null, all optional keys, max-ish arrays). See DS GOVERNANCE.md P3.2.
  //
  // This is the canonical "most populated" scenario — it replaces the former
  // bespoke `complex` scenario (every widget is now driven by the triad `full`
  // fixture rather than a curated grab-bag of high-count variations).
  // `/focus.json` stays at `empty` (overlay hidden, inherited from BASELINE) so
  // the full-page capture shows the maxed widgets, not the focus overlay covering
  // them (overlay-active states are covered by the `focus-work`/`focus-dnd`
  // widget variations).
  full: {
    ...BASELINE,
    '/health.json': fixture('health', 'full'),
    '/sleep.json': fixture('sleep', 'full'),
    '/workouts.json': fixture('workouts', 'full'),
    '/books.json': fixture('books', 'full'),
    '/github-starred-repos.json': fixture('github-starred-repos', 'full'),
    '/github-events.json': fixture('github-events', 'full'),
    '/articles.json': fixture('articles', 'full'),
    '/location.json': fixture('location', 'full'),
    '/theatre-reviews.json': fixture('theatre-reviews', 'full'),
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

  // Missing-optional health: `dietaryWater` + `dietaryCaffeine` quantities are
  // entirely ABSENT (distinct from `hydration-zero`, where they are present and 0).
  // Preserves coverage of the absent-optional-field render path that the `empty`
  // dashboard scenario formerly exercised before it switched to the real `empty`.
  'health-missing-optional': { ...BASELINE, '/health.json': fixture('health', 'missing-optional') },

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

  // Reading Feed variations
  // Exercises bug-6 fix: articles with empty articleTitle ("") + long sourceTitle
  // must not crash or mis-render the reading widget. Named after Hoodline, a local
  // news aggregator that frequently produces empty-title entries.
  'reading-empty-title': { ...BASELINE, '/articles.json': fixture('articles', 'hoodline-empty-title') },

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
