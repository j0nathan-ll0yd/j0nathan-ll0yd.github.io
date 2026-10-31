import {createRequire} from 'node:module'
import {expect, type Page, test} from '@playwright/test'
import {CLOUDFRONT_BASE, WEBSOCKET_URL} from '@j0nathan-ll0yd/portal-contract/constants'
import {bookUrl} from '../shared/book-url'
import {FIXTURE_NOW_ISO} from '../data-plane/baseline'
import {expectNoNewAxeViolations} from './a11y'
import {expectLiveReady, serveDataFreePage, syncServerPlane} from './dashboard-fixtures'

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

async function interceptDashboardData(page: Page, booksFixture: string, dataFree = false): Promise<void> {
  // The server render (atlas decision 0160, PR B) reads the same files the browser's route serves.
  await syncServerPlane(page, {...BASELINE_FIXTURES, '/books.json': booksFixture})
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
  if (dataFree) {
    await serveDataFreePage(page)
  }
}

/** The title link of the tile for `asin`: the tile's one focusable element and the dialog's trigger. */
const TILE_LINK = (asin: string): string => `#cardBooks .shelf-book[data-book*="${asin}"] .shelf-book-link`

async function loadBooksFixture(page: Page, variation: string): Promise<void> {
  await interceptDashboardData(page, fixture('books', variation))
  await page.goto('/')
  await expectLiveReady(page)
}

