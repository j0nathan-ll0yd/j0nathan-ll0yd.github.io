// Values the pre-0160 page rendered as if they were live (atlas decision 0160, PR 0a).
//
// Before PR 0a, `loadDashboardData()` returned `getDashboardFixture('baseline')` from
// @j0nathan-ll0yd/fixtures, so with JavaScript off a visitor read these fabricated values for good.
// Each one is a string from that post-adapter `baseline` (fixtures 1.5.0) as the widgets formatted
// it, picked to be distinctive enough that its presence in `/` can only mean fixture data leaked.
// tests/build/data-free-index.test.ts proves every entry still occurs in the installed fixtures
// package, so a fixtures bump that renames one fails loudly instead of making the check vacuous.
//
// The five rows DndOverlay used to hard-code (`Heart Rate: 72 BPM`, ...) are listed too: the
// design system removed them in @j0nathan-ll0yd/web 4, and they must never return.

/** A fixture value and the post-adapter baseline path it comes from (dot notation). */
export interface FixtureSentinel {
  text: string
  /** Where the value sits in `getDashboardFixture('baseline')`, for the provenance check. */
  source: string
}

export const FIXTURE_SENTINELS: readonly FixtureSentinel[] = [
  {text: '8,200', source: 'health.quantities.stepCount.value'},
  {text: '6h 45m', source: 'health.sleepDurationFormatted'},
  {text: 'Outdoor Walk', source: 'health.workouts.0.activity_type'},
  {text: 'The Pragmatic Programmer', source: 'books.books.0.title'},
  {text: 'Designing Data-Intensive Applications', source: 'books.books.2.title'},
  {text: 'oh-my-openagent', source: 'starredRepos.0.name'},
  {text: 'Add component catalog fleet generation', source: 'github.devActivity.0.title'},
  {text: 'Why SQLite Is So Great for the Edge', source: 'reading.articles.0.title'}
]

/** DndOverlay's retired sample rows (decision 0160 context: "ships five hard-coded rows"). */
export const RETIRED_OVERLAY_ROWS: readonly string[] = ['72 BPM', '8,421', '7h 23m', 'Status: Online']

/** Every live widget card on `/`; each renders `data-ssr-state="loading"` in the data-free page. */
export const LIVE_CARD_IDS: readonly string[] = [
  'cardHR',
  'cardWorkouts',
  'cardMovement',
  'cardHydration',
  'cardSleep',
  'cardDevLog',
  'cardReading',
  'cardStarredRepos',
  'cardBooks',
  'cardTheatreReviews'
]
