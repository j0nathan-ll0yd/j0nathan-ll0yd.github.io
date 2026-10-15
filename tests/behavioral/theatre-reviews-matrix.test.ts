import {createRequire} from 'node:module'
import {readFileSync} from 'node:fs'
import {expect, type Page, test} from '@playwright/test'
import {CLOUDFRONT_BASE, WEBSOCKET_URL} from '@j0nathan-ll0yd/portal-contract/constants'
import {expectNoNewAxeViolations} from './a11y'

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

// Use same-origin fixture images (serveFixturePosters) to retain optimized-picture
// coverage while the raw fixture's rejected off-origin candidates cover the sanitizer path.
function allowedPosterFixture(): FixtureResponse {
  const payload = JSON.parse(readFileSync(fixture('theatre-reviews', 'full'), 'utf8')) as Record<string, unknown>
  payload.reviews = (payload.reviews as Array<Record<string, unknown>>).map((review) => ({
    ...review,
    imageUrl: '/images/theatre/behavioral-fixture-poster.webp',
    imageUrlAvif: '/images/theatre/behavioral-fixture-poster.avif',
    imageUrlCard: '/images/theatre/behavioral-fixture-poster-card.webp',
    imageUrlCardAvif: '/images/theatre/behavioral-fixture-poster-card.avif'
  }))
  return {body: JSON.stringify(payload)}
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

    await expectNoNewAxeViolations(page, 'theatre-reviews/loading')
  })

  // covers: theatre-reviews-render#Empty state presents the theatre empty message without cards
  test('renders the empty state without review cards', async ({page}) => {
    await loadTheatreFixture(page, 'empty')

    await expect(page.locator('#cardTheatreReviews .widget-empty')).toContainText(THEATRE_EMPTY_MESSAGE)
    // An empty export names no count: the bare "reviews" link (@j0nathan-ll0yd/web 4).
    await expect(page.locator('#theatreCount')).toHaveText('reviews')
    await expect(page.locator('#cardTheatreReviews .theatre-card')).toHaveCount(0)

    await expectNoNewAxeViolations(page, 'theatre-reviews/empty')
  })

  // covers: theatre-reviews-render#Baseline reviews render every source title and count
  test('renders every baseline review title and the source count', async ({page}) => {
    await loadTheatreFixture(page, 'baseline')

    await expect(page.locator('#theatreCount')).toHaveText('3 reviews')
    await expect(page.locator('#cardTheatreReviews .theatre-card')).toHaveCount(3)
    await expect(page.locator('#cardTheatreReviews')).toContainText('The Glass Menagerie')
    await expect(page.locator('#cardTheatreReviews')).toContainText('Death of a Salesman')
    await expect(page.locator('#cardTheatreReviews')).toContainText('Waiting for Godot')
    await expectSanitizedPlaceholderCovers(page, 3)

    await expectNoNewAxeViolations(page, 'theatre-reviews/baseline')
  })

  // covers: theatre-reviews-render#Grade variation renders the full letter-grade range
  test('renders all available letter-grade badges', async ({page}) => {
    await loadTheatreFixture(page, 'allGrades')

    await expect(page.locator('#cardTheatreReviews .theatre-card')).toHaveCount(8)
    await expect(page.locator('#cardTheatreReviews .theatre-grade')).toHaveCount(8)
    await expect(page.locator('#cardTheatreReviews')).toContainText('A+')
    await expect(page.locator('#cardTheatreReviews')).toContainText('F')
    await expectSanitizedPlaceholderCovers(page, 8)

    await expectNoNewAxeViolations(page, 'theatre-reviews/allGrades')
  })
  // covers: theatre-reviews-render#Reviews without images retain titles and grades without broken image elements
  test('renders image-less reviews without image elements', async ({page}) => {
    await loadTheatreFixture(page, 'noImages')

    await expect(page.locator('#cardTheatreReviews .theatre-card')).toHaveCount(3)
    await expect(page.locator('#cardTheatreReviews .theatre-poster-wrap img')).toHaveCount(0)
    await expect(page.locator('#cardTheatreReviews .theatre-grade')).toHaveCount(3)
    await expect(page.locator('#cardTheatreReviews')).toContainText("Long Day's Journey Into Night")

    await expectNoNewAxeViolations(page, 'theatre-reviews/noImages')
  })

  // covers: theatre-reviews-render#Export window preserves total source count
  test('displays the total source count while rendering only the exported seven-card window', async ({page}) => {
    await interceptDashboardData(page, productionWindowFixture())
    await page.goto('/')
    await expect(page.locator('#cardTheatreReviews')).not.toHaveClass(/is-loading/)

    await expect(page.locator('#theatreCount')).toHaveText('18 reviews')
    await expect(page.locator('#cardTheatreReviews .theatre-card')).toHaveCount(7)

    await expectNoNewAxeViolations(page, 'theatre-reviews/exportWindow')
  })

  // covers: theatre-reviews-render#Full variation renders populated optimized-image review cards
  test('renders optimized poster picture sources and safe outbound links', async ({page}) => {
    // The raw fixture's off-origin posters are rejected by the image sanitizer.
    // Serve same-origin fixture posters (serveFixturePosters) to exercise the allowed
    // optimized picture path independently of the rejection behavior asserted above.
    await interceptDashboardData(page, allowedPosterFixture())
    await serveFixturePosters(page)
    await page.goto('/')
    await expect(page.locator('#cardTheatreReviews')).not.toHaveClass(/is-loading/)

    const cards = page.locator('#cardTheatreReviews .theatre-card')
    await expect(cards).toHaveCount(8)
    await expect(page.locator('#cardTheatreReviews picture source[type="image/avif"]')).toHaveCount(8)
    const posters = page.locator('#cardTheatreReviews .theatre-poster-wrap img')
    await expect(posters).toHaveCount(8)
    // Every poster decoded from a fixture path. A 404 would swap in the W6
    // placeholder and leave this optimized-picture path unexercised.
    await expect.poll(async () =>
      posters.evaluateAll((images) =>
        (images as HTMLImageElement[]).map((image) => ({
          loaded: image.complete && image.naturalWidth > 0,
          fixture: new URL(image.currentSrc).pathname.startsWith('/images/theatre/behavioral-fixture-poster')
        }))
      )
    ).toEqual(Array.from({length: 8}, () => ({loaded: true, fixture: true})))
    await expect(cards.first()).toHaveAttribute('target', '_blank')
    await expect(cards.first()).toHaveAttribute('rel', 'noopener noreferrer')
    await expect(cards.first()).toHaveAttribute('href', 'https://coasttocoastreviews.com/reviews/a-midsummer-nights-dream')
    await expect(page.locator('#cardTheatreReviews')).toContainText("A Midsummer Night's Dream")

    await expectNoNewAxeViolations(page, 'theatre-reviews/fullOptimizedPosters')
  })
})

