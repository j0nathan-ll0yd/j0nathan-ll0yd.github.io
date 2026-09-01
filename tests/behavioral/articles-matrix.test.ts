import {expect, test} from '@playwright/test'
import {CLOUDFRONT_BASE, ENDPOINTS} from '@j0nathan-ll0yd/portal-contract/constants'
import {expectNoNewAxeViolations} from './a11y'
import {fixture, interceptDashboard, loadDashboard} from './dashboard-fixtures'

// Reading-feed (articles) render conformance. Behavioral DOM assertions only; the reading-feed
// screenshots in tests/visual/widgets.spec.ts are supplementary and are never this suite's oracle.
//
// Two caps stack, and the suite pins both because they are easy to confuse:
//   - the ADAPTER keeps the 30 most recently saved articles  (adapters.ts adaptArticles)
//   - the UPDATER paginates whatever survives at 10 rows per page  (updaters.ts updateReadingFeed)
// Relative dates ("3d ago") are deliberately NOT asserted: they are computed against the browser
// clock, which this suite does not freeze, so they would rot on a wall-clock boundary.

const HOODLINE_SOURCE = 'Hoodline — San Francisco Bay Area Neighborhood News and Community Updates'

test.describe('Reading Feed Render Conformance', () => {
  // covers: articles-render#Loading state keeps the reading feed in its loading presentation
  test('keeps the loading presentation while the articles request is pending', async ({page}) => {
    await interceptDashboard(page)
    await page.route(`${CLOUDFRONT_BASE}${ENDPOINTS.articles}**`, () => new Promise(() => {}))

    await page.goto('/', {waitUntil: 'domcontentloaded'})

    await expect(page.locator('#cardReading.is-loading')).toBeVisible()

    await expectNoNewAxeViolations(page, 'articles/loading')
  })

  // covers: articles-render#Empty state renders the reading-feed empty message without article rows
  test('renders the empty state without article rows', async ({page}) => {
    await loadDashboard(page, {[ENDPOINTS.articles]: fixture('articles', 'empty')}, '#cardReading')

    await expect(page.locator('#cardReading .widget-empty')).toHaveText('No articles yet')
    await expect(page.locator('#cardReading .article-list-item')).toHaveCount(0)
    // The empty branch replaces the whole list, so no orphaned pagination may survive it.
    await expect(page.locator('#cardReading .article-page-btn')).toHaveCount(0)

    await expectNoNewAxeViolations(page, 'articles/empty')
  })

  // covers: articles-render#Baseline articles render every title, its source and its outbound link
  test('renders every baseline article with its source and outbound link', async ({page}) => {
    await loadDashboard(page, {}, '#cardReading')

    const items = page.locator('#cardReading .article-list-item')
    await expect(items).toHaveCount(5)
    await expect(page.locator('#cardReading .article-list-source')).toHaveCount(5)
    await expect(items.first().locator('.article-list-title')).toHaveText('Ask HN: How do you manage technical debt at scale')
    await expect(items.first()).toContainText('(Hacker News)')
    await expect(items.last().locator('.article-list-title')).toHaveText('Deep Dive: How Modern Compilers Optimize Code')
    await expect(items.last()).toContainText('(Ars Technica)')

    // Titles are outbound links, so they carry the safe-link attributes.
    const firstLink = items.first().locator('a.article-list-title')
    await expect(firstLink).toHaveAttribute('href', 'https://news.ycombinator.com/item?id=placeholder1')
    await expect(firstLink).toHaveAttribute('target', '_blank')
    await expect(firstLink).toHaveAttribute('rel', 'noopener noreferrer')

    // Five articles is one page, so the pager stays absent rather than rendering a lone "1".
    await expect(page.locator('#cardReading .article-page-btn')).toHaveCount(0)

    await expectNoNewAxeViolations(page, 'articles/baseline')
  })

  // covers: articles-render#An untitled article promotes its source and suppresses the duplicate parenthetical
  test('promotes the source into the title slot for untitled articles', async ({page}) => {
    await loadDashboard(page, {[ENDPOINTS.articles]: fixture('articles', 'hoodlineEmptyTitle')}, '#cardReading')

    const items = page.locator('#cardReading .article-list-item')
    await expect(items).toHaveCount(3)
    // The two untitled rows would otherwise render blank-left, so the source fills the title slot
    // and the parenthetical source is suppressed to avoid printing the same string twice.
    await expect(items.nth(0).locator('.article-list-title')).toHaveText(HOODLINE_SOURCE)
    await expect(items.nth(1).locator('.article-list-title')).toHaveText(HOODLINE_SOURCE)
    await expect(page.locator('#cardReading .article-list-source')).toHaveCount(1)
    await expect(items.nth(2).locator('.article-list-title')).toHaveText('Normal article following empty-title entries (mixed rendering)')
    await expect(items.nth(2)).toContainText('(Hacker News)')

    await expectNoNewAxeViolations(page, 'articles/untitled')
  })

  // covers: articles-render#Annotated articles render a note affordance carrying the note text
  test('renders a note affordance carrying every joined note comment', async ({page}) => {
    await loadDashboard(page, {[ENDPOINTS.articles]: fixture('articles', 'withNotes')}, '#cardReading')

    const notes = page.locator('#cardReading .article-list-note')
    await expect(notes).toHaveCount(3)
    // Multiple comments join into the one title attribute rather than rendering multiple icons.
    await expect(notes.nth(0)).toHaveAttribute('title', 'Great point about consensus algorithms\nFollow up on the Raft paper')
    await expect(notes.nth(1)).toHaveAttribute('title', 'Relevant to mantle licensing decisions')
    await expect(page.locator('#cardReading .article-list-item')).toHaveCount(3)

    await expectNoNewAxeViolations(page, 'articles/withNotes')
  })

  // covers: articles-render#An oversized feed paginates at ten rows per page
  test('paginates an oversized feed at ten rows per page', async ({page}) => {
    await loadDashboard(page, {[ENDPOINTS.articles]: fixture('articles', 'pagination')}, '#cardReading')

    // 25 articles is under the adapter cap, so the pager reflects the whole export: 10 + 10 + 5.
    await expect(page.locator('#cardReading .article-list-item')).toHaveCount(10)
    await expect(page.locator('#cardReading .article-page-btn')).toHaveCount(3)
    await expect(page.locator('#cardReading .article-page-btn').first()).toHaveAttribute('aria-current', 'page')
    await expect(page.locator('#cardReading')).toContainText('Paginated article 1 of twenty-five')

    await page.locator('#cardReading .article-page-btn[data-page="3"]').click()

    // The last page carries the 5-article remainder, and the current-page marker moves with it.
    await expect(page.locator('#cardReading .article-list-item')).toHaveCount(5)
    await expect(page.locator('#cardReading .article-page-btn[data-page="3"]')).toHaveAttribute('aria-current', 'page')
    await expect(page.locator('#cardReading')).toContainText('Paginated article 25 of twenty-five')
    await expect(page.locator('#cardReading')).not.toContainText('Paginated article 1 of twenty-five')

    await expectNoNewAxeViolations(page, 'articles/pagination')
  })

  // covers: articles-render#The feed caps the export at thirty articles
  test('caps a forty-article export at the thirty most recent', async ({page}) => {
    await loadDashboard(page, {[ENDPOINTS.articles]: fixture('articles', 'overThirty')}, '#cardReading')

    // 40 articles capped to 30 gives exactly 3 pages. A 4th page button would mean the cap is gone.
    await expect(page.locator('#cardReading .article-page-btn')).toHaveCount(3)
    await expect(page.locator('#cardReading .article-list-item')).toHaveCount(10)

    await page.locator('#cardReading .article-page-btn[data-page="3"]').click()

    // The final page ends at article 30; 31 through 40 were dropped by the adapter, not paged away.
    await expect(page.locator('#cardReading .article-list-item')).toHaveCount(10)
    await expect(page.locator('#cardReading')).toContainText('Article title number 30 in large dataset')
    await expect(page.locator('#cardReading')).not.toContainText('Article title number 31 in large dataset')

    await expectNoNewAxeViolations(page, 'articles/overThirty')
  })
})
