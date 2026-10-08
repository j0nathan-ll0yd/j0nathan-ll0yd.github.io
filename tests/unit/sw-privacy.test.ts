import {describe, expect, it} from 'vitest'
import {
  gatedProbeUrls,
  precachedGatedUrls,
  readRegexLiteral,
  scanWorkerSource,
  scanWorkerTree,
  siteGatedProbeUrls,
  verifyPurgeScript,
  workerImports
} from '../../scripts/lib/sw-privacy.mjs'

// covers: client-privacy#No service-worker path caches a gated response
// Synthetic workers for the scan shared by scripts/check-sw-precache.mjs and the build test (atlas
// decision 0160, PR 0b). Each known blind spot of the scan has a case here that
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
    expect(problems.some((problem) => problem.includes('uses '))).toBe(true)
    expect(problems.join('\n')).toContain(name.startsWith('a raw') ? "a 'fetch' event listener" : name)
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

// Textual gaps the verifier found in the first version of the scan: each must be rejected.
describe('scanWorkerSource: aliases and alternate listener forms', () => {
  it.each([
    [
      'an alias of registerRoute',
      'const r=e.registerRoute;r(/^https:\\/\\/jonathanlloyd\\.me\\/feed\\.xml$/,new e.NetworkFirst(),"GET");',
      'other than as a direct call'
    ],
    ['a bracket call of registerRoute', 'e["registerRoute"](/x/,new e.NetworkFirst(),"GET");', 'other than as a direct call'],
    ['self.onfetch =', 'self.onfetch=function(t){t.respondWith(caches.match(t.request))};', 'uses onfetch'],
    ['self["addEventListener"]("fetch")', 'self["addEventListener"]("fetch",function(){});', "a 'fetch' event listener"],
    ['addEventListener.call(self, `fetch`)', 'self.addEventListener.call(self,`fetch`,function(){});', "a 'fetch' event listener"]
  ])('rejects %s', (_label, code, expected) => {
    const problems = scanWorkerSource(PURGE_IMPORT + IMAGE_ROUTES + code, {gatedUrls, requirePurgeImport: true})
    expect(problems.join('\n')).toContain(expected)
  })
})

describe('workerImports', () => {
  const loader = 'if(!self.define){let e;const r=a=>new Promise(s=>{importScripts(a),s()});self.define=(a,i)=>{}}'

  it('names every literal importScripts target and every non-runtime define dependency', () => {
    const {imports, problems} = workerImports(loader + 'define(["./workbox-e190f46a","./extra"],function(e){importScripts("/js/a.js","/js/b.js")});')
    expect(imports).toEqual(['/js/a.js', '/js/b.js', './extra.js'])
    expect(problems).toEqual([])
  })

  it('recognizes the readable loader a NODE_ENV=test build emits', () => {
    const readable = 'if (!self.define) {\n  const singleRequire = (uri) => new Promise(resolve => { importScripts(uri); resolve() })\n}\n' +
      "define(['./workbox-eebca069'], (function (workbox) { 'use strict';\n  importScripts(\"/js/sw-purge.js\");\n}));"
    expect(workerImports(readable)).toEqual({imports: ['/js/sw-purge.js'], problems: []})
  })

  it('allows the Workbox loader its one dynamic import, and refuses a dynamic import anywhere else', () => {
    expect(workerImports(loader + 'define(["./workbox-e190f46a"],function(e){});').problems).toEqual([])
    const {problems} = workerImports(loader + 'define(["./workbox-e190f46a"],function(e){importScripts(self.name)});')
    expect(problems.some((problem) => problem.includes('cannot name'))).toBe(true)
    expect(workerImports('importScripts(x);').problems).toHaveLength(1)
  })
})

describe('precachedGatedUrls', () => {
  it('finds a relative or absolute gated URL in the precache manifest', () => {
    const source =
      'e.precacheAndRoute([{url:"robots.txt",revision:"1"},{url:"llms.txt",revision:"2"},{url:"https://jonathanlloyd.me/feed.json",revision:null}],{});'
    expect(precachedGatedUrls(source, {gatedUrls, siteUrl: 'https://jonathanlloyd.me'})).toEqual([
      'https://jonathanlloyd.me/llms.txt',
      'https://jonathanlloyd.me/feed.json'
    ])
  })
})

describe('scanWorkerTree', () => {
  const clean = PURGE_IMPORT + 'e.precacheAndRoute([{url:"/",revision:"1"}],{});' + IMAGE_ROUTES
  const purge = "(function(){self.addEventListener('activate',function(e){e.waitUntil(caches.delete('live-data').catch(function(){return false;}));});})();"
  const scan = (files: Record<string, string>) =>
    scanWorkerTree({entry: '/sw.js', readWorkerFile: (path: string) => files[path] ?? null, gatedUrls, siteUrl: 'https://jonathanlloyd.me'})

  it('passes a clean worker and its clean imports', () => {
    expect(scan({'/sw.js': clean, '/js/sw-purge.js': purge})).toEqual([])
  })

  it('scans every imported script, recursively, and reports a missing one', () => {
    const problems = scan({
      '/sw.js': clean + 'importScripts("/js/one.js");',
      '/js/sw-purge.js': purge,
      '/js/one.js': 'importScripts("/js/two.js");',
      '/js/two.js': "self.addEventListener('fetch',function(){});"
    })
    expect(problems.some((problem) => problem.startsWith("/js/two.js: uses a 'fetch' event listener"))).toBe(true)
    expect(scan({'/sw.js': clean}).some((problem) => problem.startsWith('/js/sw-purge.js is imported by the worker but missing'))).toBe(true)
  })

  it('reports a gated URL in the entry worker precache manifest', () => {
    const problems = scan({'/sw.js': PURGE_IMPORT + 'e.precacheAndRoute([{url:"index.md",revision:"1"}],{});', '/js/sw-purge.js': purge})
    expect(problems).toContain('/sw.js: precaches gated URL https://jonathanlloyd.me/index.md; a precached gated response replays until the next deploy')
  })
})
