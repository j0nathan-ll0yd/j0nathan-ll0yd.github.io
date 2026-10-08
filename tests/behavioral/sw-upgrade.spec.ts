import {expect, type Page, test} from '@playwright/test'
import {createServer, type Server} from 'node:http'
import {readFile} from 'node:fs/promises'
import {extname, join, normalize, resolve} from 'node:path'
import type {AddressInfo} from 'node:net'

// Service-worker upgrade over a warm `live-data` cache, in real Chromium (atlas decision 0160,
// PR 0b).
//
// The suite's shared preview server answers on `localhost` only, and public/js/sw-register.js
// deliberately skips registration on `localhost`. So this file serves the built `dist/` itself on
// 127.0.0.1, which also lets it swap the worker script between an OLD worker (one that leaves gated
// JSON in `live-data`, as the retired NetworkFirst route did) and the REAL generated worker.
//
// Two paths are proven:
// 1. Normal upgrade: the new worker installs, its imported /js/sw-purge.js deletes `live-data` on
//    activate.
// 2. Purge script missing: importScripts fails, the new worker never activates (it stays waiting),
//    the OLD worker stays in control -- and the page-side purge in sw-register.js still deletes
//    `live-data` on the next load. That second line exists because path 1 alone depends on the install succeeding.

const DIST = resolve(process.cwd(), 'dist')
const RETIRED_CACHE = 'live-data'
const GATED_URL = 'https://d1pfm520aduift.cloudfront.net/health.json'

// The old worker: what a returning visitor's browser holds before this deploy, reduced to the part
// that matters -- a `live-data` cache that holds a gated export.
const OLD_WORKER = `
self.addEventListener('install', function (event) {
  self.skipWaiting();
  event.waitUntil(caches.open('${RETIRED_CACHE}').then(function (cache) {
    return cache.put('${GATED_URL}', new Response('{"gated":true}', {headers: {'Content-Type': 'application/json'}}));
  }));
});
self.addEventListener('activate', function (event) { event.waitUntil(self.clients.claim()); });
`

const MIME: Record<string, string> = {
  '.html': 'text/html; charset=utf-8',
  '.js': 'text/javascript; charset=utf-8',
  '.css': 'text/css; charset=utf-8',
  '.json': 'application/json',
  '.webmanifest': 'application/manifest+json',
  '.svg': 'image/svg+xml',
  '.png': 'image/png',
  '.ico': 'image/x-icon',
  '.txt': 'text/plain; charset=utf-8',
  '.woff2': 'font/woff2'
}

interface Mode {
  worker: 'old' | 'new'
  purgeMissing: boolean
}

const mode: Mode = {worker: 'old', purgeMissing: false}
let server: Server
let origin: string

async function serve(pathname: string): Promise<{status: number; type: string; body: Buffer | string}> {
  if (pathname === '/sw.js' && mode.worker === 'old') {
    return {status: 200, type: MIME['.js'], body: OLD_WORKER}
  }
  if (pathname === '/js/sw-purge.js' && mode.purgeMissing) {
    return {status: 404, type: 'text/plain', body: 'not found'}
  }
  const relative = pathname === '/' ? 'index.html' : pathname.replace(/^\/+/, '')
  const file = normalize(join(DIST, relative))
  if (!file.startsWith(DIST)) {
    return {status: 403, type: 'text/plain', body: 'forbidden'}
  }
  // Astro builds `/privacy` and `/404` as `privacy.html` and `404.html` (trailingSlash: 'never'), and
  // Workbox precaches them by their extensionless URLs, so resolve the way the production host does.
  for (const candidate of [file, `${file}.html`, join(file, 'index.html')]) {
    try {
      return {status: 200, type: MIME[extname(candidate)] ?? 'application/octet-stream', body: await readFile(candidate)}
    } catch {
      // Try the next candidate.
    }
  }
  return {status: 404, type: 'text/plain', body: 'not found'}
}

test.use({serviceWorkers: 'allow'})
// The suite default is 30 s. Installing the real worker precaches all of dist/, and each test polls
// for up to 20 s twice, so a slow self-hosted runner needs more headroom than one test's budget.
test.describe.configure({timeout: 90_000})

test.beforeAll(async () => {
  server = createServer((request, response) => {
    void serve(new URL(request.url ?? '/', 'http://127.0.0.1').pathname).then(({status, type, body}) => {
      // no-cache on everything, so a worker update check always reaches this server.
      response.writeHead(status, {'Content-Type': type, 'Cache-Control': 'no-cache'})
      response.end(body)
    })
  })
  await new Promise<void>((done) => server.listen(0, '127.0.0.1', done))
  origin = `http://127.0.0.1:${(server.address() as AddressInfo).port}`
})

test.afterAll(async () => {
  await new Promise((done) => server.close(done))
})

test.beforeEach(() => {
  mode.worker = 'old'
  mode.purgeMissing = false
})

const hasRetiredCache = (page: Page) => page.evaluate((name) => caches.has(name), RETIRED_CACHE)
const hasPrecache = (page: Page) => page.evaluate(async () => (await caches.keys()).some((key) => key.startsWith('workbox-precache')))

async function loadWithOldWorker(page: Page): Promise<void> {
  await page.goto(`${origin}/`)
  await page.evaluate(() => navigator.serviceWorker.ready)
  await expect.poll(() => hasRetiredCache(page), {message: 'the old worker left gated JSON in live-data'}).toBe(true)
  expect(await hasPrecache(page)).toBe(false)
}

async function checkForUpdate(page: Page): Promise<void> {
  await page.evaluate(async () => {
    const registration = await navigator.serviceWorker.getRegistration()
    await registration?.update().catch(() => undefined)
  })
}

test('the new worker deletes live-data when it activates over the old one', async ({page}) => {
  await loadWithOldWorker(page)

  mode.worker = 'new'
  await checkForUpdate(page)

  await expect.poll(() => hasPrecache(page), {message: 'the generated worker installed', timeout: 20_000}).toBe(true)
  await expect.poll(() => hasRetiredCache(page), {message: 'sw-purge.js deleted live-data on activate', timeout: 20_000}).toBe(false)
})

test('the page deletes live-data on load when the new worker cannot install', async ({page}) => {
  await loadWithOldWorker(page)

  mode.worker = 'new'
  mode.purgeMissing = true
  await checkForUpdate(page)

  // importScripts('/js/sw-purge.js') throws inside Workbox's asynchronous module callback, before
  // precacheAndRoute and skipWaiting run. The new worker therefore finishes installing with no work
  // and stays WAITING (or, in other engines, goes redundant); either way it never activates. The old
  // worker stays in control and live-data survives: the worker-side purge never ran.
  await expect.poll(() =>
    page.evaluate(async () => {
      const registration = await navigator.serviceWorker.getRegistration()
      return registration?.installing === null
    }), {timeout: 20_000}).toBe(true)
  expect(await page.evaluate(async () => (await navigator.serviceWorker.getRegistration())?.active?.state)).toBe('activated')
  expect(await hasPrecache(page)).toBe(false)
  expect(await hasRetiredCache(page)).toBe(true)

  await page.reload()

  await expect.poll(() => hasRetiredCache(page), {message: 'sw-register.js deleted live-data from the page'}).toBe(false)
})
