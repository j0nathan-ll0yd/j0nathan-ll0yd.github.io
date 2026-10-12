import {expect, type Page, test} from '@playwright/test'
import {type DistServer, javascript, notFound, startDistServer} from './dist-server'

// Service-worker upgrade over warm retired caches, in real Chromium (atlas decision 0160, PR 0b).
//
// The suite's shared preview server answers on `localhost` only, and public/js/sw-register.js
// deliberately skips registration on `localhost`. So this file serves the built `dist/` itself on
// 127.0.0.1, which also lets it swap the worker script between an OLD worker (one that leaves gated
// data in the retired caches) and the REAL generated worker.
//
// The retired caches: `live-data` (gated JSON under the retired NetworkFirst route) and
// `local-images` (a gated feed the old whole-URL image regex matched through its query string,
// adversarial review H01).
//
// Two paths are proven:
// 1. Normal upgrade: the new worker installs, its imported /js/sw-purge.js deletes both caches on
//    activate.
// 2. Purge script missing: importScripts fails, the new worker never activates (it stays waiting),
//    the OLD worker stays in control -- and the page-side purge in sw-register.js still deletes
//    both caches on the next load. That second line exists because path 1 alone depends on the
//    install succeeding.

const RETIRED_ENTRIES: Record<string, string> = {
  'live-data': 'https://d1pfm520aduift.cloudfront.net/health.json',
  'local-images': '/feed.json?preview=/images/books/'
}

// The old worker: what a returning visitor's browser holds before this deploy, reduced to the part
// that matters -- each retired cache holding a gated response.
const OLD_WORKER = `
self.addEventListener('install', function (event) {
  self.skipWaiting();
  var entries = ${JSON.stringify(RETIRED_ENTRIES)};
  event.waitUntil(Promise.all(Object.keys(entries).map(function (name) {
    return caches.open(name).then(function (cache) {
      return cache.put(entries[name], new Response('{"gated":true}', {headers: {'Content-Type': 'application/json'}}));
    });
  })));
});
self.addEventListener('activate', function (event) { event.waitUntil(self.clients.claim()); });
`

const OLD_WORKER_ANSWER = javascript(OLD_WORKER)
let server: DistServer
let origin: string

test.use({serviceWorkers: 'allow'})
// The suite default is 30 s. Installing the real worker precaches all of dist/, and each test polls
// for up to 20 s twice, so a slow self-hosted runner needs more headroom than one test's budget.
test.describe.configure({timeout: 90_000})

test.beforeAll(async () => {
  server = await startDistServer()
  origin = server.origin
})

test.afterAll(async () => {
  await server.close()
})

test.beforeEach(() => {
  server.overrides.clear()
  server.overrides.set('/sw.js', OLD_WORKER_ANSWER)
})

/** The retired caches that still exist. */
const retiredCaches = (page: Page) =>
  page.evaluate(async (names) => (await Promise.all(names.map(async (name) => (await caches.has(name)) ? name : null))).filter(Boolean),
    Object.keys(RETIRED_ENTRIES))
const hasPrecache = (page: Page) => page.evaluate(async () => (await caches.keys()).some((key) => key.startsWith('workbox-precache')))

async function loadWithOldWorker(page: Page): Promise<void> {
  await page.goto(`${origin}/`)
  await page.evaluate(() => navigator.serviceWorker.ready)
  await expect.poll(() => retiredCaches(page), {message: 'the old worker left gated data in every retired cache'}).toEqual(['live-data', 'local-images'])
  expect(await hasPrecache(page)).toBe(false)
}

async function checkForUpdate(page: Page): Promise<void> {
  await page.evaluate(async () => {
    const registration = await navigator.serviceWorker.getRegistration()
    await registration?.update().catch(() => undefined)
  })
}

test('the new worker deletes every retired cache when it activates over the old one', async ({page}) => {
  await loadWithOldWorker(page)

  server.overrides.delete('/sw.js')
  await checkForUpdate(page)

  await expect.poll(() => hasPrecache(page), {message: 'the generated worker installed', timeout: 20_000}).toBe(true)
  await expect.poll(() => retiredCaches(page), {message: 'sw-purge.js deleted the retired caches on activate', timeout: 20_000}).toEqual([])
})

test('the page deletes every retired cache on load when the new worker cannot install', async ({page}) => {
  await loadWithOldWorker(page)

  server.overrides.delete('/sw.js')
  server.overrides.set('/js/sw-purge.js', notFound)
  await checkForUpdate(page)

  // importScripts('/js/sw-purge.js') throws inside Workbox's asynchronous module callback, before
  // precacheAndRoute and skipWaiting run. The new worker therefore finishes installing with no work
  // and stays WAITING (or, in other engines, goes redundant); either way it never activates. The old
  // worker stays in control and the retired caches survive: the worker-side purge never ran.
  await expect.poll(() =>
    page.evaluate(async () => {
      const registration = await navigator.serviceWorker.getRegistration()
      return registration?.installing === null
    }), {timeout: 20_000}).toBe(true)
  expect(await page.evaluate(async () => (await navigator.serviceWorker.getRegistration())?.active?.state)).toBe('activated')
  expect(await hasPrecache(page)).toBe(false)
  expect(await retiredCaches(page)).toEqual(['live-data', 'local-images'])

  await page.reload()

  await expect.poll(() => retiredCaches(page), {message: 'sw-register.js deleted the retired caches from the page'}).toEqual([])
})
