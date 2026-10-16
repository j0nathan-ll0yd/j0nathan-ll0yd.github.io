import {readFileSync} from 'node:fs'
import {createRequire} from 'node:module'
import {expect, type Page, test} from '@playwright/test'
import {CLOUDFRONT_BASE, ENDPOINTS} from '@j0nathan-ll0yd/portal-contract/constants'
import {fixture, KNOWN_ANSWER_BY_PATH} from '../data-plane/baseline'
import {type Behavior, resetDataPlane, serveFixtures, setDataPlane} from '../data-plane/control'

// The service worker and the server render together, in real Chromium (atlas decision 0160, PR B;
// plan Step 6.5; openspec/specs/client-privacy). The worker is NetworkOnly for navigations, so the
// Worker's render is the only source of `/`. These tests load the real preview Worker on a loopback
// address that is not `localhost`, because public/js/sw-register.js skips registration on
// `localhost`, install the real generated worker, and then close the gate in the ways the plan
// names: hiding with a network delayed past the render ceiling, an offline navigation, and a failed
// focus read in the browser. Each ends with the same assertion: no gated value anywhere.
//
// The old `live-data` cache purge is proved in tests/behavioral/sw-upgrade.spec.ts, and the
// worker's cache rules in tests/behavioral/offline-navigation.spec.ts; both serve dist/ statically.
// Behavioral assertions only: DOM, headers and CacheStorage contents.

const OFFLINE_NOTICE: string = createRequire(import.meta.url)('@j0nathan-ll0yd/copy/widgets.flat.json').systemStatus.valueOffline
const TOKEN = 'Kappa-7731'
const RENDER_CEILING_MS = 3_000

test.use({serviceWorkers: 'allow'})
test.describe.configure({timeout: 90_000})

/** The preview answers on one loopback family only; use whichever one the runner binds. */
async function workerOrigin(): Promise<string> {
  for (const origin of ['http://127.0.0.1:4321', 'http://[::1]:4321']) {
    try {
      if ((await fetch(`${origin}/`, {method: 'HEAD'})).ok) {
        return origin
      }
    } catch {
      // try the next loopback family
    }
  }
  throw new Error('the preview Worker answers on neither 127.0.0.1:4321 nor [::1]:4321')
}

const knownAnswerBody = (path: string): string => readFileSync(KNOWN_ANSWER_BY_PATH[path], 'utf8')

let origin: string

test.beforeAll(async () => {
  origin = await workerOrigin()
})

test.beforeEach(async ({context}) => {
  await resetDataPlane()
  await serveFixtures(KNOWN_ANSWER_BY_PATH)
  // The browser reads the same known-answer exports from "CloudFront", cacheable, so a worker that
  // cached gated data would have something to cache. Everything else off-origin is refused.
  await context.route(`${CLOUDFRONT_BASE}/**`, (route) => {
    const path = new URL(route.request().url()).pathname
    return KNOWN_ANSWER_BY_PATH[path]
      ? route.fulfill({
        status: 200,
        contentType: 'application/json',
        headers: {'Access-Control-Allow-Origin': '*', 'Cache-Control': 'max-age=300'},
        body: knownAnswerBody(path)
      })
      : route.abort()
  })
})

const cachedUrls = (page: Page) =>
  page.evaluate(async () => {
    const urls: string[] = []
    for (const name of await caches.keys()) {
      for (const request of await (await caches.open(name)).keys()) {
        urls.push(request.url)
      }
    }
    return urls
  })

/** True when any cache entry's body carries the known-answer token. */
const cachesHoldToken = (page: Page, token: string) =>
  page.evaluate(async (needle) => {
    for (const name of await caches.keys()) {
      const cache = await caches.open(name)
      for (const request of await cache.keys()) {
        const response = await cache.match(request)
        if (response && (await response.clone().text().catch(() => '')).includes(needle)) {
          return true
        }
      }
    }
    return false
  }, token)

async function installWorker(page: Page): Promise<void> {
  await page.goto(`${origin}/`)
  await page.evaluate(() => navigator.serviceWorker.ready)
  await expect.poll(() => page.evaluate(() => navigator.serviceWorker.controller !== null), {message: 'the worker controls the page', timeout: 20_000}).toBe(
    true
  )
  await expect.poll(async () => (await cachedUrls(page)).map((url) => new URL(url).pathname), {message: 'the precache holds /offline', timeout: 20_000})
    .toContain('/offline')
}

