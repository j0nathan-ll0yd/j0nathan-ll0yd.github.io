import {createRequire} from 'node:module'
import {expect, type Page, test} from '@playwright/test'
import {ENDPOINTS} from '@j0nathan-ll0yd/portal-contract/constants'
import {resetDataPlane, serveFixtures} from '../data-plane/control'
import {fixture, KNOWN_ANSWER_BY_PATH} from '../data-plane/baseline'
import {serveDataFreePage} from './dashboard-fixtures'
import {SITE_PAGE_PATHS} from '../../src/lib/edge/site-paths'
import {AGENT_PATHS} from '../../src/lib/edge/agent-paths.mjs'

// The site navigation on the homepage, read with JavaScript off (atlas decision 0158; plan
// is-agentic-developers-link; openspec/specs/dashboard-shell). The homepage links About, Contact,
// Developers and Privacy through the design system's SiteFooterNav, in a footer that closes the
// left panel. The footer is part of the page shell, so every answer of `/` carries it: the server
// render, the suppressed page a hiding focus mode gets, and the data-free fallback.
//
// A hiding focus mode's overlay covers the whole page, footer included; there the nav is only
// asserted present (owner decision 2026-10-24).
//
// "Visible" is not enough here. From 1100px up the page locks html and body to 100dvh, so a link
// below the fold counts as visible to Playwright yet no reader reaches it. Each test therefore
// wheels the panel that holds the footer and hit-tests the link.

const copyRequire = createRequire(import.meta.url)
const identity = copyRequire('@j0nathan-ll0yd/copy/identity.flat.json') as {
  navigation: {siteNavLabel: string}
  about: {title: string}
  contact: {title: string}
  privacy: {title: string}
}
const llm = copyRequire('@j0nathan-ll0yd/copy/llm.flat.json') as {developers: {title: string}}

const SITE_NAV = `nav[aria-label="${identity.navigation.siteNavLabel}"]`
const DEVELOPERS_LINK = `footer nav a[href="${AGENT_PATHS.developers}"]`
const EXPECTED_LINKS = [
  {href: SITE_PAGE_PATHS.about, label: identity.about.title},
  {href: SITE_PAGE_PATHS.contact, label: identity.contact.title},
  {href: AGENT_PATHS.developers, label: llm.developers.title},
  {href: SITE_PAGE_PATHS.privacy, label: identity.privacy.title}
]

/** Wheel over the footer's scroll container, then prove a reader's pointer lands on the link. */
async function expectReachable(page: Page, selector: string): Promise<void> {
  const link = page.locator(selector)
  await expect(link).toBeVisible()
  // Premise: the link starts below the fold, so the wheel is what brings it into view.
  expect(await link.evaluate((el) => el.getBoundingClientRect().top >= window.innerHeight), `${selector} starts out of view`).toBe(true)
  const viewport = page.viewportSize()!
  const panel = await page.locator('.left-panel').boundingBox()
  // Above 1100px the left panel scrolls on its own; at 1100px and below the page scrolls.
  const at = panel && panel.width > 0 ? {x: panel.x + panel.width / 2, y: viewport.height / 2} : {x: viewport.width / 2, y: viewport.height / 2}
  // A late font swap can grow the column after the wheel reached its end.
  await page.evaluate(() => document.fonts.ready)
  await page.mouse.move(at.x, at.y)
  await page.mouse.wheel(0, 20_000)
  await expect.poll(() =>
    link.evaluate((el) => {
      const box = el.getBoundingClientRect()
      const top = document.elementFromPoint(box.x + box.width / 2, box.y + box.height / 2)
      return top !== null && (top === el || el.contains(top))
    }), {message: `${selector} under the pointer after a wheel`, timeout: 5_000}).toBe(true)
}

/** The one site nav: four links in order, labels from copy, and none marked current on `/`. */
async function expectHomeNav(page: Page): Promise<void> {
  await expect(page.locator(SITE_NAV)).toHaveCount(1)
  const links = page.locator(`${SITE_NAV} a`)
  await expect(links).toHaveCount(EXPECTED_LINKS.length)
  for (const [i, {href, label}] of EXPECTED_LINKS.entries()) {
    await expect(links.nth(i)).toHaveAttribute('href', href)
    await expect(links.nth(i)).toHaveText(label)
  }
  await expect(page.locator(`${SITE_NAV} [aria-current]`)).toHaveCount(0)
}

