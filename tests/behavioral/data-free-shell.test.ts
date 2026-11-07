import {createRequire} from 'node:module'
import {expect, type Page, test} from '@playwright/test'
import {CLOUDFRONT_BASE, WEBSOCKET_URL} from '@j0nathan-ll0yd/portal-contract/constants'
import {FIXTURE_SENTINELS, LIVE_CARD_IDS, RETIRED_OVERLAY_ROWS} from '../shared/fixture-sentinels'
import {expectLiveReady, serveDataFreePage} from './dashboard-fixtures'

// The data-free `/` in a real browser (atlas decision 0160, PR 0a; openspec/specs/dashboard-shell).
//
// Since PR B the Worker renders `/` per request, so the data-free page is the prerendered fallback
// (served when a render misses its ceiling, and the rollback content, decisions D2 and D9). Each
// test answers `/` with that page (`serveDataFreePage`, byte for byte dist/client/index.html); the
// server render itself is tests/behavioral/ssr-no-js.test.ts.
//
// Before PR 0a the page shipped design-system fixture values as its server HTML, so a client that
// runs no JavaScript read fabricated vitals, books and repos under "live" badges, for good, and a
// client that does run it read them for the seconds before the first fetch landed. These tests
// assert the page a visitor actually sees, with scripts off and with scripts on before any data
// arrives. Behavioral DOM assertions only: the re-baselined screenshots are not this suite's
// evidence (a baseline minted by the change it verifies proves nothing).

// The copy package's TypeScript entry cannot load in this runner; its flat JSON exports can.
const copyRequire = createRequire(import.meta.url)
const widgets = copyRequire('@j0nathan-ll0yd/copy/widgets.flat.json') as {widgetState: {needsJavaScript: string}}
const identity = copyRequire('@j0nathan-ll0yd/copy/identity.flat.json') as {person: {name: string; jobTitle: string; flavorBio: string; sameAs: string[]}}
const profile = copyRequire('@j0nathan-ll0yd/copy/profile.flat.json') as {tagline: string; terminal: Record<string, string[]>}

const squash = (value: string): string => value.replace(/\s+/g, '')

/** Abort every request that leaves the local preview server, so no test reads the network. */
async function stayLocal(page: Page): Promise<void> {
  await page.routeWebSocket(WEBSOCKET_URL, () => {})
  await page.route('**/*', async (route) => {
    const url = route.request().url()
    if (url.startsWith('http://localhost') || url.startsWith('data:')) {
      await route.fallback()
      return
    }
    await route.abort()
  })
}

async function expectNoFixtureValue(page: Page): Promise<void> {
  const html = await page.content()
  const text = await page.locator('body').innerText()
  for (const {text: sentinel, source} of FIXTURE_SENTINELS) {
    expect(html, `fixture value "${sentinel}" (${source}) in the page`).not.toContain(sentinel)
    expect(text).not.toContain(sentinel)
  }
  for (const row of RETIRED_OVERLAY_ROWS) {
    expect(html, `retired DndOverlay row "${row}" in the page`).not.toContain(row)
  }
  await expect(page.locator('#pulseBpm')).toHaveText('')
}

