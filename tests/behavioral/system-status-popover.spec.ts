/**
 * SystemStatus provenance disclosure behavioral tests.
 *
 * Asserts DOM/interaction behavior only (no screenshots). Uses the production
 * build with baseline fixtures, asserting the Health row's .sys-info button
 * + #tip-health popover (Health has the most links — canonical example):
 *   - SSR: 7 info buttons (Health, Sleep, Books, Articles, GithubEvents,
 *     StarredRepos, TheatreReviews).
 *   - Click opens popover; Escape closes + focus returns to the button.
 *   - Enter and Space keyboard activation.
 *   - Exact link href / rel / target inside the popover.
 *   - ARIA: aria-label + aria-details on the button; aria-expanded toggles
 *     (browser-managed via Popover API invoker); role="group" + aria-label on
 *     the popover; no role="tooltip".
 *   - Outside-click light-dismiss (auto popover behavior).
 *
 * Plan §4.1 acceptance criteria. Mirrors tests/behavioral/book-modal.spec.ts.
 */
import {createRequire} from 'node:module'
import {expect, type Page, test} from '@playwright/test'
import {CLOUDFRONT_BASE, WEBSOCKET_URL} from '@j0nathan-ll0yd/portal-contract/constants'

const require = createRequire(import.meta.url)

function baselineFixture(dir: string, file: string): string {
  const camelFile = file.replace(/-([a-z0-9])/g, (_, c: string) => c.toUpperCase())
  return require.resolve(`@j0nathan-ll0yd/fixtures/generated/${dir}/${camelFile}.json`)
}

const TRANSPARENT_PIXEL = Buffer.from('iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAYAAAAfFcSJAAAAC0lEQVQI12NgAAIABQAB' + 'Nl7BcQAAAABJRU5ErkJggg==', 'base64')

async function interceptRoutes(page: Page): Promise<void> {
  await page.route(`${CLOUDFRONT_BASE}/**`, async (route) => {
    const url = new URL(route.request().url())
    const fixtureMap: Record<string, string> = {
      '/health.json': baselineFixture('health', 'baseline'),
      '/sleep.json': baselineFixture('sleep', 'baseline'),
      '/workouts.json': baselineFixture('workouts', 'baseline'),
      '/books.json': baselineFixture('books', 'baseline'),
      '/github-starred-repos.json': baselineFixture('github-starred-repos', 'baseline'),
      '/github-events.json': baselineFixture('github-events', 'baseline'),
      '/articles.json': baselineFixture('articles', 'baseline'),
      '/focus.json': baselineFixture('focus', 'empty'),
      '/theatre-reviews.json': baselineFixture('theatre-reviews', 'baseline')
    }
    const fixturePath = fixtureMap[url.pathname]
    if (fixturePath) {
      await route.fulfill({path: fixturePath, contentType: 'application/json'})
    } else {
      await route.abort()
    }
  })

  await page.route(`${WEBSOCKET_URL}/**`, (route) => route.abort())

  await page.route('**/*', async (route) => {
    const url = route.request().url()
    if (
      url.startsWith('http://localhost') ||
      url.startsWith('data:') ||
      url.startsWith(CLOUDFRONT_BASE) ||
      url.startsWith(WEBSOCKET_URL.replace('wss://', 'https://')) ||
      url.startsWith('wss://')
    ) {
      await route.fallback()
      return
    }
    if (route.request().resourceType() === 'image') {
      await route.fulfill({status: 200, contentType: 'image/png', body: TRANSPARENT_PIXEL})
    } else {
      await route.abort()
    }
  })
}

async function navigateAndWaitForHydration(page: Page): Promise<void> {
  await page.goto('/')
  await page.waitForFunction(() => document.querySelectorAll('.is-loading').length === 0, {timeout: 15_000})
}

// ---------------------------------------------------------------------------
// Selectors
// ---------------------------------------------------------------------------

// Health is the canonical test target: it has three links in its popover.
const HEALTH_BUTTON = '#systemStatus .sys-line[data-source="health"] .sys-info'
const HEALTH_POPOVER = '#tip-health'
// First link in the Health popover: Apple Watch 11 (exact URL from @j0nathan-ll0yd/copy)
const WATCH_LINK_HREF = 'https://www.apple.com/apple-watch-series-11/'

// ---------------------------------------------------------------------------
// Suite
// ---------------------------------------------------------------------------

