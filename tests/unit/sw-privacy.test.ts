import {describe, expect, it} from 'vitest'
import {
  gatedProbeUrls,
  inspectWorker,
  isNavigationMatcherAt,
  precachedGatedUrls,
  readRegexLiteral,
  scanWorkerSource,
  scanWorkerTree,
  siteGatedProbeUrls,
  verifyInspectedWorker,
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
    expect(problems.some((problem) => problem.includes('neither a regex literal nor the navigation test'))).toBe(true)
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
  // The entry worker is in the shape generateSW emits, because the tree scan also RUNS it (inspectWorker).
  const generated = (body: string, precache = '{url:"offline",revision:"1"}') =>
    `define(["./workbox-e190f46a"],(function(e){"use strict";${PURGE_IMPORT}e.precacheAndRoute([${precache}],{});` +
    `e.registerRoute(({request:e})=>"navigate"===e.mode,new e.NetworkOnly({plugins:[new e.PrecacheFallbackPlugin({fallbackURL:"/offline"})]}),"GET");${body}}));`
  const clean = generated(IMAGE_ROUTES)
  const purge = "(function(){self.addEventListener('activate',function(e){e.waitUntil(caches.delete('live-data').catch(function(){return false;}));});})();"
  const scan = (files: Record<string, string>) =>
    scanWorkerTree({entry: '/sw.js', readWorkerFile: (path: string) => files[path] ?? null, gatedUrls, siteUrl: 'https://jonathanlloyd.me'})

  it('passes a clean worker and its clean imports', () => {
    expect(scan({'/sw.js': clean, '/js/sw-purge.js': purge})).toEqual([])
  })

  it('scans every imported script, recursively, and reports a missing one', () => {
    const problems = scan({
      '/sw.js': generated(IMAGE_ROUTES + 'importScripts("/js/one.js");'),
      '/js/sw-purge.js': purge,
      '/js/one.js': 'importScripts("/js/two.js");',
      '/js/two.js': "self.addEventListener('fetch',function(){});"
    })
    expect(problems.some((problem) => problem.startsWith("/js/two.js: uses a 'fetch' event listener"))).toBe(true)
    expect(scan({'/sw.js': clean}).some((problem) => problem.startsWith('/js/sw-purge.js is imported by the worker but missing'))).toBe(true)
  })

  it('reports a gated URL in the entry worker precache manifest', () => {
    const problems = scan({'/sw.js': generated('', '{url:"offline",revision:"1"},{url:"index.md",revision:"1"}'), '/js/sw-purge.js': purge})
    expect(problems).toContain('/sw.js: precaches gated URL https://jonathanlloyd.me/index.md; a precached gated response replays until the next deploy')
  })
})

