import {expect, type Page, test} from '@playwright/test'
import {ENDPOINTS} from '@j0nathan-ll0yd/portal-contract/constants'
import {expectLiveReady, fixture, interceptBrowserOnly, loadDashboard, serveDataFreePage} from './dashboard-fixtures'
import {expectRowsFailVisible} from '../shared/fail-visible'

// Dashboard motion, read from the built site's own stylesheet set (@j0nathan-ll0yd/web 4.7.0, DS #358).
// Five animations named keyframes only `tokens/animations` defined, and this site never imports that
// file, so they never ran. These checks read the browser's own animation list, never a screenshot.

/** Longer than the longest finite entry on the page, stagger included, so a negative result means none started. */
const ENTRY_SETTLE_MS = 1500

/** The data states that stop a card's live dot (web `components.css`: "nothing is live"). */
const QUIET_STATES = ['unavailable', 'suppressed', 'stale', 'loading']
const QUIET_DOTS = QUIET_STATES.map((state) => `.tri-card[data-ssr-state='${state}'] .live-dot`).join(', ')
const LIVE_DOTS = `.live-dot:not(${QUIET_DOTS})`

interface StartedAnimation {
  name: string
  iterations: number | null
}

/** Records every CSS animation that fires `animationstart`, because a finished entry leaves `getAnimations()`. */
async function recordAnimationStarts(page: Page): Promise<void> {
  await page.addInitScript(() => {
    const log: {name: string; className: string; iterations: number | null}[] = []
    ;(window as unknown as {__motionLog: typeof log}).__motionLog = log
    document.addEventListener('animationstart', (event) => {
      const target = event.target as Element
      const running = target.getAnimations().find((animation) => (animation as CSSAnimation).animationName === event.animationName)
      log.push({
        name: event.animationName,
        className: target.getAttribute('class') ?? '',
        iterations: running?.effect?.getComputedTiming().iterations ?? null
      })
    }, true)
  })
}

async function startedOn(page: Page, classToken: string): Promise<StartedAnimation[]> {
  return page.evaluate((token) => {
    const log = (window as unknown as {__motionLog: {name: string; className: string; iterations: number | null}[]}).__motionLog
    return log.filter((entry) => entry.className.split(/\s+/).includes(token)).map(({name, iterations}) => ({name, iterations}))
  }, classToken)
}

/** The CSS animation names running now on every element and pseudo-element of the page. */
async function runningAnimationNames(page: Page): Promise<string[]> {
  return page.evaluate(() =>
    document.getAnimations().flatMap((animation) => {
      const name = (animation as CSSAnimation).animationName
      return name === undefined ? [] : [name]
    })
  )
}

/** The animation names on each match of `selector`. */
async function namesOnEach(page: Page, selector: string): Promise<string[][]> {
  return page.locator(selector).evaluateAll((elements) =>
    elements.map((element) => element.getAnimations().map((animation) => (animation as CSSAnimation).animationName))
  )
}

/**
 * Shows a feed page and reads each new row's animations the moment the rows arrive, before they can
 * finish, then cancels them. A mutation observer waits for the rows, because the runtime swaps them
 * inside a View Transition without a reduced-motion preference and synchronously under one.
 */
function showPageAndCancelEntry(page: Page, target: number) {
  return page.evaluate((pageNumber) =>
    new Promise<{names: string[]; iterations: (number | undefined)[]; opacity: string}[]>((resolve) => {
      const body = document.querySelector('#cardReading .widget-body') as HTMLElement
      new MutationObserver((_records, observer) => {
        observer.disconnect()
        resolve(Array.from(body.querySelectorAll('.article-list-item')).map((row) => {
          const animations = row.getAnimations() as CSSAnimation[]
          const read = {
            names: animations.map((animation) => animation.animationName),
            iterations: animations.map((animation) => animation.effect?.getComputedTiming().iterations)
          }
          animations.forEach((animation) => animation.cancel())
          return {...read, opacity: getComputedStyle(row).opacity}
        }))
      }).observe(body, {childList: true})
      body.querySelector<HTMLElement>(`.article-page-btn[data-page="${pageNumber}"]`)?.click()
    }), target)
}