test.describe('Data-free dashboard with JavaScript disabled', () => {
  test.use({javaScriptEnabled: false})

  test.beforeEach(async ({page}) => {
    await stayLocal(page)
    await serveDataFreePage(page)
    await page.goto('/')
  })

  // covers: dashboard-shell#The built page carries no fixture value
  test('shows no fixture value', async ({page}) => {
    await expectNoFixtureValue(page)
    await expect(page.locator('[data-generated-at]')).toHaveCount(0)
  })

  // covers: dashboard-shell#Every live card renders its honest loading state
  test('renders every live card loading, with its noscript note visible', async ({page}) => {
    await expect(page.locator('[data-ssr-state]')).toHaveCount(LIVE_CARD_IDS.length)
    for (const id of LIVE_CARD_IDS) {
      const card = page.locator(`#${id}`)
      await expect(card, `#${id}`).toBeVisible()
      await expect(card, `#${id}`).toHaveAttribute('data-ssr-state', 'loading')
      const note = card.locator('.widget-noscript[data-state-notice="loading"]')
      await expect(note, `#${id} noscript note`).toBeVisible()
      await expect(note, `#${id} noscript note`).toHaveText(widgets.widgetState.needsJavaScript)
    }
    // System Status names no status or age for a source the page never read.
    await expect(page.locator('#systemStatus .sys-line')).toHaveCount(7)
    await expect(page.locator('#systemStatus')).not.toContainText(/ACTIVE|OFFLINE|PENDING/)
    // Neither focus overlay claims a focus mode the page never read.
    await expect(page.locator('#focusOverlay')).toBeHidden()
    await expect(page.locator('#dndOverlay')).toBeHidden()
  })

  // covers: dashboard-shell#The identity content is authored copy and renders without JavaScript
  test('shows the authored identity content', async ({page}) => {
    const body = page.locator('body')
    await expect(body).toContainText(identity.person.name)
    await expect(body).toContainText(identity.person.jobTitle)
    await expect(body).toContainText(identity.person.flavorBio)
    await expect(body).toContainText(profile.tagline)

    const terminal = squash(await page.locator('#cardBio').innerText())
    for (const line of Object.values(profile.terminal).flat()) {
      expect(terminal, `terminal line ${line}`).toContain(squash(line))
    }
    for (const url of identity.person.sameAs) {
      await expect(page.locator(`a[href="${url}"]`).first(), url).toBeVisible()
    }
  })
})

test.describe('Data-free dashboard with JavaScript enabled', () => {
  // covers: dashboard-shell#The built page carries no fixture value
  test('shows no fixture value while the first data request is outstanding', async ({page}) => {
    await stayLocal(page)
    await serveDataFreePage(page)
    // Hold every CloudFront request open: the slow-link case the fixture shell used to fill.
    await page.route(`${CLOUDFRONT_BASE}/**`, () => new Promise(() => {}))
    await page.goto('/', {waitUntil: 'domcontentloaded'})

    await expectNoFixtureValue(page)
    for (const id of LIVE_CARD_IDS) {
      await expect(page.locator(`#${id}`), `#${id}`).toHaveAttribute('data-ssr-state', 'loading')
      // Scripts run, so the noscript note is inert.
      await expect(page.locator(`#${id} .widget-noscript`)).toHaveCount(0)
    }
  })

  // covers: dashboard-shell#A failed first read renders the unavailable state
  test('renders every card unavailable, value-free, when the data plane is down', async ({page}) => {
    await stayLocal(page)
    await serveDataFreePage(page)
    await page.route(`${CLOUDFRONT_BASE}/**`, (route) => route.abort())
    await page.goto('/')
    // live-data.ts sets data-live-ready once its first read and first writes end, success or not.
    await expectLiveReady(page)

    await expectNoFixtureValue(page)
    // The focus read failed too, so every gated read is unreadable: each card shows the server's
    // `unavailable` state, never a `loading` card that will not load.
    for (const id of LIVE_CARD_IDS) {
      const card = page.locator(`#${id}`)
      await expect(card, `#${id}`).toHaveAttribute('data-ssr-state', 'unavailable')
      await expect(card.locator('[data-state-notice="unavailable"]'), `#${id} notice`).toBeVisible()
    }
    await expect(page.locator('#systemStatus')).not.toContainText('ACTIVE')
  })
})

// The DS fit check on the real page: its fixture once hid a clip by skipping `SiteFooterNav`, which
// loads `primitives.css`. Geometry read from the built stylesheets at every viewport the suite uses.
// With scripts off, web 4.7.1 hides the skeleton (`@media (scripting: none)`) and the note shows alone.
const LOADING_VIEWPORTS = [
  {width: 1400, height: 900},
  {width: 1100, height: 800},
  {width: 768, height: 1024},
  {width: 600, height: 900},
  {width: 390, height: 844}
]
const COMPACT_SKELETON_CARD_IDS = ['cardBooks', 'cardDevLog', 'cardReading', 'cardStarredRepos', 'cardTheatreReviews', 'cardWorkouts']
/** Sub-pixel layout rounding, not a clip. */
const FIT_TOLERANCE_PX = 0.5
const CENTER_TOLERANCE_PX = 1

