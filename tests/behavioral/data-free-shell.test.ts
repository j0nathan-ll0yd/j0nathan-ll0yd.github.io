import {createRequire} from 'node:module'
import {expect, type Page, test} from '@playwright/test'
import {CLOUDFRONT_BASE, WEBSOCKET_URL} from '@j0nathan-ll0yd/portal-contract/constants'
import {FIXTURE_SENTINELS, LIVE_CARD_IDS, RETIRED_OVERLAY_ROWS} from '../shared/fixture-sentinels'

// The data-free `/` in a real browser (atlas decision 0160, PR 0a; openspec/specs/dashboard-shell).
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
  await page.route(`${WEBSOCKET_URL}/**`, (route) => route.abort())
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

  test('keeps every card value-free when the data plane is down', async ({page}) => {
    await stayLocal(page)
    await page.route(`${CLOUDFRONT_BASE}/**`, (route) => route.abort())
    await page.goto('/')
    // live-data.ts clears every skeleton once its first fetch round settles, success or not.
    await expect(page.locator('.is-loading')).toHaveCount(0, {timeout: 15_000})

    await expectNoFixtureValue(page)
    for (const id of LIVE_CARD_IDS) {
      await expect(page.locator(`#${id}`), `#${id}`).toHaveAttribute('data-ssr-state', 'loading')
    }
  })
})
