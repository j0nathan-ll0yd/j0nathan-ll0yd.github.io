import {readFileSync} from 'node:fs'
import {join} from 'node:path'
import {runInNewContext} from 'node:vm'
import {describe, expect, it} from 'vitest'
import {
  anchoredLiteralPrefix,
  GATED_URL_SUFFIXES,
  gatedProbeUrls,
  inspectWorker,
  isNavigationMatcherAt,
  precachedGatedUrls,
  readRegexLiteral,
  RETIRED_CACHES,
  routeDerivedProbeUrls,
  sameOriginPathMatcherAt,
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
// The two image routes as generateSW emits them: a same-origin pathname test, and a regex anchored
// on the CloudFront origin and /images/.
const LOCAL_IMAGES_MATCHER = '({url:e,sameOrigin:s})=>s&&/^\\/images\\/(books|theatre)\\//.test(e.pathname)'
const IMAGE_ROUTES = `e.registerRoute(${LOCAL_IMAGES_MATCHER},new e.CacheFirst({cacheName:"local-images-v2"}),"GET");` +
  'e.registerRoute(/^https:\\/\\/d1pfm520aduift\\.cloudfront\\.net\\/images\\//,new e.CacheFirst({cacheName:"optimized-images-fallback"}),"GET");'
// The route H01 found: a whole-URL regex, so /feed.json?preview=/images/books/ matched it.
const UNANCHORED_IMAGE_ROUTE = 'e.registerRoute(/\\/images\\/(books|theatre)\\//,new e.CacheFirst({cacheName:"local-images"}),"GET");'
// A purge in the shape public/js/sw-purge.js ships: every retired cache, each delete's failure absorbed.
const PURGE_SOURCE = "(function(){var R=['live-data','local-images'];self.addEventListener('activate',function(e){" +
  'e.waitUntil(Promise.all(R.map(function(n){return caches.delete(n).catch(function(){return false;});})));});})();'

describe('gatedProbeUrls', () => {
  it('probes every CloudFront JSON path with and without the poll query, and every site gated path', () => {
    expect(gatedUrls).toContain('https://d1pfm520aduift.cloudfront.net/focus.json')
    expect(gatedUrls).toContain('https://d1pfm520aduift.cloudfront.net/health.json?_poll=1')
    expect(gatedUrls).toContain('https://jonathanlloyd.me/feed.xml')
    expect(gatedUrls).toContain('https://jonathanlloyd.me/llms.txt')
  })

  it('probes every gated URL with query strings and fragments, focus.json and the five site paths included', () => {
    for (const base of ['https://d1pfm520aduift.cloudfront.net/focus.json', 'https://jonathanlloyd.me/feed.json', 'https://jonathanlloyd.me/llms.txt']) {
      for (const suffix of GATED_URL_SUFFIXES) {
        expect(gatedUrls).toContain(`${base}${suffix}`)
      }
    }
    expect(GATED_URL_SUFFIXES).toEqual(expect.arrayContaining(['?preview=/images/books/', '#/images/books/', '?v=1']))
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
    expect(problems.some((problem) => problem.includes('cannot prove it skips gated URLs'))).toBe(true)
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

// covers: client-privacy#No service-worker path caches a gated response
// H01 (adversarial review): a whole-URL regex tested /feed.json?preview=/images/books/ and cached
// the gated feed. Every route must classify by origin and pathname, and every route is probed with
// query and fragment forms of each gated URL.
describe('routes classify by origin and pathname only', () => {
  it('rejects the H01 route in the text scan: unanchored, and matched by a query-string probe', () => {
    const problems = scanWorkerSource(PURGE_IMPORT + UNANCHORED_IMAGE_ROUTE, {gatedUrls, requirePurgeImport: true}).join('\n')
    expect(problems).toContain('is not anchored on a literal origin and path')
    expect(problems).toContain('matches gated URL https://d1pfm520aduift.cloudfront.net/focus.json?preview=/images/books/')
    expect(problems).toContain('declares the retired "local-images" cache')
  })

  it('rejects the H01 route in the inspection, for each of the five site paths and with no image route present', () => {
    const SITE = 'https://jonathanlloyd.me'
    const NAV =
      'e.registerRoute(({request:e})=>"navigate"===e.mode,new e.NetworkOnly({plugins:[new e.PrecacheFallbackPlugin({fallbackURL:"/offline"})]}),"GET");'
    const entry =
      `define(["./workbox-e190f46a"],(function(e){"use strict";${PURGE_IMPORT}e.precacheAndRoute([{url:"offline",revision:"1"}],{});${NAV}${UNANCHORED_IMAGE_ROUTE}}));`
    const problems = verifyInspectedWorker(inspectWorker(entry, {siteUrl: SITE}), {gatedUrls, siteUrl: SITE}).join('\n')
    for (const path of ['/llms.txt', '/llms-full.txt', '/index.md', '/feed.xml', '/feed.json']) {
      expect(problems).toContain(`a CacheFirst route answers gated URL ${SITE}${path}?preview=/images/books/ (cors)`)
    }
    expect(problems).toContain('is not anchored on a literal origin and path')
  })

  it('catches a query-steered regex the fixed suffixes do not name, through probes built from the route itself', () => {
    const route = /[?&]asset=\/static\/(icons|fonts)\//
    const derived = routeDerivedProbeUrls(gatedUrls, route)
    expect(gatedUrls.some((url) => route.test(url))).toBe(false) // the fixed set alone misses it
    expect(derived.some((url) => url.startsWith('https://jonathanlloyd.me/feed.json') && route.test(url))).toBe(true)
    const problems = scanWorkerSource(`${PURGE_IMPORT}e.registerRoute(${route},new e.CacheFirst({cacheName:"assets"}),"GET");`, {gatedUrls}).join('\n')
    expect(problems).toContain('matches gated URL https://')
    expect(problems).toContain('is not anchored on a literal origin and path')
    // The inspection probes the registered RegExp with the same route-derived URLs.
    const SITE = 'https://jonathanlloyd.me'
    const entry = `define(["./workbox-e190f46a"],(function(e){"use strict";${PURGE_IMPORT}e.precacheAndRoute([{url:"offline",revision:"1"}],{});` +
      `e.registerRoute(({request:e})=>"navigate"===e.mode,new e.NetworkOnly({plugins:[new e.PrecacheFallbackPlugin({fallbackURL:"/offline"})]}),"GET");` +
      `e.registerRoute(${route},new e.CacheFirst({cacheName:"assets"}),"GET");}));`
    const inspected = verifyInspectedWorker(inspectWorker(entry, {siteUrl: SITE}), {gatedUrls, siteUrl: SITE}).join('\n')
    expect(inspected).toContain('a CacheFirst route answers gated URL https://jonathanlloyd.me/feed.json?asset=/static/icons/ (cors)')
  })

  it.each<[string, string, string]>([
    ['a pathname test that covers a feed', '({url:e,sameOrigin:s})=>s&&/^\\/feed/.test(e.pathname)', 'covers gated path /feed.xml'],
    ['a pathname test that covers focus.json', '({url:e,sameOrigin:s})=>s&&/^\\/focus\\.json/.test(e.pathname)', 'covers gated path /focus.json'],
    ['an unanchored pathname test', '({url:e,sameOrigin:s})=>s&&/\\/images\\//.test(e.pathname)', 'is not anchored on a literal path'],
    ['a pathname test anchored on a group', '({url:e,sameOrigin:s})=>s&&/^(?:\\/images)\\//.test(e.pathname)', 'is not anchored on a literal path'],
    [
      'a pathname test that also reads the query',
      '({url:e,sameOrigin:s})=>s&&/^\\/images\\//.test(e.pathname+e.search)',
      'cannot prove it skips gated URLs'
    ],
    ['a pathname test on the href', '({url:e,sameOrigin:s})=>s&&/^\\/images\\//.test(e.href)', 'cannot prove it skips gated URLs'],
    ['a pathname test without the same-origin check', '({url:e})=>/^\\/images\\//.test(e.pathname)', 'cannot prove it skips gated URLs'],
    ['a same-origin check that is not the guard', '({url:e,sameOrigin:s})=>e&&/^\\/images\\//.test(e.pathname)', 'cannot prove it skips gated URLs'],
    ['a pathname test widened with ||', '({url:e,sameOrigin:s})=>s&&/^\\/images\\//.test(e.pathname)||e.search', 'cannot prove it skips gated URLs'],
    [
      'a regex on the site origin that covers the llms trio',
      '/^https:\\/\\/jonathanlloyd\\.me\\/llms/',
      'covers gated path https://jonathanlloyd.me/llms.txt'
    ],
    ['a case-insensitive regex', '/^https:\\/\\/JONATHANLLOYD\\.ME\\/FEED/i', 'is not anchored on a literal origin and path'],
    // Unicode case folding: under `iu`, U+017F folds to `s`, so this matches /feed.json?zz=2.
    [
      'a Unicode case-folding regex that reaches a feed',
      '/^https:\\/\\/jonathanlloyd\\.me\\/feed\\.j\u017fon\\?zz/iu',
      'is not anchored on a literal origin and path'
    ],
    ['a regex on another host that covers a gated path', '/^https:\\/\\/www\\.jonathanlloyd\\.me\\/feed/', 'covers gated path'],
    ['a regex on a preview host that covers the llms trio', '/^https:\\/\\/abc\\.portfolio\\.pages\\.dev\\/llms/', 'covers gated path'],
    [
      'a regex on the whole CloudFront origin',
      '/^https:\\/\\/d1pfm520aduift\\.cloudfront\\.net\\//',
      'covers gated path https://d1pfm520aduift.cloudfront.net/focus.json'
    ],
    ['a regex with a top-level alternation', '/^https:\\/\\/x\\.example\\/images\\/|feed/', 'is not anchored on a literal origin and path'],
    ['a regex anchored on no origin', '/^\\/images\\//', 'is not anchored on a literal origin and path']
  ])('rejects %s, in the text scan and in the inspection', (_label, matcher, expected) => {
    const SITE = 'https://jonathanlloyd.me'
    const NAV =
      'e.registerRoute(({request:e})=>"navigate"===e.mode,new e.NetworkOnly({plugins:[new e.PrecacheFallbackPlugin({fallbackURL:"/offline"})]}),"GET");'
    const route = `e.registerRoute(${matcher},new e.CacheFirst({cacheName:"x"}),"GET");`
    expect(scanWorkerSource(PURGE_IMPORT + route, {gatedUrls}).join('\n')).toContain(expected)
    const entry =
      `define(["./workbox-e190f46a"],(function(e){"use strict";${PURGE_IMPORT}e.precacheAndRoute([{url:"offline",revision:"1"}],{});${NAV}${route}}));`
    const inspected = verifyInspectedWorker(inspectWorker(entry, {siteUrl: SITE}), {gatedUrls, siteUrl: SITE}).join('\n')
    // The inspection judges the registered VALUE: a function by its own source text, a RegExp by its source.
    expect(inspected).toContain(
      expected === 'cannot prove it skips gated URLs' ? 'neither an anchored RegExp, a same-origin pathname test, nor the navigation test' : expected
    )
  })

  it('reads the same-origin pathname matcher in both build forms, and nothing looser', () => {
    expect(sameOriginPathMatcherAt(`${LOCAL_IMAGES_MATCHER},new e.CacheFirst`, 0)?.source).toBe('^\\/images\\/(books|theatre)\\/')
    const readable = '({\n  url,\n  sameOrigin\n}) => sameOrigin && /^\\/images\\/(books|theatre)\\//.test(url.pathname), new workbox.CacheFirst'
    expect(sameOriginPathMatcherAt(readable, 0)?.source).toBe('^\\/images\\/(books|theatre)\\/')
    expect(sameOriginPathMatcherAt('({sameOrigin:s,url:e})=>s&&/^\\/a\\//.test(e.pathname),x', 0)?.source).toBe('^\\/a\\/')
    expect(sameOriginPathMatcherAt('({url:e,sameOrigin:s})=>s&&/^\\/a\\//.test(s.pathname),x', 0)).toBeNull()
    expect(sameOriginPathMatcherAt('({url:e,url:s})=>s&&/^\\/a\\//.test(e.pathname),x', 0)).toBeNull()
    expect(sameOriginPathMatcherAt('({url:e,sameOrigin:e})=>e&&/^\\/a\\//.test(e.pathname),x', 0)).toBeNull()
  })

  it('computes the literal prefix an anchored regex requires', () => {
    expect(anchoredLiteralPrefix(/^https:\/\/d1pfm520aduift\.cloudfront\.net\/images\//)).toBe('https://d1pfm520aduift.cloudfront.net/images/')
    expect(anchoredLiteralPrefix(/^\/images\/(books|theatre)\//)).toBe('/images/')
    expect(anchoredLiteralPrefix(/^\/imagesX?\//)).toBe('/images')
    expect(anchoredLiteralPrefix(/^\/a+b/)).toBe('/a')
    expect(anchoredLiteralPrefix(/^\/A\d/i)).toBeNull()
    expect(anchoredLiteralPrefix(/^\/feed\.j\u017fon/iu)).toBeNull()
    expect(anchoredLiteralPrefix(/\/images\//)).toBeNull()
    expect(anchoredLiteralPrefix(/^\/a|\/b/)).toBeNull()
    expect(anchoredLiteralPrefix(/^\/a/m)).toBeNull()
    expect(anchoredLiteralPrefix(/^\/a/g)).toBeNull()
    expect(anchoredLiteralPrefix(/^\/(a|b)/)).toBe('/')
  })
})

describe('review follow-ups', () => {
  it('probes the CloudFront origin of each proxied artifact, and rejects a route on one', () => {
    for (const path of ['/llms.txt', '/llms-full.txt', '/index.md', '/feed.xml', '/feed.json']) {
      expect(siteGatedProbeUrls()).toContain(`https://d1pfm520aduift.cloudfront.net${path}`)
    }
    const problems = scanWorkerSource(
      `${PURGE_IMPORT}e.registerRoute(/^https:\\/\\/d1pfm520aduift\\.cloudfront\\.net\\/index\\.md/,new e.CacheFirst({cacheName:"x"}),"GET");`,
      {gatedUrls: siteGatedProbeUrls()}
    )
    expect(problems.join('\n')).toContain('matches gated URL https://d1pfm520aduift.cloudfront.net/index.md')
    expect(problems.join('\n')).toContain('covers gated path')
  })

  it('refuses a regex literal followed by more expression in the text scan', () => {
    const route = 'e.registerRoute(/^https:\\/\\/d1pfm520aduift\\.cloudfront\\.net\\/images\\//||(()=>!0),new e.CacheFirst({cacheName:"x"}),"GET");'
    expect(scanWorkerSource(PURGE_IMPORT + route, {gatedUrls}).join('\n')).toContain('cannot prove it skips gated URLs')
  })

  it.each([
    ['a manifest held in a variable', 'const m=[{url:"offline",revision:"1"},{url:"/feed.json",revision:null}];e.precacheAndRoute(m,{});'],
    ['string entries and no options argument', 'e.precacheAndRoute([{url:"offline",revision:"1"},"feed.json"]);']
  ])('reports a gated URL the worker precaches through %s', (_label, precache) => {
    const SITE = 'https://jonathanlloyd.me'
    const NAV =
      'e.registerRoute(({request:e})=>"navigate"===e.mode,new e.NetworkOnly({plugins:[new e.PrecacheFallbackPlugin({fallbackURL:"/offline"})]}),"GET");'
    const entry = `define(["./workbox-e190f46a"],(function(e){"use strict";${PURGE_IMPORT}${precache}${NAV}}));`
    expect(verifyInspectedWorker(inspectWorker(entry, {siteUrl: SITE}), {gatedUrls, siteUrl: SITE})).toContain(
      '/sw.js: precaches gated URL https://jonathanlloyd.me/feed.json; a precached gated response replays until the next deploy'
    )
  })
})

describe('retired caches', () => {
  it('lists both caches a retired route wrote', () => {
    expect(RETIRED_CACHES).toEqual(['live-data', 'local-images'])
  })

  it('the page-side purge in public/js/sw-register.js deletes exactly RETIRED_CACHES', () => {
    const deleted: string[] = []
    const source = readFileSync(join(process.cwd(), 'public/js/sw-register.js'), 'utf8')
    const window = {caches: {delete: (name: string) => (deleted.push(name), Promise.resolve(true))}}
    // The purge runs first, before any registration work; the stand-ins past it are minimal, so a
    // later throw is tolerated and only the deleted names are judged.
    try {
      runInNewContext(source, {
        window,
        caches: window.caches,
        navigator: {serviceWorker: {register: () => new Promise(() => {}), addEventListener: () => {}}},
        location: {hostname: 'jonathanlloyd.me'},
        setTimeout: () => 0,
        setInterval: () => 0,
        addEventListener: () => {},
        document: {addEventListener: () => {}}
      })
    } catch {
      // See above.
    }
    expect(deleted).toEqual([...RETIRED_CACHES])
  })

  it('rejects a purge that deletes live-data but keeps local-images', async () => {
    const problems = await verifyPurgeScript(
      "self.addEventListener('activate',function(e){e.waitUntil(caches.delete('live-data').catch(function(){return false;}));});"
    )
    expect(problems).toEqual(['purge activate listener does not delete the "local-images" cache'])
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
  const good = PURGE_SOURCE

  it('accepts a purge that deletes every retired cache on activate and tolerates a failing delete', async () => {
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
  const purge = PURGE_SOURCE
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

  // S2 (adversarial review): additionalManifestEntries: [{url: '/feed.xml', revision: null}] lands in
  // the same precacheAndRoute array, and survived the guard at 97e82034 with zero origin reads on
  // replay. The manifest scan reads every entry of that array, absolute paths and queries included.
  it.each([
    ['/feed.xml', 'https://jonathanlloyd.me/feed.xml'],
    ['/feed.json?preview=/images/books/', 'https://jonathanlloyd.me/feed.json'],
    ['https://d1pfm520aduift.cloudfront.net/focus.json', 'https://d1pfm520aduift.cloudfront.net/focus.json']
  ])('reports an additionalManifestEntries entry %s', (url, reported) => {
    const problems = scan({'/sw.js': generated('', `{url:"offline",revision:"1"},{url:"${url}",revision:null}`), '/js/sw-purge.js': purge})
    expect(problems).toContain(`/sw.js: precaches gated URL ${reported}; a precached gated response replays until the next deploy`)
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
  const purgeScript = PURGE_SOURCE
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
    ['a matcher that reads event', `e.registerRoute(({event:t})=>t.clientId!==undefined,${CACHE_JSON});`, 'cannot prove it skips gated URLs'],
    [
      'a matcher that tests "headers" in request',
      `e.registerRoute(({request:t})=>"headers" in t,${CACHE_JSON});`,
      'cannot prove it skips gated URLs'
    ],
    [
      'a matcher that swallows a throw',
      `e.registerRoute(({request:t})=>{try{return t.headers.get("x")==="y"}catch{return false}},${CACHE_JSON});`,
      'cannot prove it skips gated URLs'
    ],
    [
      'a matcher that sniffs the environment',
      `e.registerRoute(()=>"registration" in self,${CACHE_JSON});`,
      'cannot prove it skips gated URLs'
    ],
    ['a matcher gated on the clock', `e.registerRoute(()=>Date.now()>17e11,${CACHE_JSON});`, 'cannot prove it skips gated URLs'],
    [
      'a matcher chosen by an expression',
      `e.registerRoute(self.registration?/\\.json$/:/^$/,${CACHE_JSON});`,
      'cannot prove it skips gated URLs'
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

  // A third review: NetworkOnly with a fetchOptions cache mode can still be answered from the
  // browser HTTP cache, so plugins is the only option a NetworkOnly route may carry.
  it.each<[string, string, string]>([
    [
      'a navigation route with fetchOptions cache: force-cache',
      NAV.replace('new e.NetworkOnly({plugins:', 'new e.NetworkOnly({fetchOptions:{cache:"force-cache"},plugins:'),
      'not NetworkOnly with the /offline fallback'
    ],
    [
      'a gated NetworkOnly route with fetchOptions',
      NAV + 'e.registerRoute(/\\.json$/,new e.NetworkOnly({fetchOptions:{cache:"force-cache"}}),"GET");',
      'a NetworkOnly route answers gated URL'
    ],
    [
      'a non-enumerable fetchOptions',
      NAV.replace('new e.NetworkOnly({plugins:[new e.PrecacheFallbackPlugin({fallbackURL:"/offline"})]})',
        'new e.NetworkOnly(Object.defineProperty({plugins:[new e.PrecacheFallbackPlugin({fallbackURL:"/offline"})]},"fetchOptions",{value:{cache:"force-cache"}}))'),
      'not NetworkOnly with the /offline fallback'
    ],
    [
      'an inherited fetchOptions',
      NAV.replace('new e.NetworkOnly({plugins:[new e.PrecacheFallbackPlugin({fallbackURL:"/offline"})]})',
        'new e.NetworkOnly(Object.assign(Object.create({fetchOptions:{cache:"force-cache"}}),{plugins:[new e.PrecacheFallbackPlugin({fallbackURL:"/offline"})]}))'),
      'not NetworkOnly with the /offline fallback'
    ],
    [
      'fetchOptions two levels up a null-prototype chain',
      NAV.replace('new e.NetworkOnly({plugins:[new e.PrecacheFallbackPlugin({fallbackURL:"/offline"})]})',
        'new e.NetworkOnly(Object.assign(Object.create(Object.assign(Object.create(null),{fetchOptions:{cache:"force-cache"}})),{plugins:[new e.PrecacheFallbackPlugin({fallbackURL:"/offline"})]}))'),
      'not NetworkOnly with the /offline fallback'
    ],
    [
      'fetchOptions planted on Object.prototype',
      'Object.prototype.fetchOptions={cache:"force-cache"};' + NAV,
      "adds 'fetchOptions' to Object.prototype"
    ],
    [
      'options that are a Proxy',
      NAV.replace('new e.NetworkOnly({plugins:[new e.PrecacheFallbackPlugin({fallbackURL:"/offline"})]})',
        'new e.NetworkOnly(new Proxy({plugins:[new e.PrecacheFallbackPlugin({fallbackURL:"/offline"})]},{get:(t,k)=>k==="fetchOptions"?{cache:"force-cache"}:t[k]}))'),
      'not NetworkOnly with the /offline fallback'
    ],
    [
      'a gated NetworkOnly route with matchOptions',
      NAV + 'e.registerRoute(/\\.json$/,new e.NetworkOnly({matchOptions:{ignoreSearch:true}}),"GET");',
      'a NetworkOnly route answers gated URL'
    ]
  ])('rejects %s', (_label, body, expected) => {
    expect(verify(worker(body)).join('\n')).toContain(expected)
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
    const purge = PURGE_SOURCE
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
