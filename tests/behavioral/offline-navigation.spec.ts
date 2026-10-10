import {expect, type Page, test} from '@playwright/test'
import {createRequire} from 'node:module'
import {CLOUDFRONT_BASE} from '@j0nathan-ll0yd/portal-contract/constants'
import {decodeLikeOrigin, type DistServer, startDistServer} from './dist-server'
import {siteGatedProbeUrls, traversalProbeUrls} from '../../scripts/lib/sw-privacy.mjs'

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
// CloudFront paths that carry gated data: every JSON export, and the origin of each proxied artifact.
const GATED_CLOUDFRONT_PATHS = new Set([...GATED_URLS].filter((url) => url.startsWith(CLOUDFRONT_BASE)).map((url) => new URL(url).pathname))
const isGatedCloudfrontPath = (path: string) => path.endsWith('.json') || GATED_CLOUDFRONT_PATHS.has(path)
// What CloudFront JSON answers. The H01 regression below switches it to a closed gate and then to
// an unreachable origin; every other test keeps the open default.
let cloudfrontJson: {status: number; body: string} | 'down' = {status: 200, body: '{}'}
// When true, CloudFront resolves a request path as a lenient origin does before routing it, so an
// image-path escape reaches a gated export (the LOW-2 regression below).
let cloudfrontDecodes = false