test.describe('SystemStatus provenance disclosure — popover behavior', () => {
  test.describe.configure({mode: 'serial'})

  let page: Page

  test.beforeAll(async ({browser}) => {
    page = await browser.newPage()
    await interceptRoutes(page)
    await navigateAndWaitForHydration(page)
  })

  test.afterAll(async () => {
    await page.close()
  })

  // Close the Health popover between tests so each test starts from a clean state.
  test.afterEach(async () => {
    const isOpen = await page.evaluate(() => document.getElementById('tip-health')?.matches(':popover-open') ?? false)
    if (isOpen) {
      await page.keyboard.press('Escape')
      await page.waitForFunction(() => !(document.getElementById('tip-health')?.matches(':popover-open') ?? false), {timeout: 3000})
    }
  })

  // -----------------------------------------------------------------------
  // 1. SSR structure — 7 buttons present
  // -----------------------------------------------------------------------
  test('1. seven .sys-info buttons rendered', async () => {
    const buttons = page.locator('#systemStatus .sys-info')
    // Health, Sleep, Books, Articles, GithubEvents, StarredRepos, TheatreReviews
    await expect(buttons).toHaveCount(7)
  })

  // -----------------------------------------------------------------------
  // 2. Click opens the popover (:popover-open / visible)
  // -----------------------------------------------------------------------
  test('2. clicking the Health .sys-info opens #tip-health', async () => {
    await page.locator(HEALTH_BUTTON).click()

    const popover = page.locator(HEALTH_POPOVER)
    await expect(popover).toBeVisible()

    // UA :popover-open pseudo-class
    const isOpen = await page.evaluate(() => document.getElementById('tip-health')?.matches(':popover-open') ?? false)
    expect(isOpen).toBe(true)
  })

  // -----------------------------------------------------------------------
  // 2b. Positioning regression guard (the bug the shipped feature slipped past)
  //
  // Root cause: the implicit popovertarget anchor did not resolve on the
  // @starting-style re-layout, so Chromium's "position-area with no valid
  // anchor" path placed the popover at viewport 0,0. The fix wires explicit
  // per-source anchor-name/position-anchor pairs. This test asserts geometry
  // that is CORRECT for `position-area: bottom span-inline-start` (the box
  // grows DOWN and toward inline-start; the trigger aligns with the box's
  // RIGHT edge — so do NOT assert `left ≈ trigger.left`).
  //
  // Must be settle-aware: the failure manifests only after the entry
  // opacity+scale transition, so we poll until the rect is stable before
  // asserting.
  // -----------------------------------------------------------------------
  test('2b. opened popover anchors adjacent to its trigger (no top-left jump, no centered fallback)', async () => {
    await page.locator(HEALTH_BUTTON).click()
    await expect(page.locator(HEALTH_POPOVER)).toBeVisible()

    const popover = page.locator(HEALTH_POPOVER)

    // Settle: poll until the popover's top is stable across two consecutive
    // reads (absorbs the scale entry animation), then read the final rect.
    let prevTop: number | null = null
    await expect.poll(async () => {
      const box = await popover.boundingBox()
      if (!box) {
        return false
      }
      const stable = prevTop !== null && Math.abs(box.y - prevTop) < 0.5
      prevTop = box.y
      return stable
    }, {timeout: 3000, intervals: [100, 100, 100, 100]}).toBe(true)

    const pop = await popover.boundingBox()
    const trig = await page.locator(HEALTH_BUTTON).boundingBox()
    if (!pop || !trig) {
      throw new Error('missing bounding box')
    }

    const popTop = pop.y
    const popBottom = pop.y + pop.height
    const popLeft = pop.x
    const popRight = pop.x + pop.width
    const trigTop = trig.y
    const trigBottom = trig.y + trig.height
    const trigCenterX = trig.x + trig.width / 2

    // (a) Block adjacency (primary discriminator): the popover's near block edge
    // hugs the trigger. Separates the ANCHORED state from BOTH failure modes —
    // the top-left bug (top ≈ 0) and the centered fallback (bottom: 1rem, pinned
    // near the viewport bottom, far from the trigger).
    const blockGap = Math.min(Math.abs(popTop - trigBottom), Math.abs(popBottom - trigTop))
    expect(blockGap).toBeLessThan(16)

    // (b) Inline proximity: the nearest horizontal edge of the popover is close
    // to the trigger's center-x (accounts for `flip-inline`). NOT `left ≈ trigger.left`.
    const inlineGap = Math.min(Math.abs(popRight - trigCenterX), Math.abs(popLeft - trigCenterX))
    expect(inlineGap).toBeLessThan(48)

    // Explicitly kill the exact shipped bug: the popover must not sit at the
    // viewport top. (Implied by (a), asserted for clarity.)
    expect(popTop).toBeGreaterThan(16)

    // Caret presence: with anchoring active the clip-path + at least one caret
    // pseudo-element must be live. clip-path on the popover is non-none, and the
    // up-caret ::before has generated content.
    const caret = await popover.evaluate((el) => ({
      clipPath: getComputedStyle(el).clipPath,
      beforeContent: getComputedStyle(el, '::before').content,
      afterContent: getComputedStyle(el, '::after').content
    }))
    expect(caret.clipPath).not.toBe('none')
    // One of the two carets is revealed depending on block flip; both have
    // generated content (the clip-path hides the wrong one visually).
    expect(caret.beforeContent === 'none' && caret.afterContent === 'none').toBe(false)
  })

  // -----------------------------------------------------------------------
  // 3. Escape closes the popover + focus returns to the invoking button
  // -----------------------------------------------------------------------
  test('3. Escape closes the popover and returns focus to the button', async () => {
    await page.locator(HEALTH_BUTTON).click()
    await expect(page.locator(HEALTH_POPOVER)).toBeVisible()

    await page.keyboard.press('Escape')

    await expect(page.locator(HEALTH_POPOVER)).toBeHidden()

    // Popover API guarantees focus returns to the invoker on close.
    const isFocused = await page.evaluate(() => {
      const btn = document.querySelector('#systemStatus .sys-line[data-source="health"] .sys-info') as HTMLElement | null
      return document.activeElement === btn
    })
    expect(isFocused).toBe(true)
  })

  // -----------------------------------------------------------------------
  // 4a. Enter keyboard activation
  // -----------------------------------------------------------------------
  test('4a. Enter on the focused button opens the popover', async () => {
    await page.locator(HEALTH_BUTTON).focus()
    await page.keyboard.press('Enter')
    await expect(page.locator(HEALTH_POPOVER)).toBeVisible()
  })

  // -----------------------------------------------------------------------
  // 4b. Space keyboard activation
  // -----------------------------------------------------------------------
  test('4b. Space on the focused button opens the popover', async () => {
    await page.locator(HEALTH_BUTTON).focus()
    await page.keyboard.press('Space')
    await expect(page.locator(HEALTH_POPOVER)).toBeVisible()
  })

  // -----------------------------------------------------------------------
  // 5a. Link attributes — first link (Apple Watch 11)
  // -----------------------------------------------------------------------
  test('5a. Health popover Apple Watch link: correct href, rel="noopener noreferrer", target="_blank"', async () => {
    await page.locator(HEALTH_BUTTON).click()
    await expect(page.locator(HEALTH_POPOVER)).toBeVisible()

    const link = page.locator(`${HEALTH_POPOVER} a[href="${WATCH_LINK_HREF}"]`)
    await expect(link).toHaveAttribute('href', WATCH_LINK_HREF)
    await expect(link).toHaveAttribute('rel', 'noopener noreferrer')
    await expect(link).toHaveAttribute('target', '_blank')
  })

  // -----------------------------------------------------------------------
  // 5b. Outside-click light-dismisses the popover (auto popover)
  // -----------------------------------------------------------------------
  test('5b. clicking outside the popover light-dismisses it', async () => {
    await page.locator(HEALTH_BUTTON).click()
    await expect(page.locator(HEALTH_POPOVER)).toBeVisible()

    // Click at top-right corner — well outside the left-panel system-status widget.
    const vp = page.viewportSize()!
    await page.mouse.click(vp.width - 10, 10)

    await expect(page.locator(HEALTH_POPOVER)).toBeHidden()
  })

  // -----------------------------------------------------------------------
  // 6. ARIA: button carries aria-label + aria-details
  // -----------------------------------------------------------------------
  test('6. button has correct aria-label and aria-details', async () => {
    const button = page.locator(HEALTH_BUTTON)
    await expect(button).toHaveAttribute('aria-label', 'More information about the Health data source')
    await expect(button).toHaveAttribute('aria-details', 'tip-health')
  })

  // -----------------------------------------------------------------------
  // 7. ARIA: aria-expanded must NOT be hand-set (Popover API manages via AOM)
  // -----------------------------------------------------------------------
  test('7. aria-expanded is NOT a DOM content attribute — widget lets Popover API manage it', async () => {
    const button = page.locator(HEALTH_BUTTON)

    // The plan (§2 ARIA decision) explicitly prohibits hand-setting aria-expanded.
    // The Popover API invoker manages expanded state via the accessibility object
    // model, not as a DOM content attribute. Verify the widget is correctly
    // absent of a hardcoded aria-expanded attribute in both open and closed states.
    expect(await button.evaluate((el) => el.getAttribute('aria-expanded'))).toBeNull()

    await button.click()
    await expect(page.locator(HEALTH_POPOVER)).toBeVisible()

    // Open: still null — browser manages this internally; widget must not set it
    expect(await button.evaluate((el) => el.getAttribute('aria-expanded'))).toBeNull()
  })

  // -----------------------------------------------------------------------
  // 8. ARIA: popover role + label; no role="tooltip" anywhere
  // -----------------------------------------------------------------------
  test('8. popover has role="group" + aria-label; no role="tooltip" in #cardSystem', async () => {
    const popover = page.locator(HEALTH_POPOVER)
    await expect(popover).toHaveAttribute('role', 'group')
    await expect(popover).toHaveAttribute('aria-label', 'Health data source')

    // Plan explicitly forbids role="tooltip" (this is a disclosure, not a tooltip)
    await expect(page.locator('#cardSystem [role="tooltip"]')).toHaveCount(0)
  })
})