test.describe('Dashboard motion', () => {
  // covers: dashboard-shell#Dashboard motion runs from the site's own stylesheets and stops under reduced motion
  test('runs the named pulses on the live dots, the status dots and the name', async ({page}) => {
    await page.emulateMedia({reducedMotion: 'no-preference'})
    await loadDashboard(page, {}, '#cardReading')

    for (const [selector, name] of [[LIVE_DOTS, 'dotPulse'], ['.sys-dot', 'dotPulse'], ['.id-name', 'glowPulse']] as const) {
      const names = await namesOnEach(page, selector)
      expect(names.length, `${selector}: elements to check`).toBeGreaterThan(0)
      for (const [index, list] of names.entries()) {
        expect(list, `${selector} ${index}`).toEqual([name])
      }
    }
    // A card that shows no live value stops its dot: the design system's "nothing is live" rule.
    for (const [index, list] of (await namesOnEach(page, QUIET_DOTS)).entries()) {
      expect(list, `quiet dot ${index}`).toEqual([])
    }
  })

  // covers: dashboard-shell#Dashboard motion runs from the site's own stylesheets and stops under reduced motion
  test('runs a finite entry on each Reading Feed row, and a row shows when that entry is cancelled', async ({page}) => {
    await page.emulateMedia({reducedMotion: 'no-preference'})
    await recordAnimationStarts(page)
    await loadDashboard(page, {[ENDPOINTS.articles]: fixture('articles', 'pagination')}, '#cardReading')

    const rows = page.locator('#cardReading .article-list-item')
    await expect(rows).toHaveCount(10)
    await expect(page.locator('#cardReading .article-page-btn'), 'the repaint adds the pager').toHaveCount(3)
    // The runtime repaints a server feed once at hand-off (live-data.ts `repaint.articles`), so a row
    // that started before the repaint counts twice. Each of the ten final rows starts at least once.
    await expect.poll(() => startedOn(page, 'article-list-item').then((started) => started.length), {message: 'an entry start per row'})
      .toBeGreaterThanOrEqual(10)
    for (const started of await startedOn(page, 'article-list-item')) {
      expect(started).toEqual({name: 'fadeSlideRight', iterations: 1})
    }

    const shown = await showPageAndCancelEntry(page, 3)
    expect(shown.length, 'the last page of 25 articles').toBe(5)
    for (const row of shown) {
      expect(row).toEqual({names: ['fadeSlideRight'], iterations: [1], opacity: '1'})
    }
    await expectRowsFailVisible(rows, 'after the entry')
  })

  // covers: dashboard-shell#Dashboard motion runs from the site's own stylesheets and stops under reduced motion
  test('draws the shimmer on a loading skeleton', async ({page}) => {
    await page.emulateMedia({reducedMotion: 'no-preference'})
    await interceptBrowserOnly(page, {})
    await serveDataFreePage(page)
    await page.route('https://**/*.json', () => new Promise(() => {}))
    await page.goto('/', {waitUntil: 'domcontentloaded'})

    await expect(page.locator('#cardReading .skeleton-bar').first()).toBeVisible()
    const shimmers = await page.locator('#cardReading .skeleton-bar').first().evaluate((bar) =>
      bar.getAnimations({subtree: true}).map((animation) => {
        const css = animation as CSSAnimation
        return {name: css.animationName, pseudo: (css.effect as KeyframeEffect).pseudoElement}
      })
    )
    expect(shimmers).toEqual([{name: 'shimmerSlide', pseudo: '::after'}])
  })

  // covers: dashboard-shell#Dashboard motion runs from the site's own stylesheets and stops under reduced motion
  test('starts no CSS animation under reduced motion, populated, paged or loading', async ({page}) => {
    await page.emulateMedia({reducedMotion: 'reduce'})
    await recordAnimationStarts(page)
    await loadDashboard(page, {[ENDPOINTS.articles]: fixture('articles', 'pagination')}, '#cardReading')
    await expect(page.locator('#cardReading .article-page-btn'), 'the repaint adds the pager').toHaveCount(3)
    await page.waitForTimeout(ENTRY_SETTLE_MS)
    expect(await page.evaluate(() => (window as unknown as {__motionLog: unknown[]}).__motionLog), 'populated: every animation start').toEqual([])
    expect(await runningAnimationNames(page), 'populated: running now').toEqual([])

    const shown = await showPageAndCancelEntry(page, 3)
    expect(shown.length, 'the last page of 25 articles').toBe(5)
    for (const row of shown) {
      expect(row, 'a paged row').toEqual({names: [], iterations: [], opacity: '1'})
    }
    await expectRowsFailVisible(page.locator('#cardReading .article-list-item'), 'reduced motion')
    await page.waitForTimeout(ENTRY_SETTLE_MS)
    expect(await page.evaluate(() => (window as unknown as {__motionLog: unknown[]}).__motionLog), 'paged: every animation start').toEqual([])
  })

  // covers: dashboard-shell#Dashboard motion runs from the site's own stylesheets and stops under reduced motion
  test('starts no CSS animation under reduced motion on the data-free page', async ({page}) => {
    await page.emulateMedia({reducedMotion: 'reduce'})
    await recordAnimationStarts(page)
    await interceptBrowserOnly(page)
    await serveDataFreePage(page)
    await page.goto('/')
    await expectLiveReady(page)
    await page.waitForTimeout(ENTRY_SETTLE_MS)

    expect(await page.evaluate(() => (window as unknown as {__motionLog: unknown[]}).__motionLog), 'every animation start').toEqual([])
    expect(await runningAnimationNames(page), 'running now').toEqual([])
  })
})