// covers: client-privacy#Navigations go to the network, and only the data-free /offline page answers offline
// The generated worker is RUN against a recording Workbox stand-in, so a function matcher is judged
// by what it matches, not by how it is spelled. Each worker below is in the shape generateSW emits.
describe('inspectWorker + verifyInspectedWorker', () => {
  const SITE = 'https://jonathanlloyd.me'
  const NAV =
    'e.registerRoute(({request:e})=>"navigate"===e.mode,new e.NetworkOnly({plugins:[new e.PrecacheFallbackPlugin({fallbackURL:"/offline"})]}),"GET");'
  const OFFLINE_ENTRY = '{url:"offline",revision:"1"},'
  const worker = (body: string, precache = OFFLINE_ENTRY) =>
    `define(["./workbox-e190f46a"],(function(e){"use strict";importScripts("/js/sw-purge.js"),self.skipWaiting(),e.clientsClaim(),` +
    `e.precacheAndRoute([${precache}{url:"manifest.webmanifest",revision:"1"}],{}),e.cleanupOutdatedCaches();${body}}));`
  const verify = (source: string) => verifyInspectedWorker(inspectWorker(source, {siteUrl: SITE}), {gatedUrls, siteUrl: SITE})

  it('passes the shipped shape: a NetworkOnly navigation route falling back to the precached /offline', () => {
    expect(verify(worker(NAV + IMAGE_ROUTES))).toEqual([])
  })

  it.each<[string, string, string]>([
    ['no navigation route', IMAGE_ROUTES, 'no route answers a navigation to /'],
    [
      'a NetworkFirst navigation route',
      'e.registerRoute(({request:e})=>"navigate"===e.mode,new e.NetworkFirst({cacheName:"pages"}),"GET");',
      'answered by NetworkFirst'
    ],
    [
      'a NetworkOnly navigation route with no fallback',
      'e.registerRoute(({request:e})=>"navigate"===e.mode,new e.NetworkOnly,"GET");',
      'not NetworkOnly with the /offline fallback'
    ],
    [
      'a fallback to another URL',
      'e.registerRoute(({request:e})=>"navigate"===e.mode,new e.NetworkOnly({plugins:[new e.PrecacheFallbackPlugin({fallbackURL:"/"})]}),"GET");',
      'is not the single plugin of a NetworkOnly route'
    ],
    [
      'a second fallback route',
      NAV +
      'e.registerRoute(({url:e})=>e.pathname.endsWith(".json"),new e.NetworkOnly({plugins:[new e.PrecacheFallbackPlugin({fallbackURL:"/offline"})]}),"GET");',
      'exactly one navigation fallback is allowed'
    ],
    ['a catch handler', NAV + 'e.setCatchHandler(()=>caches.match("/offline"));', 'uses setCatchHandler'],
    ['a default handler', NAV + 'e.setDefaultHandler(new e.NetworkFirst);', 'uses setDefaultHandler'],
    ['a NavigationRoute (navigateFallback)', NAV + 'e.registerRoute(new e.NavigationRoute(e.createHandlerBoundToURL("/")));', 'uses NavigationRoute'],
    [
      'a function route that caches a gated feed',
      NAV + 'e.registerRoute(({url:e})=>e.pathname.startsWith("/feed"),new e.CacheFirst({cacheName:"feeds"}),"GET");',
      'a CacheFirst route answers gated URL https://jonathanlloyd.me/feed.xml'
    ],
    ['a Workbox API this check does not model', NAV + 'e.warmStrategyCache({urls:["/"],strategy:new e.CacheFirst});', 'uses Workbox warmStrategyCache']
  ])('rejects %s', (_label, body, expected) => {
    expect(verify(worker(body)).join('\n')).toContain(expected)
  })

  // Shapes an independent review found the first inspection missed: each registers a route that
  // caches gated JSON, but outside what a single synchronous run with a plain request could see.
  const CACHE_JSON = 'new e.CacheFirst({cacheName:"json"}),"GET"'
  it.each<[string, string, string]>([
    [
      'a route registered in a promise callback',
      `Promise.resolve().then(()=>e.registerRoute(({url:t})=>t.pathname.endsWith(".json"),${CACHE_JSON}));`,
      'ran 0 time(s) while the worker was inspected'
    ],
    [
      'a route registered in an activate listener',
      `self.addEventListener("activate",()=>e.registerRoute(({url:t})=>t.pathname.endsWith(".json"),${CACHE_JSON}));`,
      "registers a 'activate' listener"
    ],
    [
      'a matcher that reads request.headers',
      // Optional chaining: without the throwing stand-in this would quietly evaluate to false.
      `e.registerRoute(({request:t})=>t.headers?.get("accept")==="application/json",${CACHE_JSON});`,
      'a CacheFirst route answers gated URL'
    ],
    ['a matcher that reads request.cache', `e.registerRoute(({request:t})=>t.cache==="default",${CACHE_JSON});`, 'a CacheFirst route answers gated URL'],
    ['a matcher that reads event', `e.registerRoute(({event:t})=>t.clientId!==undefined,${CACHE_JSON});`, 'a CacheFirst route answers gated URL'],
    [
      'a route behind a condition that is false while inspected',
      `if(self.registration&&self.registration.scope)e.registerRoute(({url:t})=>t.pathname.endsWith(".json"),${CACHE_JSON});`,
      'ran 0 time(s) while the worker was inspected'
    ]
  ])('rejects %s', (_label, body, expected) => {
    expect(verify(worker(NAV + body)).join('\n')).toContain(expected)
  })

  // A second review's probes: each balanced a plain call-site count, or used a matcher input the
  // stand-in modelled loosely. The whole scan (text allowlist plus inspection) must reject each.
  const purgeScript =
    "(function(){self.addEventListener('activate',function(e){e.waitUntil(caches.delete('live-data').catch(function(){return false;}));});})();"
  const scanEntry = (body: string) =>
    scanWorkerTree({
      entry: '/sw.js',
      readWorkerFile: (path: string) => (path === '/sw.js' ? worker(NAV + body) : path === '/js/sw-purge.js' ? purgeScript : null),
      gatedUrls,
      siteUrl: SITE
    }).join('\n')
  const DEFERRED = `Promise.resolve().then(()=>e.registerRoute(/\\.json$/,${CACHE_JSON}));`
  it.each<[string, string, string]>([
    [
      'a helper that calls one registerRoute site twice, plus a deferred route',
      `const f=m=>e.registerRoute(m,new e.NetworkOnly,"GET");f(/a/);f(/b/);${DEFERRED}`,
      'ran 2 time(s)'
    ],
    [
      'a computed registerRoute name, plus a deferred route',
      `e["regis"+"terRoute"](/a/,new e.NetworkOnly,"GET");${DEFERRED}`,
      'registerRoute reached by a computed name'
    ],
    ['a matcher that reads event', `e.registerRoute(({event:t})=>t.clientId!==undefined,${CACHE_JSON});`, 'neither a regex literal nor the navigation test'],
    [
      'a matcher that tests "headers" in request',
      `e.registerRoute(({request:t})=>"headers" in t,${CACHE_JSON});`,
      'neither a regex literal nor the navigation test'
    ],
    [
      'a matcher that swallows a throw',
      `e.registerRoute(({request:t})=>{try{return t.headers.get("x")==="y"}catch{return false}},${CACHE_JSON});`,
      'neither a regex literal nor the navigation test'
    ],
    [
      'a matcher that sniffs the environment',
      `e.registerRoute(()=>"registration" in self,${CACHE_JSON});`,
      'neither a regex literal nor the navigation test'
    ],
    ['a matcher gated on the clock', `e.registerRoute(()=>Date.now()>17e11,${CACHE_JSON});`, 'neither a regex literal nor the navigation test'],
    [
      'a matcher chosen by an expression',
      `e.registerRoute(self.registration?/\\.json$/:/^$/,${CACHE_JSON});`,
      'neither a regex literal nor the navigation test'
    ]
  ])('rejects %s', (_label, body, expected) => {
    expect(scanEntry(body)).toContain(expected)
  })

  it('accepts the navigation matcher in both build forms, and only when its parameter is the one compared', () => {
    expect(isNavigationMatcherAt('({request:e})=>"navigate"===e.mode,new e.NetworkOnly', 0)).toBe(true)
    expect(isNavigationMatcherAt("({\n  request\n}) => request.mode === 'navigate', new workbox.NetworkOnly", 0)).toBe(true)
    expect(isNavigationMatcherAt('({request:e})=>"navigate"===t.mode,new e.NetworkOnly', 0)).toBe(false)
    expect(isNavigationMatcherAt('({request:e})=>"navigate"===e.mode||1,new e.CacheFirst', 0)).toBe(false)
    expect(isNavigationMatcherAt('({request:e,event:t})=>"navigate"===e.mode,x', 0)).toBe(false)
  })

  it('requires /offline in the precache and rejects any other precached HTML document', () => {
    expect(verify(worker(NAV, '')).join('\n')).toContain('the data-free /offline page is not precached')
    const problems = verify(worker(NAV, OFFLINE_ENTRY + '{url:"/",revision:"1"},{url:"privacy",revision:"1"},{url:"404.html",revision:"1"},'))
    expect(problems).toEqual(expect.arrayContaining([
      '/sw.js: precaches the HTML document /; a precached document answers navigations before the NetworkOnly route',
      '/sw.js: precaches the HTML document /privacy; a precached document answers navigations before the NetworkOnly route',
      '/sw.js: precaches the HTML document /404.html; a precached document answers navigations before the NetworkOnly route'
    ]))
  })

  it('accepts the shipped function matcher in the entry worker, and reports a worker that cannot run', () => {
    const purge =
      "(function(){self.addEventListener('activate',function(e){e.waitUntil(caches.delete('live-data').catch(function(){return false;}));});})();"
    const scan = (entry: string) =>
      scanWorkerTree({
        entry: '/sw.js',
        readWorkerFile: (path: string) => (path === '/sw.js' ? entry : path === '/js/sw-purge.js' ? purge : null),
        gatedUrls,
        siteUrl: SITE
      })
    expect(scan(worker(NAV + IMAGE_ROUTES))).toEqual([])
    expect(scan(worker(NAV) + 'throw new Error("boom")').join('\n')).toContain('could not be run for inspection')
  })
})