test.beforeEach(async ({context}) => {
  server.overrides.clear()
  server.down = false
  server.decodePaths = false
  gatedResponses = 0
  cloudfrontJson = {status: 200, body: '{}'}
  cloudfrontDecodes = false
  // Gated CloudFront paths get a real, cacheable 200, so a worker that cached gated data would have
  // something to cache. Every other CloudFront request (book-cover images) is refused, so the
  // image-fallback route cannot add entries that have nothing to do with these assertions.
  await context.route(`${CLOUDFRONT_BASE}/**`, (route) => {
    const requested = new URL(route.request().url()).pathname
    if (isGatedCloudfrontPath(cloudfrontDecodes ? decodeLikeOrigin(requested) : requested)) {
      gatedResponses++
      if (cloudfrontJson === 'down') {
        return route.abort('connectionrefused')
      }
      return route.fulfill({
        status: cloudfrontJson.status,
        contentType: 'application/json',
        headers: {'Access-Control-Allow-Origin': '*', 'Cache-Control': 'max-age=300'},
        body: cloudfrontJson.body
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

// H01 (adversarial review): the old image route tested the whole URL, so
// /feed.json?preview=/images/books/ was cached CacheFirst and replayed after the origin closed, with
// no origin read. Every gated URL -- the five site paths and every CloudFront export, focus.json
// included -- is fetched here through the REAL worker with every probe query string and fragment:
// first while the origin is open, then with the gate closed (503), then with the origin down. No
// answer after the first may carry the open-gate marker, every closed-gate fetch must reach the
// origin, and no cache may hold a gated pathname.
test('no gated URL is replayed from a cache, whatever query string or fragment it carries', async ({page}) => {
  const MARKER = 'GATED_BEFORE_HIDING'
  const siteOrigin = new URL([...GATED_URLS].find((url) => !url.startsWith(CLOUDFRONT_BASE))!).origin
  const sitePaths = [...new Set([...GATED_URLS].filter((url) => url.startsWith(siteOrigin)).map((url) => new URL(url).pathname))]
  expect(sitePaths.sort()).toEqual(['/feed.json', '/feed.xml', '/index.md', '/llms-full.txt', '/llms.txt'])
  // Site probes go to this server; CloudFront probes stay on CloudFront (answered by context.route).
  const probes = [...GATED_URLS].map((url) => url.startsWith(siteOrigin) ? `${server.origin}${url.slice(siteOrigin.length)}` : url)
  const siteProbes = probes.filter((url) => url.startsWith(server.origin))
  const cloudfrontProbes = probes.filter((url) => url.startsWith(CLOUDFRONT_BASE))
  expect(siteProbes.some((url) => url.endsWith('/feed.json?preview=/images/books/'))).toBe(true)
  expect(cloudfrontProbes.some((url) => url.endsWith('/focus.json?preview=/images/books/'))).toBe(true)

  const fetchAll = () =>
    page.evaluate((urls) =>
      Promise.all(urls.map(async (url) => {
        try {
          const response = await fetch(url, {cache: 'no-store'})
          return {url, status: response.status, body: await response.text()}
        } catch {
          return {url, status: 0, body: ''}
        }
      })), probes)
  const setSiteAnswer = (status: number, body: string) => {
    for (const path of sitePaths) {
      server.overrides.set(path, {status, type: 'text/plain; charset=utf-8', body})
    }
  }

  await installWorker(page)

  // Open: every probe reaches the origin and carries the marker.
  setSiteAnswer(200, MARKER)
  cloudfrontJson = {status: 200, body: JSON.stringify({marker: MARKER})}
  const open = await fetchAll()
  expect(open.filter((answer) => answer.status !== 200 || !answer.body.includes(MARKER))).toEqual([])
  await new Promise((resolve) => setTimeout(resolve, 1_000)) // let any waitUntil cache write land

  // Closed gate: every probe reaches the origin again and gets the suppression, never the marker.
  setSiteAnswer(503, 'SUPPRESSED')
  cloudfrontJson = {status: 503, body: 'SUPPRESSED'}
  const siteReadsBefore = server.requests.length
  const cloudfrontReadsBefore = gatedResponses
  const closed = await fetchAll()
  expect(closed.filter((answer) => answer.status !== 503 || answer.body.includes(MARKER))).toEqual([])
  expect(server.requests.length - siteReadsBefore).toBe(siteProbes.length)
  expect(gatedResponses - cloudfrontReadsBefore).toBe(cloudfrontProbes.length)

  // Origin down: every probe fails as a network error; nothing answers from a cache.
  server.down = true
  cloudfrontJson = 'down'
  const down = await fetchAll()
  expect(down.filter((answer) => answer.status !== 0 || answer.body.includes(MARKER))).toEqual([])

  // A navigation to a query-form gated URL gets only the data-free /offline page.
  await page.goto(`${server.origin}/feed.xml?preview=/images/books/`)
  await expectDataFreeOfflinePage(page)
  expect(await page.content()).not.toContain(MARKER)

  const gatedPaths = new Set([...GATED_URLS].map((url) => {
    const parsed = new URL(url)
    return `${parsed.origin === siteOrigin ? server.origin : parsed.origin}${parsed.pathname}`
  }))
  const cached = await cachedUrls(page)
  expect(cached.filter((url) => gatedPaths.has(`${new URL(url).origin}${new URL(url).pathname}`))).toEqual([])
  expect(await page.evaluate(() => caches.has('local-images'))).toBe(false)
})

// LOW-2 (final verification of #351): the image route accepted any pathname under its prefix. On an
// origin that decodes %2F and %5C and resolves `..`, /images/books/..%2F..%2Ffeed.json is the gated
// feed, and the open-ended route cached it in local-images-v2 and replayed it with the gate closed.
// This server now decodes like that origin. Every encoded-slash, dot-segment and backslash escape of
// both image roots, aimed at each of the five site paths, is fetched open, closed and down.
test('no path escape under an image root is cached, even on an origin that decodes it', async ({page}) => {
  const MARKER = 'GATED_BEFORE_HIDING'
  const siteOrigin = new URL([...GATED_URLS].find((url) => !url.startsWith(CLOUDFRONT_BASE))!).origin
  const sitePaths = [...new Set([...GATED_URLS].filter((url) => url.startsWith(siteOrigin)).map((url) => new URL(url).pathname))]
  const cloudfrontGated = [...GATED_URLS].filter((url) => url.startsWith(CLOUDFRONT_BASE)).map((url) => url.split(/[?#]/)[0])
  // Escapes built by the same function the build guard uses, from the OPEN-ENDED prefixes #351
  // shipped, and kept when a lenient origin resolves them to a gated file. A double-encoded %252F
  // decodes once, to a literal %2F, and is a 404 there, so it proves nothing here and is dropped.
  const siteProbes = traversalProbeUrls(sitePaths.map((path) => `${siteOrigin}${path}`), /^\/images\/(books|theatre)\//, siteOrigin).filter((url) =>
    sitePaths.includes(decodeLikeOrigin(new URL(url).pathname))
  ).map((url) => `${server.origin}${url.slice(siteOrigin.length)}`)
  const cloudfrontProbes = traversalProbeUrls(cloudfrontGated,
    new RegExp(`^${CLOUDFRONT_BASE.replace(/[.*+?^${}()|[\]\\]/g, '\\$&')}/images/(books|theatre)/`), siteOrigin).filter((url) =>
      isGatedCloudfrontPath(decodeLikeOrigin(new URL(url).pathname))
    )
  const probes = [...siteProbes, ...cloudfrontProbes]
  expect(siteProbes.length).toBeGreaterThanOrEqual(25)
  expect(siteProbes).toContain(`${server.origin}/images/books/..%2F..%2Ffeed.json`)
  expect(siteProbes).toContain(`${server.origin}/images/books/..%2F..%2Ffeed.json;x.avif`)
  expect(cloudfrontProbes).toContain(`${CLOUDFRONT_BASE}/images/books/..%2F..%2Ffocus.json`)

  const fetchAll = () =>
    page.evaluate((urls) =>
      Promise.all(urls.map(async (url) => {
        try {
          const response = await fetch(url, {cache: 'no-store'})
          return {url, status: response.status, body: await response.text()}
        } catch {
          return {url, status: 0, body: ''}
        }
      })), probes)
  const setSiteAnswer = (status: number, body: string) => {
    for (const path of sitePaths) {
      server.overrides.set(path, {status, type: 'text/plain; charset=utf-8', body})
    }
  }
  /** Entries in the two image caches. */
  const imageCacheEntries = () =>
    page.evaluate(async () => {
      let count = 0
      for (const name of ['local-images-v2', 'optimized-images-fallback']) {
        if (await caches.has(name)) {
          count += (await (await caches.open(name)).keys()).length
        }
      }
      return count
    })

  await installWorker(page)
  server.decodePaths = true
  cloudfrontDecodes = true

  // Open: the lenient origins answer every escape with the gated file. No image cache gains an
  // entry, held over 2 s because a cache write in a worker's waitUntil lands after the response.
  setSiteAnswer(200, MARKER)
  cloudfrontJson = {status: 200, body: JSON.stringify({marker: MARKER})}
  const open = await fetchAll()
  expect(open.filter((answer) => answer.status !== 200 || !answer.body.includes(MARKER))).toEqual([])
  await expectStable(async () => expect(await imageCacheEntries()).toBe(0))

  // Closed: every escape reaches its origin again and gets the suppression.
  setSiteAnswer(503, 'SUPPRESSED')
  cloudfrontJson = {status: 503, body: 'SUPPRESSED'}
  const siteReadsBefore = server.requests.length
  const cloudfrontReadsBefore = gatedResponses
  const closed = await fetchAll()
  expect(closed.filter((answer) => answer.status !== 503 || answer.body.includes(MARKER))).toEqual([])
  expect(server.requests.length - siteReadsBefore).toBe(siteProbes.length)
  expect(gatedResponses - cloudfrontReadsBefore).toBe(cloudfrontProbes.length)

  // Down: nothing answers from a cache.
  server.down = true
  cloudfrontJson = 'down'
  const down = await fetchAll()
  expect(down.filter((answer) => answer.status !== 0 || answer.body.includes(MARKER))).toEqual([])
  expect(await imageCacheEntries()).toBe(0)
})
