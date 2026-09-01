import {expect, test} from '@playwright/test'
import {CLOUDFRONT_BASE, ENDPOINTS} from '@j0nathan-ll0yd/portal-contract/constants'
import {expectNoNewAxeViolations} from './a11y'
import {fixture, interceptDashboard, loadDashboard} from './dashboard-fixtures'

// Dev Activity Log (GitHub events) render conformance. Behavioral DOM assertions only; the dev-log
// screenshot in tests/visual/widgets.spec.ts is supplementary and is never this suite's oracle.
//
// The detail slot is type-dependent and the precedence matters: a commit WITH a hash renders its
// additions/deletions, and everything else carrying a number renders `#<number>`. The baseline
// fixture's pull requests carry BOTH a hash and a number, so they pin that precedence rather than
// merely exercising one branch. Relative dates ("2w ago") are not asserted -- they are computed
// against the browser clock, which this suite does not freeze.

test.describe('Dev Activity Log Render Conformance', () => {
  // covers: devlog-render#Loading state keeps the dev log in its loading presentation
  test('keeps the loading presentation while the events request is pending', async ({page}) => {
    await interceptDashboard(page)
    await page.route(`${CLOUDFRONT_BASE}${ENDPOINTS.githubEvents}**`, () => new Promise(() => {}))

    await page.goto('/', {waitUntil: 'domcontentloaded'})

    await expect(page.locator('#cardDevLog.is-loading')).toBeVisible()

    await expectNoNewAxeViolations(page, 'devlog/loading')
  })

  // covers: devlog-render#Empty state renders the dev-log empty message without activity lines
  test('renders the empty state without activity lines', async ({page}) => {
    await loadDashboard(page, {[ENDPOINTS.githubEvents]: fixture('github-events', 'empty')}, '#cardDevLog')

    await expect(page.locator('#cardDevLog .widget-empty')).toHaveText('No recent activity')
    await expect(page.locator('#cardDevLog .gh-dal-line')).toHaveCount(0)

    await expectNoNewAxeViolations(page, 'devlog/empty')
  })

  // covers: devlog-render#Baseline activity renders one line per event with its repo and title
  test('renders one line per baseline event with its repo and title', async ({page}) => {
    await loadDashboard(page, {}, '#cardDevLog')

    const lines = page.locator('#cardDevLog .gh-dal-line')
    await expect(lines).toHaveCount(5)
    await expect(lines.nth(0).locator('.gh-dal-title')).toHaveText('Add component catalog fleet generation')
    await expect(lines.nth(3).locator('.gh-dal-title')).toHaveText('Fix reading-feed items hidden by an animation race')
    await expect(lines.nth(4).locator('.gh-dal-title')).toHaveText('Stop advertising the retired llms-small.txt')
    // Every line is an outbound link, so each carries the safe-link attributes.
    await expect(lines.nth(0)).toHaveAttribute('target', '_blank')
    await expect(lines.nth(0)).toHaveAttribute('rel', 'noopener noreferrer')

    await expectNoNewAxeViolations(page, 'devlog/baseline')
  })

  // covers: devlog-render#Repository names are rendered without their owner prefix
  test('strips the owner prefix from every repository name', async ({page}) => {
    await loadDashboard(page, {}, '#cardDevLog')

    const repos = page.locator('#cardDevLog .gh-dal-repo')
    await expect(repos).toHaveCount(5)
    // The export ships `j0nathan-ll0yd/<repo>`; the owner is constant across the feed and would
    // waste the narrow line, so only the repository segment is rendered.
    await expect(repos.nth(0)).toHaveText('design-system-Lifegames')
    await expect(repos.nth(1)).toHaveText('j0nathan-ll0yd.github.io')
    await expect(page.locator('#cardDevLog')).not.toContainText('j0nathan-ll0yd/design-system-Lifegames')
    // The stripped owner must survive in the href, which needs the fully qualified repository.
    await expect(page.locator('#cardDevLog .gh-dal-line').nth(0)).toHaveAttribute('href',
      'https://github.com/j0nathan-ll0yd/design-system-Lifegames/commit/67fd9f2')

    await expectNoNewAxeViolations(page, 'devlog/repoNames')
  })

  // covers: devlog-render#Commit events render their additions and deletions and link to the commit
  test('renders the additions and deletions of every commit event', async ({page}) => {
    await loadDashboard(page, {[ENDPOINTS.githubEvents]: fixture('github-events', 'commitsOnly')}, '#cardDevLog')

    const lines = page.locator('#cardDevLog .gh-dal-line')
    await expect(lines).toHaveCount(5)
    await expect(page.locator('#cardDevLog .gh-dal-detail')).toHaveCount(5)
    // A zero deletion count still renders, so the pair always reads as a diffstat.
    await expect(lines.nth(0).locator('.gh-dal-detail')).toHaveText('+10 -0')
    await expect(lines.nth(4).locator('.gh-dal-detail')).toHaveText('+50 -12')
    await expect(lines.nth(0)).toHaveAttribute('href', 'https://github.com/j0nathan-ll0yd/j0nathan-ll0yd.github.io/commit/9deedf9')

    await expectNoNewAxeViolations(page, 'devlog/commits')
  })

  // covers: devlog-render#Pull-request events render their number and link to the pull request
  test('renders the number and pull-request permalink of every pull-request event', async ({page}) => {
    await loadDashboard(page, {[ENDPOINTS.githubEvents]: fixture('github-events', 'prsOnly')}, '#cardDevLog')

    const lines = page.locator('#cardDevLog .gh-dal-line')
    await expect(lines).toHaveCount(5)
    await expect(lines.nth(0).locator('.gh-dal-detail')).toHaveText('#42')
    await expect(lines.nth(3).locator('.gh-dal-detail')).toHaveText('#206')
    await expect(lines.nth(0)).toHaveAttribute('href', 'https://github.com/j0nathan-ll0yd/j0nathan-ll0yd.github.io/pull/42')
    await expect(lines.nth(3)).toHaveAttribute('href', 'https://github.com/j0nathan-ll0yd/design-system-Lifegames/pull/206')

    await expectNoNewAxeViolations(page, 'devlog/pullRequests')
  })

  // covers: devlog-render#The log caps the feed at ten events
  test('caps a fifteen-event export at ten lines', async ({page}) => {
    await loadDashboard(page, {[ENDPOINTS.githubEvents]: fixture('github-events', 'overTen')}, '#cardDevLog')

    await expect(page.locator('#cardDevLog .gh-dal-line')).toHaveCount(10)
    await expect(page.locator('#cardDevLog')).toContainText('Stop advertising the retired llms-small.txt')
    // The 11th event onward is dropped by the adapter, so its title never reaches the DOM.
    await expect(page.locator('#cardDevLog')).not.toContainText('Block new uncovered OpenSpec requirements')
    await expect(page.locator('#cardDevLog')).not.toContainText('Activate Docker-free prebuilt-image deploys')

    await expectNoNewAxeViolations(page, 'devlog/overTen')
  })
})
