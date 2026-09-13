// Shared CloudFront route interception for the behavioral conformance matrices.
//
// The two original matrices (bookshelf, theatre-reviews) each carry their own private copy of this
// wiring. They are deliberately NOT refactored onto this module: their `Verified by \`file:line\``
// citations in openspec/specs/*/spec.md are line-exact, and the covers rule
// (@j0nathan-ll0yd/estate-contracts) fails the build when a citation drifts more than +/-1 line.
// Rewriting those files to save ~35 duplicated lines would move every tether below the edit for no
// behavioral gain. New matrices consume this module instead, so the duplication stops at two.
//
// The health/articles/devlog matrices each vary ONE endpoint at a time and need the other eight
// served from a stable baseline, which is why the override map is per-path rather than per-suite.

import {createRequire} from 'node:module'
import {expect, type Page} from '@playwright/test'
import {CLOUDFRONT_BASE, ENDPOINTS, WEBSOCKET_URL} from '@j0nathan-ll0yd/portal-contract/constants'

const require = createRequire(import.meta.url)

/** Absolute path to a raw (pre-adapter) fixture published by `@j0nathan-ll0yd/fixtures`. */
export function fixture(directory: string, variation: string): string {
  return require.resolve(`@j0nathan-ll0yd/fixtures/generated/${directory}/${variation}.json`)
}

/**
 * Every dashboard endpoint served from its baseline fixture.
 *
 * `focus` is pinned to the `empty` variation on purpose: a hiding focus mode makes the runtime
 * suppress every other endpoint (live-data.ts `applyFocus`), which would silently starve whichever
 * widget the matrix is actually asserting on.
 */
const BASELINE_BY_PATH: Readonly<Record<string, string>> = {
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

/**
 * Serve the dashboard's CloudFront traffic from fixtures, with `overrides` replacing individual
 * endpoint paths. Off-origin traffic is aborted so a test can never depend on the network.
 */
export async function interceptDashboard(page: Page, overrides: Readonly<Record<string, string>> = {}): Promise<void> {
  const byPath: Record<string, string> = {...BASELINE_BY_PATH, ...overrides}
  await page.route(`${CLOUDFRONT_BASE}/**`, async (route) => {
    const path = byPath[new URL(route.request().url()).pathname]
    if (path) {
      await route.fulfill({path, contentType: 'application/json'})
    } else {
      await route.abort()
    }
  })
  await page.route(`${WEBSOCKET_URL}/**`, (route) => route.abort())
  await page.route('**/*', async (route) => {
    const url = route.request().url()
    if (url.startsWith('http://localhost') || url.startsWith(CLOUDFRONT_BASE) || url.startsWith('data:')) {
      await route.fallback()
      return
    }
    await route.abort()
  })
}

/**
 * Load the dashboard with `overrides` in place and wait until `settledCard` has hydrated.
 *
 * Waiting on the loading class is what makes the later assertions read live-data output rather than
 * the build-time SSR shell. live-data.ts clears `is-loading` for every live card only after each
 * updater has run, so settling on one live card also guarantees the non-live cards it shares a
 * payload with (workouts, system status) have already been written.
 */
export async function loadDashboard(page: Page, overrides: Readonly<Record<string, string>>, settledCard: string): Promise<void> {
  await interceptDashboard(page, overrides)
  await page.goto('/')
  await expect(page.locator(settledCard)).not.toHaveClass(/is-loading/)
}
