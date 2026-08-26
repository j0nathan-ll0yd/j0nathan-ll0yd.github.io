import {createRequire} from 'node:module'
import {readFileSync} from 'node:fs'
import {expect, type Page, test} from '@playwright/test'
import {CLOUDFRONT_BASE, WEBSOCKET_URL} from '@j0nathan-ll0yd/portal-contract/constants'

const require = createRequire(import.meta.url)
const THEATRE_EMPTY_MESSAGE = 'No reviews yet'

type FixtureResponse = {path: string} | {body: string}

function fixture(directory: string, variation: string): string {
  return require.resolve(`@j0nathan-ll0yd/fixtures/generated/${directory}/${variation}.json`)
}

function productionWindowFixture(): FixtureResponse {
  const payload = JSON.parse(readFileSync(fixture('theatre-reviews', 'full'), 'utf8')) as Record<string, unknown>
  // The exporter publishes a seven-card window while retaining the source-wide count.
  // Use the live shape rather than the package's eight-card layout stress fixture.
  payload.reviews = (payload.reviews as unknown[]).slice(0, 7)
  payload.totalReviews = 18
  return {body: JSON.stringify(payload)}
}

const BASELINE_FIXTURES: Record<string, string> = {
  '/health.json': fixture('health', 'baseline'),
  '/sleep.json': fixture('sleep', 'baseline'),
  '/workouts.json': fixture('workouts', 'baseline'),
  '/books.json': fixture('books', 'baseline'),
  '/github-starred-repos.json': fixture('github-starred-repos', 'baseline'),
  '/github-events.json': fixture('github-events', 'baseline'),
  '/articles.json': fixture('articles', 'baseline'),
  '/focus.json': fixture('focus', 'empty')
}