/** Each visible skeleton shape that leaves its card body, by how far, as `card shape side px`. */
async function skeletonOverflows(page: Page): Promise<{checked: number; overflows: string[]}> {
  return page.evaluate((tolerance) => {
    const shapes = Array.from(document.querySelectorAll('.tri-card .skeleton-bar, .tri-card .skeleton-circle'))
    let checked = 0
    const overflows: string[] = []
    for (const shape of shapes) {
      const box = shape.getBoundingClientRect()
      if (box.width === 0 || box.height === 0) {
        continue
      }
      checked += 1
      const bodyBox = shape.closest('.widget-body')?.getBoundingClientRect()
      const card = shape.closest('.tri-card')?.id
      if (!bodyBox) {
        overflows.push(`${card}: no card body`)
        continue
      }
      const sides = {top: bodyBox.top - box.top, bottom: box.bottom - bodyBox.bottom, left: bodyBox.left - box.left, right: box.right - bodyBox.right}
      for (const [side, by] of Object.entries(sides)) {
        if (by > tolerance) {
          overflows.push(`${card} ${shape.className} ${side} ${by.toFixed(1)}px`)
        }
      }
    }
    return {checked, overflows}
  }, FIT_TOLERANCE_PX)
}

/** How far each compact skeleton row's vertical center sits from its card body's, by card id. */
async function compactRowOffsets(page: Page): Promise<Record<string, number>> {
  return page.evaluate(() =>
    Object.fromEntries(Array.from(document.querySelectorAll('.tri-card .skeleton-state--compact')).map((state) => {
      const center = (box: DOMRect) => (box.top + box.bottom) / 2
      const row = state.firstElementChild?.getBoundingClientRect()
      const body = state.closest('.widget-body')?.getBoundingClientRect()
      return [state.closest('.tri-card')?.id ?? '', row && body ? Math.abs(center(row) - center(body)) : Infinity]
    }))
  )
}

for (const viewport of LOADING_VIEWPORTS) {
  test.describe(`Loading skeletons at ${viewport.width}px, scripts on`, () => {
    test.use({viewport})

    test.beforeEach(async ({page}) => {
      await stayLocal(page)
      await page.route(`${CLOUDFRONT_BASE}/**`, () => new Promise(() => {}))
      await serveDataFreePage(page)
      await page.goto('/', {waitUntil: 'domcontentloaded'})
      await expect(page.locator('#cardReading .skeleton-bar').first()).toBeVisible()
    })

    // covers: dashboard-shell#Every live card renders its honest loading state
    test('every bar and circle sits inside its card body', async ({page}) => {
      const {checked, overflows} = await skeletonOverflows(page)
      expect(checked, 'skeleton shapes to check').toBeGreaterThan(0)
      expect(overflows).toEqual([])
    })

    // covers: dashboard-shell#Every live card renders its honest loading state
    test('every compact row is centered in its card body', async ({page}) => {
      const offsets = await compactRowOffsets(page)
      expect(Object.keys(offsets).sort(), 'the cards with a compact skeleton').toEqual(COMPACT_SKELETON_CARD_IDS)
      for (const [card, offset] of Object.entries(offsets)) {
        expect(offset, `${card}: row center to body center, px`).toBeLessThanOrEqual(CENTER_TOLERANCE_PX)
      }
    })
  })

  test.describe(`Loading skeletons at ${viewport.width}px, scripts off`, () => {
    test.use({javaScriptEnabled: false, viewport})

    // covers: dashboard-shell#Every live card renders its honest loading state
    test('no skeleton shape paints, and each noscript note sits inside its card body', async ({page}) => {
      await stayLocal(page)
      await serveDataFreePage(page)
      await page.goto('/')

      const {checked, overflows} = await skeletonOverflows(page)
      expect(overflows).toEqual([])
      expect(checked, 'painted skeleton shapes').toBe(0)
      for (const id of LIVE_CARD_IDS) {
        const note = await page.locator(`#${id} .widget-noscript[data-state-notice="loading"]`).boundingBox()
        const body = await page.locator(`#${id} .widget-body`).boundingBox()
        expect(note, `#${id} note`).not.toBeNull()
        expect(body, `#${id} body`).not.toBeNull()
        expect(note!.y + note!.height, `#${id} note bottom`).toBeLessThanOrEqual(body!.y + body!.height + FIT_TOLERANCE_PX)
      }
    })
  })
}
