import {readFileSync} from 'node:fs'
import {expect, type Page, test} from '@playwright/test'
import {CLOUDFRONT_BASE, ENDPOINTS} from '@j0nathan-ll0yd/portal-contract/constants'
import {expectNoNewAxeViolations} from './a11y'
import {fixture, interceptDashboard} from './dashboard-fixtures'

// The browser's honest card states on the data-free `/` (atlas decision 0160, PR 0a;
// openspec/specs/dashboard-shell). @j0nathan-ll0yd/web 4.1 gives the browser the server's rules:
// a failed first read renders `unavailable`, an export older than its registry `audit.warn` age
// renders `stale` with an "as of" time, Hydration draws its target bands, and Bookshelf loads a
// mirrored cover from the same origin. Behavioral DOM assertions only, never a screenshot.

const MINUTE = 60_000
/** health `audit.warn` is 45 min (EXPORT_FRESHNESS, atlas surfaces.yaml export-health-json). */
const HEALTH_WARN_MS = 45 * MINUTE

/** A raw fixture export, parsed, so a test can change one field and serve the result. */
function rawFixture(directory: string, variation: string): Record<string, unknown> {
  return JSON.parse(readFileSync(fixture(directory, variation), 'utf8')) as Record<string, unknown>
}

/** Serve `body` for one endpoint. Registered after interceptDashboard, so it wins for that path. */
async function serve(page: Page, endpoint: string, body: unknown): Promise<void> {
  await page.route(`${CLOUDFRONT_BASE}${endpoint}**`, (route) => route.fulfill({status: 200, contentType: 'application/json', body: JSON.stringify(body)}))
}

/** The health baseline with its export stamped `ageMs` before the browser's clock. */
function healthAged(ageMs: number): Record<string, unknown> {
  return {...rawFixture('health', 'baseline'), generatedAt: new Date(Date.now() - ageMs).toISOString()}
}

async function settle(page: Page): Promise<void> {
  // live-data.ts clears every skeleton once its first fetch round settles, success or not.
  await expect(page.locator('.is-loading')).toHaveCount(0, {timeout: 15_000})
}

