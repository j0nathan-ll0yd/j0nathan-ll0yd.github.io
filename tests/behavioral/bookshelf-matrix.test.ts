import {createRequire} from 'node:module'
import {expect, type Page, test} from '@playwright/test'
import {CLOUDFRONT_BASE, WEBSOCKET_URL} from '@j0nathan-ll0yd/portal-contract/constants'

const require = createRequire(import.meta.url)

function fixture(directory: string, variation: string): string {
  return require.resolve(`@j0nathan-ll0yd/fixtures/generated/${directory}/${variation}.json`)
}

const BASELINE_FIXTURES: Record<string, string> = {
  '/health.json': fixture('health', 'baseline'),
  '/sleep.json': fixture('sleep', 'baseline'),
  '/workouts.json': fixture('workouts', 'baseline'),
  '/github-starred-repos.json': fixture('github-starred-repos', 'baseline'),
  '/github-events.json': fixture('github-events', 'baseline'),
  '/articles.json': fixture('articles', 'baseline'),
  '/focus.json': fixture('focus', 'empty'),
  '/theatre-reviews.json': fixture('theatre-reviews', 'baseline')
}

async function interceptDashboardData(page: Page, booksFixture: string): Promise<void> {
  await page.route(`${CLOUDFRONT_BASE}/**`, async (route) => {
    const pathname = new URL(route.request().url()).pathname
    const path = pathname === '/books.json' ? booksFixture : BASELINE_FIXTURES[pathname]
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

async function loadBooksFixture(page: Page, variation: string): Promise<void> {
  await interceptDashboardData(page, fixture('books', variation))
  await page.goto('/')
  await expect(page.locator('#cardBooks')).not.toHaveClass(/is-loading/)
}

test.describe('Bookshelf Render Conformance', () => {
  // covers: bookshelf-render#Loading state keeps the shelf in its loading presentation
  test('keeps the loading skeleton visible while the books request is pending', async ({page}) => {
    await interceptDashboardData(page, fixture('books', 'baseline'))
    await page.route(`${CLOUDFRONT_BASE}/books.json**`, () => new Promise(() => {}))

    await page.goto('/', {waitUntil: 'domcontentloaded'})

    await expect(page.locator('#cardBooks.is-loading')).toBeVisible()
  })

  // covers: bookshelf-render#Empty state renders empty state message without book cards
  test('renders the empty state without book cards', async ({page}) => {
    await loadBooksFixture(page, 'empty')

    await expect(page.locator('#cardBooks .widget-empty')).toBeVisible()
    await expect(page.locator('#cardBooks .shelf-book')).toHaveCount(0)
  })

  // covers: bookshelf-render#Default populated arrangement renders expected book cards
  test('renders the baseline books with each status represented', async ({page}) => {
    await loadBooksFixture(page, 'baseline')

    await expect(page.locator('#cardBooks .shelf-book')).toHaveCount(5)
    await expect(page.locator('#cardBooks .shelf-book-active')).toHaveCount(1)
    await expect(page.locator('#cardBooks .shelf-status-upNext')).toHaveCount(1)
    await expect(page.locator('#cardBooks .shelf-status-finished')).toHaveCount(3)
    await expect(page.locator('#cardBooks')).toContainText('The Tainted Cup')
    await expect(page.locator('#cardBooks')).toContainText('Crafting Engineering Strategy')
  })

  // covers: bookshelf-render#All completed grouping renders completed section without active groups
  test('renders completed books without reading-state chrome', async ({page}) => {
    await loadBooksFixture(page, 'allCompleted')

    await expect(page.locator('#cardBooks .shelf-book')).toHaveCount(5)
    await expect(page.locator('#cardBooks .shelf-status-finished')).toHaveCount(5)
    await expect(page.locator('#cardBooks .shelf-book-active')).toHaveCount(0)
    await expect(page.locator('#cardBooks .shelf-book-progress')).toHaveCount(0)
  })

  // covers: bookshelf-render#All in progress grouping renders active section without completed groups
  test('renders reading books with progress and no finished-state chrome', async ({page}) => {
    await loadBooksFixture(page, 'allReading')

    await expect(page.locator('#cardBooks .shelf-book')).toHaveCount(3)
    await expect(page.locator('#cardBooks .shelf-book-active')).toHaveCount(3)
    await expect(page.locator('#cardBooks .shelf-book-progress')).toHaveCount(3)
    await expect(page.locator('#cardBooks .shelf-status-finished')).toHaveCount(0)
  })

  // covers: bookshelf-render#Sparse data renders sparse state without phantom cards
  test('renders the no-covers variation without phantom books', async ({page}) => {
    await loadBooksFixture(page, 'noCovers')

    await expect(page.locator('#cardBooks .shelf-book')).toHaveCount(5)
    await expect(page.locator('#cardBooks .shelf-cover-wrapper img')).toHaveCount(5)
    await expect(page.locator('#cardBooks')).toContainText('Foundryside')
  })

  // covers: bookshelf-render#Shelf capacity limits the visible book cards
  test('caps a larger export to the five visible shelf slots', async ({page}) => {
    await loadBooksFixture(page, 'full')

    await expect(page.locator('#cardBooks .shelf-book')).toHaveCount(5)
    await expect(page.locator('#cardBooks')).toContainText('The Tainted Cup')
    await expect(page.locator('#cardBooks')).not.toContainText('JavaScript: The Good Parts')
  })
})
