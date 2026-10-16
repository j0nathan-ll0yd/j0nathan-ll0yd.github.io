import {expect, type Page} from '@playwright/test'
import {CLOUDFRONT_BASE, WEBSOCKET_URL} from '@j0nathan-ll0yd/portal-contract/constants'
import {resetDataPlane, serveFixtures, setDataPlane} from '../data-plane/control'
import {BASELINE_BY_PATH, fixture, FIXTURE_NOW_ISO} from '../data-plane/baseline'
import {prerenderedIndexHtml} from '../shared/ssr-page'

export { fixture }

// Atlas decision 0160, PR B: the Worker renders `/` per request from the fixture data plane
// (tests/data-plane/server.ts), and the browser's runtime then reads the same exports from
// CloudFront. A test therefore steers BOTH planes with the same files: `interceptDashboard` sets
// the data plane and the browser's route in one call, so the server render and the client agree.
// A card the server rendered keeps its server generation (the hand-off never repaints an equal or
// newer one). `interceptDashboard(page, overrides, {dataFree: true})` models the fallback instead:
// the Worker answers with the data-free page and the client alone paints.

/**
 * Serve the dashboard's data, off-origin traffic aborted, with `overrides` replacing individual
 * endpoint paths. The fixture data plane (the server render) and the browser's CloudFront route (the
 * client runtime) answer from the same files; `focus` is pinned to `empty` on purpose, because a
 * hiding focus mode suppresses every other endpoint and would starve the widget under test.
 */
export async function interceptDashboard(page: Page, overrides: Readonly<Record<string, string>> = {}, options: {dataFree?: boolean} = {}): Promise<void> {
  const byPath: Record<string, string> = {...BASELINE_BY_PATH, ...overrides}
  await syncServerPlane(page, byPath)
  await interceptBrowserOnly(page, byPath)
  if (options.dataFree) {
    await serveDataFreePage(page)
  }
}

/**
 * Point the server render at the same files the browser's route serves, byte for byte: the data
 * plane keeps each file's own `generatedAt`, so the server and the client hold ONE generation of
 * each export, as in production. The render clock is pinned to the fixtures' shared date
 * (`X-SSR-Clock`, loopback only), which judges them fresh whatever the wall clock says.
 */
export async function syncServerPlane(page: Page, byPath: Readonly<Record<string, string>>): Promise<void> {
  await resetDataPlane()
  await serveFixtures(byPath, 'original')
  await pinRenderClock(page)
}

/** Sends `X-SSR-Clock` with the document request for `/`, so the Worker renders at the fixtures' date. */
export async function pinRenderClock(page: Page): Promise<void> {
  await page.route((url) => url.origin === 'http://localhost:4321' && url.pathname === '/', (route) =>
    route.request().resourceType() === 'document'
      ? route.continue({headers: {...route.request().headers(), 'x-ssr-clock': FIXTURE_NOW_ISO}})
      : route.fallback())
}

/**
 * Route only the browser's traffic: the CloudFront exports, the WebSocket and every off-origin
 * request. The server render keeps whatever the data plane already holds. Use it with
 * `serveDataFreePage` when a test starts from the data-free fallback.
 */
export async function interceptBrowserOnly(page: Page, byPath: Readonly<Record<string, string>> = BASELINE_BY_PATH): Promise<void> {
  await page.route(`${CLOUDFRONT_BASE}/**`, async (route) => {
    const path = byPath[new URL(route.request().url()).pathname]
    if (path) {
      await route.fulfill({path, contentType: 'application/json'})
    } else {
      await route.abort()
    }
  })
  await page.route(`${WEBSOCKET_URL}/**`, (route) => route.abort())
  await page.route('**/*', async (route) => {
    const url = route.request().url()
    if (url.startsWith('http://localhost') || url.startsWith(CLOUDFRONT_BASE) || url.startsWith('data:')) {
      await route.fallback()
      return
    }
    await route.abort()
  })
}

/**
 * Serve a synthesized JSON `body` for one endpoint to BOTH planes: the data plane returns it as
 * written for the server render (same `generatedAt`), and so does the browser's route.
 * Registered after `interceptDashboard`, so it wins for that path.
 */
export async function serveBody(page: Page, endpoint: string, body: unknown): Promise<void> {
  await setDataPlane({[endpoint]: {kind: 'json', body, generatedAt: 'original'}})
  await page.route(`${CLOUDFRONT_BASE}${endpoint}**`, (route) => route.fulfill({status: 200, contentType: 'application/json', body: JSON.stringify(body)}))
}

/**
 * Answer `GET /` with the prerendered data-free page, byte for byte what the Worker serves when a
 * server render misses its ceiling (`X-SSR-Data: fallback`, decision 0160 D2). Every live card then
 * starts `loading` and only the browser's runtime paints it. Register it after `interceptDashboard`.
 */
export async function serveDataFreePage(page: Page): Promise<void> {
  const html = prerenderedIndexHtml()
  await page.route((url) => url.origin === 'http://localhost:4321' && url.pathname === '/', (route) =>
    route.request().resourceType() === 'document'
      ? route.fulfill({status: 200, contentType: 'text/html; charset=utf-8', body: html})
      : route.fallback())
}

/** The runtime has finished its first read and first writes (success or failure). */
export async function expectLiveReady(page: Page): Promise<void> {
  await expect(page.locator('body')).toHaveAttribute('data-live-ready', '1', {timeout: 15_000})
}

/**
 * Load the dashboard with `overrides` in place and wait until the runtime is ready and `settledCard`
 * carries a final state. `data-live-ready` is the runtime's own signal that its first read ended; it
 * replaces the loading class, which a server-rendered card never has.
 */
export async function loadDashboard(page: Page, overrides: Readonly<Record<string, string>>, settledCard: string): Promise<void> {
  await interceptDashboard(page, overrides)
  await page.goto('/')
  await expectLiveReady(page)
  await expect(page.locator(settledCard)).not.toHaveAttribute('data-ssr-state', 'loading')
}