test.describe('Client card states', () => {
  // covers: dashboard-shell#A failed first read renders the unavailable state
  test('renders unavailable on the cards a failed health read feeds, and keeps Night Summary on the sleep export', async ({page}) => {
    await interceptDashboard(page)
    await page.route(`${CLOUDFRONT_BASE}${ENDPOINTS.health}**`, (route) => route.abort())
    await page.goto('/')
    await settle(page)

    for (const id of ['cardHR', 'cardMovement', 'cardHydration']) {
      const card = page.locator(`#${id}`)
      await expect(card, `#${id}`).toHaveAttribute('data-ssr-state', 'unavailable')
      await expect(card.locator('[data-state-notice="unavailable"]'), `#${id} notice`).toBeVisible()
    }
    await expect(page.locator('#pulseBpm')).toHaveText('')
    // Night Summary follows the sleep export alone (owner decision Q3): it renders from sleep, and
    // only its score, which the failed health export lends, shows the no-reading mark.
    await expect(page.locator('#cardSleep')).not.toHaveAttribute('data-ssr-state', /^(unavailable|loading)$/)

    await expectNoNewAxeViolations(page, 'health/unavailable')
  })

  // covers: dashboard-shell#A failed first read renders the unavailable state
  test('renders unavailable on the Night Summary card when the sleep read fails', async ({page}) => {
    await interceptDashboard(page)
    await page.route(`${CLOUDFRONT_BASE}${ENDPOINTS.sleep}**`, (route) => route.abort())
    await page.goto('/')
    await settle(page)

    await expect(page.locator('#cardSleep')).toHaveAttribute('data-ssr-state', 'unavailable')
    await expect(page.locator('#cardSleep [data-state-notice="unavailable"]')).toBeVisible()
    // The health cards read their own export and are not taken down.
    await expect(page.locator('#cardHR')).not.toHaveAttribute('data-ssr-state', /^(unavailable|loading)$/)

    await expectNoNewAxeViolations(page, 'health/sleepUnavailable')
  })

  // covers: dashboard-shell#An export older than its warning age renders stale with an as-of time
  test('renders stale with an "as of" time for a health export older than its warning age', async ({page}) => {
    const old = healthAged(HEALTH_WARN_MS + 30 * MINUTE)
    await interceptDashboard(page)
    await serve(page, ENDPOINTS.health, old)
    await page.goto('/')
    await settle(page)

    const card = page.locator('#cardHR')
    await expect(card).toHaveAttribute('data-ssr-state', 'stale')
    await expect(card).toHaveAttribute('data-generated-at', String(old.generatedAt))
    await expect(card.locator('.widget-header')).toContainText(/as of /)
    // The reading itself still renders: stale is a data state.
    await expect(page.locator('#pulseBpm')).not.toHaveText('')

    await expectNoNewAxeViolations(page, 'health/stale')
  })

  test('renders live, with no "as of" time, for a health export inside its warning age (control)', async ({page}) => {
    await interceptDashboard(page)
    await serve(page, ENDPOINTS.health, healthAged(5 * MINUTE))
    await page.goto('/')
    await settle(page)

    const card = page.locator('#cardHR')
    await expect(card).toHaveAttribute('data-ssr-state', 'live')
    await expect(card.locator('.widget-header')).not.toContainText(/as of /)
  })

  // covers: dashboard-shell#Hydration draws its target-range bands in the browser
  test('draws both Hydration target-range bands from the export', async ({page}) => {
    await interceptDashboard(page)
    await page.goto('/')
    await settle(page)

    const bands = page.locator('#cardHydration .hydra-range')
    await expect(bands).toHaveCount(2)
    await expect(page.locator('#cardHydration .hydra-range-water')).toBeVisible()
    await expect(page.locator('#cardHydration .hydra-range-coffee')).toBeVisible()

    await expectNoNewAxeViolations(page, 'health/hydrationBands')
  })

  // covers: dashboard-shell#A mirrored cover loads from the same origin
  test('loads a mirrored cover from the same origin and an unmirrored one from CloudFront', async ({page, baseURL}) => {
    // A cover mirrored under public/images/books/, named exactly as the contract URL names it,
    // version token included; and a cover with a version token the mirror does not hold.
    const mirrored = '/images/books/0525573844-2268a447242fc7bccfe74e71'
    const unmirrored = '/images/books/0593128508-0000000000000000000000ff'
    const books = rawFixture('books', 'baseline') as {books: Record<string, unknown>[]}
    const cover = (path: string) => ({
      mainImage: `${CLOUDFRONT_BASE}${path}.webp`,
      mainImageThumb: `${CLOUDFRONT_BASE}${path}-thumb.webp`,
      mainImageCard: `${CLOUDFRONT_BASE}${path}-card.webp`,
      mainImageAvif: null,
      mainImageThumbAvif: null,
      mainImageCardAvif: null
    })
    const body = {...books, books: [{...books.books[0], ...cover(mirrored)}, {...books.books[1], ...cover(unmirrored)}]}

    await interceptDashboard(page)
    await serve(page, ENDPOINTS.books, body)
    // An unmirrored cover answers from "CloudFront", so it keeps its URL instead of falling back.
    const png = Buffer.from('iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAQAAAC1HAwCAAAAC0lEQVR42mNkYAAAAAYAAjCB0C8AAAAASUVORK5CYII=', 'base64')
    await page.route(`${CLOUDFRONT_BASE}/images/**`, (route) => route.fulfill({status: 200, contentType: 'image/png', body: png}))
    await page.goto('/')
    await settle(page)

    const covers = page.locator('#cardBooks .shelf-book img')
    await expect(covers).toHaveCount(2)
    const sources = await covers.evaluateAll((imgs) => imgs.map((img) => (img as HTMLImageElement).getAttribute('src')))
    const origin = new URL(baseURL ?? 'http://localhost:4321').origin
    const resolved = sources.map((src) => new URL(src ?? '', origin).href)
    expect(resolved).toContain(`${origin}${mirrored}-card.webp`)
    expect(resolved).toContain(`${CLOUDFRONT_BASE}${unmirrored}-card.webp`)
    expect(resolved).not.toContain(`${CLOUDFRONT_BASE}${mirrored}-card.webp`)

    await expectNoNewAxeViolations(page, 'bookshelf/mirroredCovers')
  })
})
