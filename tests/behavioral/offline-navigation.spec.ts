import {expect, type Page, test} from '@playwright/test'
import {createRequire} from 'node:module'
import {CLOUDFRONT_BASE} from '@j0nathan-ll0yd/portal-contract/constants'
import {type DistServer, startDistServer} from './dist-server'
import {siteGatedProbeUrls} from '../../scripts/lib/sw-privacy.mjs'

// The authored notice the page shows. Read from the copy package's JSON export, the same value
// src/pages/offline.astro renders (the package's TypeScript entry cannot load in this runner).
const OFFLINE_NOTICE: string = createRequire(import.meta.url)('@j0nathan-ll0yd/copy/widgets.flat.json').systemStatus.valueOffline

// Navigations under the real generated service worker, in Chromium (atlas decision 0160, PR 0b;
// openspec/specs/client-privacy, "Navigations go to the network, and only the data-free /offline
// page answers offline").
//
// Behavioral assertions only: what the server saw, what CacheStorage holds, and what the DOM
// contains. No screenshot baseline -- a baseline minted by this change would be no evidence.

let server: DistServer

test.use({serviceWorkers: 'allow'})
// Installing the worker precaches dist/; give a slow runner headroom over the 30 s default.
test.describe.configure({timeout: 90_000})

test.beforeAll(async () => {
  server = await startDistServer()
})

test.afterAll(async () => {
  await server.close()
})

// Gated URLs as cache keys see them: CloudFront exports (with and without the poll query) and the
// five site-origin proxy routes.
const GATED_URLS = new Set(siteGatedProbeUrls())
let gatedResponses = 0

test.beforeEach(async ({context}) => {
  server.overrides.clear()
  server.down = false
  gatedResponses = 0
  // CloudFront JSON gets a real, cacheable 200, so a worker that cached gated data would have
  // something to cache. Every other CloudFront request (book-cover images) is refused, so the
  // image-fallback route cannot add entries that have nothing to do with these assertions.
  await context.route(`${CLOUDFRONT_BASE}/**`, (route) => {
    if (new URL(route.request().url()).pathname.endsWith('.json')) {
      gatedResponses++
      return route.fulfill({
        status: 200,
        contentType: 'application/json',
        headers: {'Access-Control-Allow-Origin': '*', 'Cache-Control': 'max-age=300'},
        body: '{}'
      })
    }
    return route.abort()
  })
})

const isDocumentPath = (path: string) => path === '/' || path.endsWith('.html') || !/\.[a-z0-9]+$/i.test(path)

/**
 * Holds `assertion` true for `ms`, checking every 250 ms. A cache write made in a worker's
 * `waitUntil` can land after the page load resolves, so one early read proves nothing.
 */
async function expectStable(assertion: () => Promise<void>, ms = 2_000): Promise<void> {
  const deadline = Date.now() + ms
  do {
    await assertion()
    await new Promise((resolve) => setTimeout(resolve, 250))
  } while (Date.now() < deadline)
}

/** Every request URL held in any cache. */
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

/** Every request URL held in any cache, as pathnames. */
const cachedPaths = async (page: Page) => (await cachedUrls(page)).map((url) => new URL(url).pathname)

async function installWorker(page: Page): Promise<void> {
  await page.goto(`${server.origin}/`)
  await page.evaluate(() => navigator.serviceWorker.ready)
  await expect.poll(() => page.evaluate(() => navigator.serviceWorker.controller !== null), {message: 'the worker controls the page', timeout: 20_000}).toBe(
    true
  )
  await expect.poll(() => cachedPaths(page), {message: 'the precache holds /offline', timeout: 20_000}).toContain('/offline')
}

/** The data-free page: its marker and notice are present, and nothing live is. */
async function expectDataFreeOfflinePage(page: Page): Promise<void> {
  await expect(page.locator('[data-offline-page]')).toBeVisible()
  await expect(page.locator('h1')).toHaveText(OFFLINE_NOTICE)
  expect(await page.locator('.tri-card, #cardHR, #cardBooks, #focusOverlay').count()).toBe(0)
  expect(await page.locator('script[src*="webmcp"], script[src*="sa-loader"], link[rel="prefetch"], script[type="application/ld+json"]').count()).toBe(0)
  expect(await page.content()).not.toContain(new URL(CLOUDFRONT_BASE).host)
}

test('precaches /offline and no other HTML document', async ({page}) => {
  await installWorker(page)

  const paths = await cachedPaths(page)
  const documents = paths.filter(isDocumentPath)
  expect(documents).toEqual(['/offline'])
})

test('an online navigation reaches the network and stores nothing', async ({page}) => {
  await installWorker(page)
  server.requests.length = 0

  const response = await page.goto(`${server.origin}/`)

  expect(response?.status()).toBe(200)
  expect(response?.fromServiceWorker()).toBe(true) // the worker handled it, NetworkOnly
  expect(server.requests).toContain('/') // and it went to the network
  await expect(page.locator('#cardHR')).toHaveCount(1) // the dashboard, not the offline page
  expect(await page.locator('[data-offline-page]').count()).toBe(0)
  // The dashboard really received gated JSON, so a caching worker would have had it to store.
  await expect.poll(() => gatedResponses, {message: 'the page fetched gated JSON'}).toBeGreaterThan(0)
  // No document but /offline is ever stored, and no gated URL is: checked over 2 s, because a
  // cache write in a worker's waitUntil can land after the page load resolves.
  await expectStable(async () => {
    const urls = await cachedUrls(page)
    expect(urls.map((url) => new URL(url).pathname).filter(isDocumentPath)).toEqual(['/offline'])
    expect(urls.map((url) => url.split('#')[0]).filter((url) => GATED_URLS.has(url) || GATED_URLS.has(url.split('?')[0]))).toEqual([])
    expect(urls.filter((url) => url.startsWith(CLOUDFRONT_BASE) && new URL(url).pathname.endsWith('.json'))).toEqual([])
  })
})

test('a navigation that fails for lack of network gets the data-free /offline page', async ({page}) => {
  await installWorker(page)
  server.down = true

  await page.goto(`${server.origin}/`)
  expect(new URL(page.url()).pathname).toBe('/')
  await expectDataFreeOfflinePage(page)

  await page.goto(`${server.origin}/privacy`)
  expect(new URL(page.url()).pathname).toBe('/privacy')
  await expectDataFreeOfflinePage(page)
})

test('a navigation while the browser is offline gets the data-free /offline page', async ({page, context}) => {
  await installWorker(page)
  await context.setOffline(true)

  await page.goto(`${server.origin}/`)
  await expectDataFreeOfflinePage(page)

  await context.setOffline(false)
})

// Production answers `/offline` with a 308 to `/offline/` (as it does for `/privacy`). Workbox
// follows the redirect when it precaches, and the fallback must still find the page.
test('the fallback works when the host redirects /offline to /offline/', async ({page}) => {
  server.overrides.set('/offline', {status: 308, type: 'text/plain', body: '', location: '/offline/'})
  await installWorker(page)
  server.down = true

  await page.goto(`${server.origin}/`)
  await expectDataFreeOfflinePage(page)
})