test.describe('service worker with the server render', () => {
  test('a warm session, then hiding with the network delayed past the render ceiling, shows no gated value', async ({page}) => {
    // Warm: a visible session renders the known answer, server side and in the browser.
    await installWorker(page)
    await page.reload()
    await expect(page.locator('body')).toHaveAttribute('data-live-ready', '1', {timeout: 15_000})
    await expect(page.locator('#cardBooks')).toContainText(TOKEN)
    expect(await cachesHoldToken(page, TOKEN), 'the worker cached a gated value in the warm session').toBe(false)

    // Hiding begins, and every read is slower than the render ceiling.
    const slow = (behavior: Behavior): Behavior => ({...behavior, delayMs: RENDER_CEILING_MS + 500})
    await setDataPlane({
      [ENDPOINTS.focus]: slow({kind: 'fixture', file: fixture('focus', 'baseline')}),
      ...Object.fromEntries(
        Object.entries(KNOWN_ANSWER_BY_PATH).filter(([path]) => path !== ENDPOINTS.focus).map(([path, file]) => [path, slow({kind: 'fixture', file})])
      )
    })
    // The client reads a closed gate too.
    await page.context().unroute(`${CLOUDFRONT_BASE}/**`)
    await page.context().route(`${CLOUDFRONT_BASE}/**`,
      (route) =>
        route.fulfill({
          status: 403,
          contentType: 'application/json',
          headers: {'Access-Control-Allow-Origin': '*'},
          body: JSON.stringify({suppressed: true})
        }))

    const started = Date.now()
    const response = await page.goto(`${origin}/`)
    expect(Date.now() - started, 'the page answers by the render ceiling plus its own overhead').toBeLessThan(RENDER_CEILING_MS + 3_000)
    expect(response?.fromServiceWorker(), 'the worker passed the navigation to the network').toBe(true)
    expect(['unavailable', 'suppressed', 'fallback']).toContain(response?.headers()['x-ssr-data'])
    await expect(page.locator('body')).toHaveAttribute('data-live-ready', '1', {timeout: 15_000})

    expect(await page.content()).not.toContain(TOKEN)
    expect(await page.locator('body').innerText()).not.toContain(TOKEN)
    await expect(page.locator('[data-ssr-state="live"], [data-ssr-state="stale"], [data-ssr-state="empty"]')).toHaveCount(0)
    expect(await cachesHoldToken(page, TOKEN), 'a cache holds a gated value after the gate closed').toBe(false)
  })

  test('hiding at the server shows the overlay and the worker replays nothing from the warm session', async ({page}) => {
    await installWorker(page)
    await page.reload()
    await expect(page.locator('#cardBooks')).toContainText(TOKEN)

    await serveFixtures({[ENDPOINTS.focus]: fixture('focus', 'baseline')})
    await page.context().unroute(`${CLOUDFRONT_BASE}/**`)
    await page.context().route(`${CLOUDFRONT_BASE}/**`,
      (route) =>
        route.fulfill({
          status: 403,
          contentType: 'application/json',
          headers: {'Access-Control-Allow-Origin': '*'},
          body: JSON.stringify({suppressed: true})
        }))
    const response = await page.goto(`${origin}/`)

    expect(response?.headers()['x-ssr-data']).toBe('suppressed')
    await expect(page.locator('#focusOverlay')).toBeVisible()
    expect(await page.content()).not.toContain(TOKEN)
    expect(await cachesHoldToken(page, TOKEN)).toBe(false)
  })

  test('a navigation while the browser is offline gets the data-free /offline page, with no value from the warm session', async ({page, context}) => {
    await installWorker(page)
    await page.reload()
    await expect(page.locator('#cardBooks')).toContainText(TOKEN)

    await context.setOffline(true)
    await page.goto(`${origin}/`)
    await expect(page.locator('[data-offline-page]')).toBeVisible()
    await expect(page.locator('h1')).toHaveText(OFFLINE_NOTICE)
    expect(await page.locator('.tri-card, #cardHR, #cardBooks').count()).toBe(0)
    expect(await page.content()).not.toContain(TOKEN)
    await context.setOffline(false)
  })

  test('a failed focus read in the browser applies no gated value', async ({page, context}) => {
    // The server render saw nothing of the known answer (focus unreadable), and the browser's focus
    // read fails while its gated reads would succeed: the runtime must apply none of them.
    await setDataPlane({[ENDPOINTS.focus]: {kind: 'status', status: 500}})
    await context.unroute(`${CLOUDFRONT_BASE}/**`)
    await context.route(`${CLOUDFRONT_BASE}/**`, (route) => {
      const path = new URL(route.request().url()).pathname
      if (path === ENDPOINTS.focus) {
        return route.abort('connectionrefused')
      }
      return KNOWN_ANSWER_BY_PATH[path]
        ? route.fulfill({status: 200, contentType: 'application/json', headers: {'Access-Control-Allow-Origin': '*'}, body: knownAnswerBody(path)})
        : route.abort()
    })

    const response = await page.goto(`${origin}/`)
    expect(response?.headers()['x-ssr-data']).toBe('unavailable')
    await expect(page.locator('body')).toHaveAttribute('data-live-ready', '1', {timeout: 15_000})
    expect(await page.content()).not.toContain(TOKEN)
    await expect(page.locator('[data-ssr-state="live"], [data-ssr-state="stale"], [data-ssr-state="empty"]')).toHaveCount(0)
  })
})