async function interceptDashboardData(page: Page, theatreFixture: FixtureResponse): Promise<void> {
  await page.route(`${CLOUDFRONT_BASE}/**`, async (route) => {
    const pathname = new URL(route.request().url()).pathname
    const response = pathname === '/theatre-reviews.json'
      ? theatreFixture
      : BASELINE_FIXTURES[pathname]
      ? {path: BASELINE_FIXTURES[pathname]}
      : null
    if (response) {
      await route.fulfill({...response, contentType: 'application/json'})
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
 * Fulfill the fixture's off-origin poster requests with real AVIF bytes.
 *
 * Must be registered AFTER interceptDashboardData: Playwright matches handlers
 * most-recently-registered first, so registering earlier would leave that
 * catch-all abort in charge. The bytes are a committed poster from
 * public/images/theatre/, so the browser decodes a genuine AVIF rather than a
 * stand-in that would error and send the widget down the placeholder path.
 */
async function servePosterBytes(page: Page): Promise<void> {
  const avif = readFileSync(new URL('../../public/images/theatre/just-in-time-card.avif', import.meta.url))
  await page.route('**/*.avif', (route) => route.fulfill({body: avif, contentType: 'image/avif'}))
}

async function loadTheatreFixture(page: Page, variation: string): Promise<void> {
  await interceptDashboardData(page, {path: fixture('theatre-reviews', variation)})
  await page.goto('/')
  await expect(page.locator('#cardTheatreReviews')).not.toHaveClass(/is-loading/)
}

test.describe('Theatre Reviews Render Conformance', () => {
  // covers: theatre-reviews-render#Loading skeleton renders placeholders before review data arrives
  test('keeps the loading skeleton visible while the theatre request is pending', async ({page}) => {
    await interceptDashboardData(page, {path: fixture('theatre-reviews', 'baseline')})
    await page.route(`${CLOUDFRONT_BASE}/theatre-reviews.json**`, () => new Promise(() => {}))

    await page.goto('/', {waitUntil: 'domcontentloaded'})

    await expect(page.locator('#cardTheatreReviews.is-loading')).toBeVisible()
    await expect(page.locator('#cardTheatreReviews .skeleton-bar')).toHaveCount(9)
    await expect(page.locator('#cardTheatreReviews .theatre-card')).toHaveCount(0)
  })

  // covers: theatre-reviews-render#Empty state presents the theatre empty message without cards
  test('renders the empty state without review cards', async ({page}) => {
    await loadTheatreFixture(page, 'empty')

    await expect(page.locator('#cardTheatreReviews .widget-empty')).toContainText(THEATRE_EMPTY_MESSAGE)
    await expect(page.locator('#theatreCount')).toHaveText('0 reviews')
    await expect(page.locator('#cardTheatreReviews .theatre-card')).toHaveCount(0)
  })

  // covers: theatre-reviews-render#Baseline reviews render every source title and count
  test('renders every baseline review title and the source count', async ({page}) => {
    await loadTheatreFixture(page, 'baseline')

    await expect(page.locator('#theatreCount')).toHaveText('3 reviews')
    await expect(page.locator('#cardTheatreReviews .theatre-card')).toHaveCount(3)
    await expect(page.locator('#cardTheatreReviews')).toContainText('The Glass Menagerie')
    await expect(page.locator('#cardTheatreReviews')).toContainText('Death of a Salesman')
    await expect(page.locator('#cardTheatreReviews')).toContainText('Waiting for Godot')
  })

  // covers: theatre-reviews-render#Grade variation renders the full letter-grade range
  test('renders all available letter-grade badges', async ({page}) => {
    await loadTheatreFixture(page, 'allGrades')

    await expect(page.locator('#cardTheatreReviews .theatre-card')).toHaveCount(8)
    await expect(page.locator('#cardTheatreReviews .theatre-grade')).toHaveCount(8)
    await expect(page.locator('#cardTheatreReviews')).toContainText('A+')
    await expect(page.locator('#cardTheatreReviews')).toContainText('F')
  })

  // covers: theatre-reviews-render#Reviews without images retain titles and grades without broken image elements
  test('renders image-less reviews without image elements', async ({page}) => {
    await loadTheatreFixture(page, 'noImages')

    await expect(page.locator('#cardTheatreReviews .theatre-card')).toHaveCount(3)
    await expect(page.locator('#cardTheatreReviews .theatre-poster-wrap img')).toHaveCount(0)
    await expect(page.locator('#cardTheatreReviews .theatre-grade')).toHaveCount(3)
    await expect(page.locator('#cardTheatreReviews')).toContainText("Long Day's Journey Into Night")
  })

  // covers: theatre-reviews-render#Export window preserves total source count
  test('displays the total source count while rendering only the exported seven-card window', async ({page}) => {
    await interceptDashboardData(page, productionWindowFixture())
    await page.goto('/')
    await expect(page.locator('#cardTheatreReviews')).not.toHaveClass(/is-loading/)

    await expect(page.locator('#theatreCount')).toHaveText('18 reviews')
    await expect(page.locator('#cardTheatreReviews .theatre-card')).toHaveCount(7)
  })

  // covers: theatre-reviews-render#Full variation renders populated optimized-image review cards
  test('renders optimized poster picture sources and safe outbound links', async ({page}) => {
    // The posters in this fixture are hosted on coasttocoastreviews.com, which
    // interceptDashboardData aborts along with every other off-origin request.
    // Serve them real AVIF bytes instead: a poster that never loads errors, and
    // @j0nathan-ll0yd/web >= 3.0.1 then removes the <picture>'s <source>
    // candidates on its way to the same-origin placeholder -- it has to, or the
    // dead source keeps winning and paints a broken glyph (DS #229). Without
    // this the assertions below would measure the torn-down state rather than
    // the optimized-image path they exist to cover.
    await interceptDashboardData(page, {path: fixture('theatre-reviews', 'full')})
    await servePosterBytes(page)
    await page.goto('/')
    await expect(page.locator('#cardTheatreReviews')).not.toHaveClass(/is-loading/)

    const cards = page.locator('#cardTheatreReviews .theatre-card')
    await expect(cards).toHaveCount(8)
    await expect(page.locator('#cardTheatreReviews picture source[type="image/avif"]')).toHaveCount(8)
    await expect(page.locator('#cardTheatreReviews .theatre-poster-wrap img')).toHaveCount(8)
    await expect(cards.first()).toHaveAttribute('target', '_blank')
    await expect(cards.first()).toHaveAttribute('rel', 'noopener noreferrer')
    await expect(cards.first()).toHaveAttribute('href', 'https://coasttocoastreviews.com/reviews/a-midsummer-nights-dream')
    await expect(page.locator('#cardTheatreReviews')).toContainText("A Midsummer Night's Dream")
  })
})
