// The fixture data plane's default answers (atlas decision 0160, PR B, plan Step 6.2).
//
// `fixture()` resolves a raw (pre-adapter) fixture inside `@j0nathan-ll0yd/fixtures`. `BASELINE_BY_PATH`
// maps every export path to the variation the suites serve by default. Focus is pinned to `empty`
// on purpose: a hiding focus mode suppresses every other export, which would starve whichever
// widget a test asserts on.
import {createRequire} from 'node:module'
import {ENDPOINTS} from '@j0nathan-ll0yd/portal-contract/constants'

const require = createRequire(import.meta.url)

/** The instant the raw fixtures share as their `generatedAt`: a render clock pinned here judges them fresh. */
export const FIXTURE_NOW_ISO = '2026-03-18T12:00:00.000Z'

/** Absolute path to a raw fixture published by `@j0nathan-ll0yd/fixtures`. */
export function fixture(directory: string, variation: string): string {
  return require.resolve(`@j0nathan-ll0yd/fixtures/generated/${directory}/${variation}.json`)
}

export const BASELINE_BY_PATH: Readonly<Record<string, string>> = {
  [ENDPOINTS.health]: fixture('health', 'baseline'),
  [ENDPOINTS.sleep]: fixture('sleep', 'baseline'),
  [ENDPOINTS.workouts]: fixture('workouts', 'baseline'),
  [ENDPOINTS.books]: fixture('books', 'baseline'),
  [ENDPOINTS.starredRepos]: fixture('github-starred-repos', 'baseline'),
  [ENDPOINTS.githubEvents]: fixture('github-events', 'baseline'),
  [ENDPOINTS.articles]: fixture('articles', 'baseline'),
  [ENDPOINTS.focus]: fixture('focus', 'empty'),
  [ENDPOINTS.theatreReviews]: fixture('theatre-reviews', 'baseline')
}

/** The known-answer input of each export path (`ssrKnownAnswer`, shipped by the fixtures package). */
export const KNOWN_ANSWER_BY_PATH: Readonly<Record<string, string>> = {
  [ENDPOINTS.health]: fixture('health', 'ssrKnownAnswer'),
  [ENDPOINTS.sleep]: fixture('sleep', 'ssrKnownAnswer'),
  [ENDPOINTS.workouts]: fixture('workouts', 'ssrKnownAnswer'),
  [ENDPOINTS.books]: fixture('books', 'ssrKnownAnswer'),
  [ENDPOINTS.starredRepos]: fixture('github-starred-repos', 'ssrKnownAnswer'),
  [ENDPOINTS.githubEvents]: fixture('github-events', 'ssrKnownAnswer'),
  [ENDPOINTS.articles]: fixture('articles', 'ssrKnownAnswer'),
  [ENDPOINTS.focus]: fixture('focus', 'ssrKnownAnswer'),
  [ENDPOINTS.theatreReviews]: fixture('theatre-reviews', 'ssrKnownAnswer')
}
