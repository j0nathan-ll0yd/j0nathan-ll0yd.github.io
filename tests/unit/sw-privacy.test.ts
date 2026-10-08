import {describe, expect, it} from 'vitest'
import {gatedProbeUrls, readRegexLiteral, scanWorkerSource, siteGatedProbeUrls, verifyPurgeScript} from '../../scripts/lib/sw-privacy.mjs'

// covers: client-privacy#No service-worker path caches a gated response
// Synthetic workers for the scan shared by scripts/check-sw-precache.mjs and the build test (atlas
// decision 0160, PR 0b; review finding M2). Each blind spot the review found has a case here that
// the scan must reject, and the real worker shape must pass.
const gatedUrls = gatedProbeUrls({
  cloudfrontBase: 'https://d1pfm520aduift.cloudfront.net',
  endpointPaths: ['/focus.json', '/health.json', '/books.json'],
  siteUrl: 'https://jonathanlloyd.me',
  siteGatedPaths: ['/llms.txt', '/llms-full.txt', '/index.md', '/feed.xml', '/feed.json']
})
const PURGE_IMPORT = 'importScripts("/js/sw-purge.js");'
const IMAGE_ROUTES = 'e.registerRoute(/\\/images\\/(books|theatre)\\//,new e.CacheFirst({cacheName:"local-images"}),"GET");' +
  'e.registerRoute(/^https:\\/\\/d1pfm520aduift\\.cloudfront\\.net\\/images\\//,new e.CacheFirst({cacheName:"optimized-images-fallback"}),"GET");'

describe('gatedProbeUrls', () => {
  it('probes every CloudFront JSON path with and without the poll query, and every site gated path', () => {
    expect(gatedUrls).toContain('https://d1pfm520aduift.cloudfront.net/focus.json')
    expect(gatedUrls).toContain('https://d1pfm520aduift.cloudfront.net/health.json?_poll=1')
    expect(gatedUrls).toContain('https://jonathanlloyd.me/feed.xml')
    expect(gatedUrls).toContain('https://jonathanlloyd.me/llms.txt')
  })

  it('derives the production set from the contract and the route registries', () => {
    const urls = siteGatedProbeUrls()
    for (const path of ['/llms.txt', '/llms-full.txt', '/index.md', '/feed.xml', '/feed.json']) {
      expect(urls).toContain(`https://jonathanlloyd.me${path}`)
    }
    expect(urls.some((url) => url.endsWith('/focus.json'))).toBe(true)
  })
})