async function expectSanitizedPlaceholderCovers(page: Page, count: number): Promise<void> {
  const posters = page.locator('#cardTheatreReviews .theatre-poster-wrap img')
  await expect(posters).toHaveCount(count)
  await expect(page.locator('#cardTheatreReviews .theatre-poster-wrap source')).toHaveCount(0)
  await expect.poll(async () =>
    posters.evaluateAll((images) => images.map((image) => ({src: image.getAttribute('src'), srcset: image.getAttribute('srcset')})))
  ).toEqual(Array.from({length: count}, () => ({src: '/images/no-cover.svg', srcset: null})))
}

// Same-origin poster paths served from a test fixture, never from the deployed
// mirror. public/images/ tracks the live manifests and is pruned when the
// producer renames an image, so a test that borrowed a mirror file broke on the
// next prune. Defined below the tests so the covers: annotations above keep
// their line numbers (openspec cites them as path:line).
const FIXTURE_POSTERS: Record<string, {file: string; contentType: string}> = {
  '/images/theatre/behavioral-fixture-poster.webp': {file: 'poster.webp', contentType: 'image/webp'},
  '/images/theatre/behavioral-fixture-poster.avif': {file: 'poster.avif', contentType: 'image/avif'},
  '/images/theatre/behavioral-fixture-poster-card.webp': {file: 'poster-card.webp', contentType: 'image/webp'},
  '/images/theatre/behavioral-fixture-poster-card.avif': {file: 'poster-card.avif', contentType: 'image/avif'}
}

async function serveFixturePosters(page: Page): Promise<void> {
  // Registered after interceptDashboardData, so it takes precedence over the
  // catch-all route there. serviceWorkers: 'block' keeps the worker out of the way.
  await page.route('**/images/theatre/behavioral-fixture-poster*', async (route) => {
    const poster = FIXTURE_POSTERS[new URL(route.request().url()).pathname]
    if (poster) {
      await route.fulfill({path: require.resolve(`./fixtures/theatre-poster/${poster.file}`), contentType: poster.contentType})
    } else {
      await route.fulfill({status: 404})
    }
  })
}