test.beforeEach(async () => {
  await resetDataPlane()
  await serveFixtures(KNOWN_ANSWER_BY_PATH)
})

test.describe('homepage site nav, desktop 1400x900, JavaScript off', () => {
  // covers: dashboard-shell#The homepage links the site pages without JavaScript
  test('the server render carries the nav, and a reader reaches the Developers link', async ({page}) => {
    const response = await page.goto('/')
    expect(response!.headers()['x-ssr-data']).toBe('live')
    expect(await page.evaluate(() => getComputedStyle(document.body).overflowY), 'the 1400px scroll lock holds').toBe('hidden')
    await expectHomeNav(page)
    await expectReachable(page, DEVELOPERS_LINK)
  })

  // covers: dashboard-shell#The homepage links the site pages without JavaScript
  test('the suppressed page a hiding focus mode gets carries the same nav', async ({page}) => {
    await serveFixtures({[ENDPOINTS.focus]: fixture('focus', 'baseline')})
    const response = await page.goto('/')
    expect(response!.headers()['x-ssr-data']).toBe('suppressed')
    await expect(page.locator('#focusOverlay')).toBeVisible()
    await expectHomeNav(page)
    // The overlay covers the whole dashboard on purpose (owner decision 2026-10-24): the nav is in
    // the document for crawlers and assistive technology, and the overlay sits on top of it.
    // A programmatic scroll is fine here: it brings the link into the viewport to hit-test what
    // covers it, not to prove a reader can scroll there.
    const covered = await page.locator(DEVELOPERS_LINK).evaluate((el) => {
      el.scrollIntoView({block: 'center'})
      const box = el.getBoundingClientRect()
      const top = document.elementFromPoint(box.x + box.width / 2, box.y + box.height / 2)
      return top !== null && top.closest('#focusOverlay') !== null
    })
    expect(covered).toBe(true)
  })

  // covers: dashboard-shell#The homepage links the site pages without JavaScript
  test('the data-free fallback carries the same nav', async ({page}) => {
    await serveDataFreePage(page)
    const response = await page.goto('/')
    // The prerendered page answered, not a server render.
    expect(response!.headers()['x-ssr-data']).toBeUndefined()
    await expect(page.locator('[data-ssr-state="loading"]').first()).toBeAttached()
    await expectHomeNav(page)
    await expectReachable(page, DEVELOPERS_LINK)
  })

  // covers: dashboard-shell#The homepage links the site pages without JavaScript
  test('a text page keeps one site nav, with its own link current', async ({page}) => {
    await page.goto(SITE_PAGE_PATHS.about)
    await expect(page.locator(SITE_NAV)).toHaveCount(1)
    await expect(page.locator(`${SITE_NAV} a[aria-current="page"]`)).toHaveAttribute('href', SITE_PAGE_PATHS.about)
  })
})

for (
  const [name, viewport] of [
    ['narrow 390x844', {width: 390, height: 844}],
    ['tablet 1100x800', {width: 1100, height: 800}]
  ] as const
) {
  test.describe(`homepage site nav, ${name}, JavaScript off`, () => {
    test.use({viewport})

    // covers: dashboard-shell#The homepage links the site pages without JavaScript
    test('the nav ends the page, after System Status and every card', async ({page}) => {
      await page.goto('/')
      await expectHomeNav(page)
      const edges = await page.evaluate(() => {
        const box = (selector: string) => document.querySelector(selector)!.getBoundingClientRect()
        return {footer: box('.left-panel-footer').top, status: box('.left-panel-status').bottom, main: box('#main-content').bottom}
      })
      expect(edges.footer).toBeGreaterThanOrEqual(edges.status)
      expect(edges.footer).toBeGreaterThanOrEqual(edges.main)
      await expectReachable(page, DEVELOPERS_LINK)
    })
  })
}