describe('scanWorkerSource', () => {
  it('passes the real worker shape: two image routes and the purge import', () => {
    expect(scanWorkerSource(PURGE_IMPORT + IMAGE_ROUTES, {gatedUrls, requirePurgeImport: true})).toEqual([])
  })

  it.each([
    [
      'the retired CloudFront JSON route',
      'e.registerRoute(/^https:\\/\\/d1pfm520aduift\\.cloudfront\\.net\\/(?!.*[?&]_poll=).*\\.json$/,new e.NetworkFirst({cacheName:"x"}),"GET");'
    ],
    [
      'a NetworkFirst route on a site-origin feed',
      'e.registerRoute(/^https:\\/\\/jonathanlloyd\\.me\\/feed\\.(xml|json)$/,new e.NetworkFirst({cacheName:"feeds"}),"GET");'
    ],
    ['a route on the llms trio', 'e.registerRoute(/\\/(llms(-full)?\\.txt|index\\.md)$/,new e.StaleWhileRevalidate({cacheName:"llms"}),"GET");']
  ])('rejects %s', (_label, route) => {
    const problems = scanWorkerSource(PURGE_IMPORT + IMAGE_ROUTES + route, {gatedUrls, requirePurgeImport: true})
    expect(problems.some((problem) => problem.includes('matches gated URL'))).toBe(true)
  })

  it.each([
    ['setDefaultHandler', 'e.setDefaultHandler(new e.NetworkFirst({cacheName:"all"}));'],
    ['setCatchHandler', 'e.setCatchHandler(({event})=>caches.match(event.request));'],
    ['a raw fetch listener (double quotes)', 'self.addEventListener("fetch",e=>e.respondWith(caches.match(e.request)));'],
    ['a raw fetch listener (single quotes, spaced)', "self.addEventListener( 'fetch' , handler);"]
  ])('rejects %s', (name, code) => {
    const problems = scanWorkerSource(PURGE_IMPORT + IMAGE_ROUTES + code, {gatedUrls, requirePurgeImport: true})
    expect(problems.some((problem) => problem.includes('calls '))).toBe(true)
    expect(problems.join('\n')).toContain(name.startsWith('a raw') ? "addEventListener('fetch')" : name)
  })

  it('rejects a route whose matcher is not a regex literal', () => {
    const problems = scanWorkerSource(PURGE_IMPORT + 'e.registerRoute(({url})=>url.pathname.endsWith(".json"),new e.NetworkFirst(),"GET");', {
      gatedUrls,
      requirePurgeImport: true
    })
    expect(problems.some((problem) => problem.includes('not a regex literal'))).toBe(true)
  })

  it('rejects the retired cache name and a missing purge import', () => {
    const problems = scanWorkerSource(IMAGE_ROUTES + 'e.registerRoute(/\\/never\\//,new e.NetworkFirst({cacheName:"live-data"}),"GET");', {
      gatedUrls,
      requirePurgeImport: true
    })
    expect(problems.some((problem) => problem.includes('retired "live-data"'))).toBe(true)
    expect(problems.some((problem) => problem.includes('does not importScripts'))).toBe(true)
  })

  it('rejects a probe set without focus.json', () => {
    expect(scanWorkerSource(PURGE_IMPORT, {gatedUrls: ['https://jonathanlloyd.me/feed.xml']})).toEqual([
      'the gated-URL probe set has no /focus.json; it is incomplete'
    ])
  })
})

describe('readRegexLiteral', () => {
  it('reads a literal with a slash inside a character class and returns null for non-literals', () => {
    const source = 'x(/a[/]b\\/c/gi, 1)'
    expect(readRegexLiteral(source, 2)?.source).toBe('a[/]b\\/c')
    expect(readRegexLiteral('x(fn)', 2)).toBeNull()
  })
})

describe('verifyPurgeScript', () => {
  const good = "(function(){self.addEventListener('activate',function(e){e.waitUntil(caches.delete('live-data').catch(function(){return false;}));});})();"

  it('accepts a purge that deletes live-data on activate and tolerates a failing delete', async () => {
    expect(await verifyPurgeScript(good)).toEqual([])
  })

  it('rejects a script that only names the cache in a comment (a substring check would pass it)', async () => {
    const problems = await verifyPurgeScript(
      "// caches.delete('live-data') on 'activate'\nself.addEventListener('activate',function(e){e.waitUntil(Promise.resolve());});"
    )
    expect(problems).toContain('purge activate listener does not delete the "live-data" cache')
  })

  it('rejects a purge whose activation rejects when the delete fails', async () => {
    const problems = await verifyPurgeScript("self.addEventListener('activate',function(e){e.waitUntil(caches.delete('live-data'));});")
    expect(problems.some((problem) => problem.includes('rejects when the cache delete rejects'))).toBe(true)
  })

  it('rejects a purge that also listens for fetch, or forgets waitUntil', async () => {
    expect(await verifyPurgeScript(good + "self.addEventListener('fetch',function(){});")).toContain(
      "purge script must register exactly one 'activate' listener; it registered [activate, fetch]"
    )
    expect(await verifyPurgeScript("self.addEventListener('activate',function(){caches.delete('live-data');});")).toContain(
      'purge activate listener does not call event.waitUntil'
    )
  })
})
