import {expect, type Page, test} from '@playwright/test'
import {createRequire} from 'node:module'
import {CLOUDFRONT_BASE} from '@j0nathan-ll0yd/portal-contract/constants'
import {type DistServer, startDistServer} from './dist-server'

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

test.beforeEach(async ({context}) => {
  server.overrides.clear()
  server.down = false
  // No live data in these tests: CloudFront is unreachable, so the dashboard's own requests (and
  // the image fallback route they could trigger) cannot add cache entries the assertions misread.
  await context.route(`${CLOUDFRONT_BASE}/**`, (route) => route.abort())
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

/** Every request URL held in any cache, as pathnames. */
const cachedPaths = (page: Page) =>
  page.evaluate(async () => {
    const paths: string[] = []
    for (const name of await caches.keys()) {
      for (const request of await (await caches.open(name)).keys()) {
        paths.push(new URL(request.url).pathname)
      }
    }
    return paths
  })

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
  // No document but /offline is ever stored, and no gated URL is: checked over 2 s, because a
  // cache write in a worker's waitUntil can land after the page load resolves.
  await expectStable(async () => {
    const paths = await cachedPaths(page)
    expect(paths.filter(isDocumentPath)).toEqual(['/offline'])
    expect(paths.filter((path) => path.endsWith('.json'))).toEqual([])
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