test.describe('Bookshelf Render Conformance', () => {
  // covers: bookshelf-render#Loading state keeps the shelf in its loading presentation
  test('keeps the loading skeleton visible while the books request is pending', async ({page}) => {
    await interceptDashboardData(page, fixture('books', 'baseline'), true)
    await page.route(`${CLOUDFRONT_BASE}/books.json**`, () => new Promise(() => {}))

    await page.goto('/', {waitUntil: 'domcontentloaded'})

    await expect(page.locator('#cardBooks.is-loading')).toBeVisible()

    await expectNoNewAxeViolations(page, 'bookshelf/loading')
  })

  // covers: bookshelf-render#Empty state renders empty state message without book cards
  test('renders the empty state without book cards', async ({page}) => {
    await loadBooksFixture(page, 'empty')

    await expect(page.locator('#cardBooks .widget-empty')).toBeVisible()
    await expect(page.locator('#cardBooks .shelf-book')).toHaveCount(0)

    await expectNoNewAxeViolations(page, 'bookshelf/empty')
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

    await expectNoNewAxeViolations(page, 'bookshelf/baseline')
  })

  // covers: bookshelf-render#All completed grouping renders completed section without active groups
  test('renders completed books without reading-state chrome', async ({page}) => {
    await loadBooksFixture(page, 'allCompleted')

    await expect(page.locator('#cardBooks .shelf-book')).toHaveCount(5)
    await expect(page.locator('#cardBooks .shelf-status-finished')).toHaveCount(5)
    await expect(page.locator('#cardBooks .shelf-book-active')).toHaveCount(0)
    await expect(page.locator('#cardBooks .shelf-book-progress')).toHaveCount(0)

    await expectNoNewAxeViolations(page, 'bookshelf/allCompleted')
  })

  // covers: bookshelf-render#All in progress grouping renders active section without completed groups
  test('renders reading books with progress and no finished-state chrome', async ({page}) => {
    await loadBooksFixture(page, 'allReading')

    await expect(page.locator('#cardBooks .shelf-book')).toHaveCount(3)
    await expect(page.locator('#cardBooks .shelf-book-active')).toHaveCount(3)
    await expect(page.locator('#cardBooks .shelf-book-progress')).toHaveCount(3)
    await expect(page.locator('#cardBooks .shelf-status-finished')).toHaveCount(0)

    await expectNoNewAxeViolations(page, 'bookshelf/allReading')
  })

  // covers: bookshelf-render#Sparse data renders sparse state without phantom cards
  test('renders the no-covers variation without phantom books', async ({page}) => {
    await loadBooksFixture(page, 'noCovers')

    await expect(page.locator('#cardBooks .shelf-book')).toHaveCount(5)
    await expect(page.locator('#cardBooks .shelf-cover-wrapper img')).toHaveCount(5)
    await expect(page.locator('#cardBooks')).toContainText('Foundryside')

    await expectNoNewAxeViolations(page, 'bookshelf/noCovers')
  })

  // covers: bookshelf-render#Shelf capacity limits the visible book cards
  test('caps a larger export to the five visible shelf slots', async ({page}) => {
    await loadBooksFixture(page, 'full')

    await expect(page.locator('#cardBooks .shelf-book')).toHaveCount(5)
    await expect(page.locator('#cardBooks')).toContainText('The Tainted Cup')
    await expect(page.locator('#cardBooks')).not.toContainText('JavaScript: The Good Parts')

    await expectNoNewAxeViolations(page, 'bookshelf/full')
  })

  // The tile link (web 4.6.0, DS #333): the server render links each title to its book; the
  // book-modal enhancement turns a plain click into the dialog and leaves a modified click alone.
  // `full` holds a reading, an up-next and a finished book (book-modal.spec.ts).
  // covers: bookshelf-render#Each book card links to its book without JavaScript
  test('a plain click on a tile link opens the dialog and does not navigate', async ({page, context}) => {
    await loadBooksFixture(page, 'full')
    const opened: string[] = []
    const bookRequests: string[] = []
    const navigations: string[] = []
    context.on('page', (other) => opened.push(other.url()))
    await context.route('https://www.amazon.com/**', (route) => {
      bookRequests.push(route.request().url())
      return route.abort()
    })
    page.on('framenavigated', (frame) => {
      if (frame === page.mainFrame()) {
        navigations.push(frame.url())
      }
    })
    const url = page.url()

    await page.locator(TILE_LINK('B07QVH2Q2K')).click()

    await expect(page.locator('dialog#bookDialog')).toHaveAttribute('open')
    await expect(page.locator('.book-modal-title')).toContainText('Shorefall')
    // The enhancement cancels the click in its own task; a short backstop lets a regressed tab start.
    await page.waitForTimeout(100)
    expect(page.url()).toBe(url)
    expect({opened, bookRequests, navigations}).toEqual({opened: [], bookRequests: [], navigations: []})
  })

  test('a Ctrl or Cmd click on a tile link opens the book in a new tab and no dialog', async ({page, context}) => {
    await loadBooksFixture(page, 'full')
    // The new tab is a page of its own, outside this page's routes: answer the book URL locally.
    await context.route('https://www.amazon.com/**', (route) => route.fulfill({status: 200, contentType: 'text/html', body: '<title>book</title>'}))

    const [tab] = await Promise.all([
      context.waitForEvent('page', {timeout: 5_000}),
      page.locator(TILE_LINK('B07QVH2Q2K')).click({modifiers: ['ControlOrMeta']})
    ])

    await tab.waitForURL(bookUrl('B07QVH2Q2K'))
    await expect(page.locator('dialog#bookDialog')).not.toHaveAttribute('open')
  })

  test('aria-haspopup="dialog" marks every tile link once the enhancement binds, and never the server HTML', async ({page}) => {
    await loadBooksFixture(page, 'full')
    const links = page.locator('#cardBooks .shelf-book-link')
    await expect(links).toHaveCount(await page.locator('#cardBooks .shelf-book').count())
    expect(await links.evaluateAll((els) => els.filter((el) => el.getAttribute('aria-haspopup') !== 'dialog').length)).toBe(0)

    // The same document the page received: the Worker renders at the fixtures' date (pinRenderClock).
    const response = await page.request.get('/', {headers: {'x-ssr-clock': FIXTURE_NOW_ISO}})
    expect(response.headers()['x-ssr-data'], 'the server composed the page').toBe('live')
    const serverLinks = (await response.text()).match(/<a class="shelf-book-link"[^>]*>/g) ?? []
    expect(serverLinks.length, 'the server render carries the tile links').toBeGreaterThan(0)
    expect(serverLinks.filter((tag) => tag.includes('aria-haspopup'))).toEqual([])
  })
})
