// Pure service-worker privacy scan (atlas decision 0160, PR 0b).
//
// One implementation, two callers: scripts/check-sw-precache.mjs (the postbuild gate) and
// tests/build/sw-update.test.ts, plus synthetic-worker unit tests in tests/unit/sw-privacy.test.ts.
// Each function takes source text and returns a list of problems, so a regression in the scan is
// caught by a test that feeds it a hand-written worker rather than by waiting for a bad build.
//
// The rule it enforces: no service-worker path may cache, or answer from a cache, a gated
// response. Gated responses are the focus signal and every CloudFront JSON export, and the five
// site-origin proxy routes (the llms trio and the two feeds). A replayed copy shows data while the
// owner hides it.
import {runInNewContext} from 'node:vm'
import {CLOUDFRONT_BASE, ENDPOINTS, LLM_CONTENT_PATHS, SITE_URL} from '@j0nathan-ll0yd/portal-contract/constants'
import {FEED_ARTIFACTS} from '../../functions/_lib/feed-artifacts.ts'
import {LLMS_TXT_PATH} from '../../functions/_lib/llms-artifacts.ts'

export const RETIRED_CACHE = 'live-data'
export const PURGE_SCRIPT = '/js/sw-purge.js'

/**
 * Every URL a route matcher must NOT match: each CloudFront `.json` endpoint with and without the
 * poll query, and each site-origin gated path. A route that excludes `?_poll=1` still fails.
 */
export function gatedProbeUrls({cloudfrontBase, endpointPaths, siteUrl, siteGatedPaths}) {
  const cloudfront = endpointPaths.filter((path) => path.endsWith('.json')).flatMap((
    path
  ) => [`${cloudfrontBase}${path}`, `${cloudfrontBase}${path}?_poll=1`])
  const site = siteGatedPaths.map((path) => `${siteUrl}${path}`)
  return [...cloudfront, ...site]
}

/**
 * The production probe set, derived from the same registries the proxy routes and the client read:
 * every CloudFront export, and the five site-origin gated routes.
 */
export function siteGatedProbeUrls() {
  return gatedProbeUrls({
    cloudfrontBase: CLOUDFRONT_BASE,
    endpointPaths: Object.values(ENDPOINTS),
    siteUrl: SITE_URL,
    siteGatedPaths: [LLMS_TXT_PATH, LLM_CONTENT_PATHS.llmsFull, LLM_CONTENT_PATHS.indexMarkdown, ...FEED_ARTIFACTS.map((artifact) => artifact.path)]
  })
}

/**
 * True when the text at `start` is exactly the navigation matcher `({request}) => request.mode ===
 * 'navigate'`, in the form generateSW emits it: minified (`({request:e})=>"navigate"===e.mode`) or
 * readable, followed by the argument-separating comma.
 */
export function isNavigationMatcherAt(source, start) {
  const match =
    /^\(\{\s*request\s*(?::\s*([A-Za-z_$][\w$]*))?\s*\}\)\s*=>\s*(?:(["'])navigate\2\s*===\s*([A-Za-z_$][\w$]*)\.mode|([A-Za-z_$][\w$]*)\.mode\s*===\s*(["'])navigate\5)\s*,/
      .exec(source.slice(start))
  if (!match) {
    return false
  }
  const parameter = match[1] ?? 'request'
  return (match[3] ?? match[4]) === parameter
}

/** Reads the JS regex literal that starts at `start` (a `/`), or null when there is none. */
export function readRegexLiteral(source, start) {
  if (source[start] !== '/') {
    return null
  }
  let inClass = false
  for (let i = start + 1; i < source.length; i++) {
    const ch = source[i]
    if (ch === '\\') {
      i++
    } else if (ch === '[') {
      inClass = true
    } else if (ch === ']') {
      inClass = false
    } else if (ch === '\n') {
      return null
    } else if (ch === '/' && !inClass) {
      const flags = /^[dgimsuyv]*/.exec(source.slice(i + 1))[0]
      try {
        return new RegExp(source.slice(start + 1, i), flags)
      } catch {
        return null
      }
    }
  }
  return null
}

// Ways a worker can answer requests outside a regex route this scan can test. Each one is refused
// outright, matched as TEXT ANYWHERE rather than as one call shape, so an alias, a bracket access or
// an `on` property cannot slip past: a default or catch handler answers EVERY unmatched request, and
// a fetch listener -- `addEventListener('fetch', ...)`, `self['addEventListener']('fetch', ...)`,
// `self.onfetch = ...` -- can cache anything. A worker that needs one of these words for another
// reason is rare enough to justify a deliberate change here. Workbox's own runtime chunk
// (workbox-<hash>.js) legitimately listens for fetch and is the one file this scan does not read.
const UNROUTED_HANDLERS = [
  {pattern: /setDefaultHandler/, name: 'setDefaultHandler'},
  {pattern: /setCatchHandler/, name: 'setCatchHandler'},
  {pattern: /\bonfetch\b/, name: 'onfetch'},
  {pattern: /["'`]fetch["'`]/, name: "a 'fetch' event listener"}
]

// The Workbox runtime chunk the generated worker loads through its AMD `define`.
const WORKBOX_RUNTIME_DEPENDENCY = /^\.\/workbox-[0-9a-f]{8}$/
// The Workbox AMD loader at the top of the generated sw.js calls `importScripts(<variable>)` to load
// its runtime chunk. That one dynamic import is allowed only inside the loader, before `define([`.
// Matched with optional whitespace: the build minifies the worker (`if(!self.define)`), but a build
// under NODE_ENV=test, as test:build runs it, leaves it readable (`if (!self.define) {`).
const WORKBOX_LOADER_MARKER = /if\s*\(\s*!\s*self\.define\s*\)/

/**
 * Scans one worker script for gated-data caching paths.
 *
 * @param {string} source       the worker source (the generated sw.js, or a script it imports)
 * @param {object} options
 * @param {string[]} options.gatedUrls       URLs no route may match (see gatedProbeUrls)
 * @param {boolean} [options.requirePurgeImport]  true for sw.js: it must import the purge script
 * @param {string} [options.label]           how problems name this source
 * @returns {string[]} problems; empty when the source is clean
 */
export function scanWorkerSource(source, {gatedUrls, requirePurgeImport = false, label = 'sw.js', matchersInspected = false}) {
  const problems = []
  if (!gatedUrls.some((url) => url.endsWith('/focus.json'))) {
    problems.push('the gated-URL probe set has no /focus.json; it is incomplete')
  }

  const routeStarts = [...source.matchAll(/registerRoute\(\s*/g)].map((m) => m.index + m[0].length)
  // Every mention of registerRoute must be a direct call this scan can test. An alias
  // (`const r = e.registerRoute`) or a bracket access (`e['registerRoute'](...)`) is a route the
  // matcher loop below never sees.
  const mentions = (source.match(/registerRoute/g) ?? []).length
  if (mentions !== routeStarts.length) {
    problems.push(
      `${label}: registerRoute is referenced ${mentions - routeStarts.length} time(s) other than as a direct call; an aliased route cannot be tested`
    )
  }
  for (const start of routeStarts) {
    const matcher = readRegexLiteral(source, start)
    if (!matcher) {
      // The one function matcher allowed is the navigation test, spelled exactly, in a worker whose
      // routes inspectWorker() has run and verifyInspectedWorker() has judged (the entry sw.js). Any
      // other function -- one that reads event, sniffs the environment, keeps state, or is chosen
      // by an expression -- is refused here, because no evaluation can prove what it matches.
      if (!(matchersInspected && isNavigationMatcherAt(source, start))) {
        problems.push(
          `${label}: runtime route at offset ${start} has a matcher that is neither a regex literal nor the navigation test; cannot prove it skips gated URLs`
        )
      }
      continue
    }
    const hit = gatedUrls.find((url) => {
      matcher.lastIndex = 0
      return matcher.test(url)
    })
    if (hit) {
      problems.push(`${label}: runtime route ${matcher} matches gated URL ${hit}; gated responses must never be cached`)
    }
  }

  for (const {pattern, name} of UNROUTED_HANDLERS) {
    if (pattern.test(source)) {
      problems.push(`${label}: uses ${name}, which can answer gated requests outside any route this scan can test`)
    }
  }

  if (new RegExp(`["']?cacheName["']?\\s*:\\s*["']${RETIRED_CACHE}["']`).test(source)) {
    problems.push(`${label}: declares the retired "${RETIRED_CACHE}" cache`)
  }

  if (requirePurgeImport) {
    const escaped = PURGE_SCRIPT.replace(/[.*+?^${}()|[\]\\]/g, '\\$&')
    if (!new RegExp(`importScripts\\(\\s*["']${escaped}["']\\s*\\)`).test(source)) {
      problems.push(`${label}: does not importScripts("${PURGE_SCRIPT}"); returning visitors keep the retired "${RETIRED_CACHE}" cache`)
    }
  }
  return problems
}

/** The string literals of a comma-separated argument list, or null when any argument is not one. */
function literalArguments(argumentText) {
  const parts = argumentText.split(',').map((part) => part.trim()).filter(Boolean)
  const literals = parts.map((part) => /^(["'])([^"'\\]*)\1$/.exec(part)?.[2])
  return literals.every((value) => value !== undefined) ? literals : null
}

/**
 * Every script a worker loads: each `importScripts(...)` target, and each Workbox `define` dependency
 * other than the Workbox runtime chunk. A dynamic `importScripts(<expression>)` outside the Workbox
 * loader is a problem, because no scan can tell what it loads.
 */
export function workerImports(source, label = 'sw.js') {
  const imports = []
  const problems = []
  const loaderAt = source.search(WORKBOX_LOADER_MARKER)
  const moduleAt = source.search(/\bdefine\(\s*\[/)
  for (const match of source.matchAll(/importScripts\(([^)]*)\)/g)) {
    const literals = literalArguments(match[1])
    if (literals) {
      imports.push(...literals)
      continue
    }
    const insideLoader = loaderAt >= 0 && moduleAt > loaderAt && match.index > loaderAt && match.index < moduleAt
    if (!insideLoader) {
      problems.push(`${label}: importScripts(${match[1].slice(0, 60)}) loads a script this scan cannot name`)
    }
  }
  for (const match of source.matchAll(/define\(\[([^\]]*)\]/g)) {
    const dependencies = literalArguments(match[1])
    if (!dependencies) {
      problems.push(`${label}: a define() dependency list this scan cannot read`)
      continue
    }
    imports.push(...dependencies.filter((dependency) => !WORKBOX_RUNTIME_DEPENDENCY.test(dependency)).map((dependency) => `${dependency}.js`))
  }
  return {imports, problems}
}

/** Gated URLs listed in the worker's precache manifest. A precached gated response replays forever. */
export function precachedGatedUrls(source, {gatedUrls, siteUrl}) {
  const manifest = /precacheAndRoute\(\[(.*?)\]\s*,/s.exec(source)?.[1] ?? ''
  const gated = new Set(gatedUrls.map((url) => url.split(/[?#]/)[0]))
  return [...manifest.matchAll(/["']?url["']?\s*:\s*["']([^"']+)["']/g)].map((match) => new URL(match[1], `${siteUrl}/`).href.split(/[?#]/)[0]).filter((
    url
  ) => gated.has(url))
}

// ── Behavioral inspection of the generated worker ────────────────────────
//
// Text alone cannot tell what a function matcher such as `({request}) => request.mode === 'navigate'`
// matches. inspectWorker() therefore RUNS the generated sw.js in a sandbox: `self.define` is set
// before the script runs, so the Workbox AMD loader is skipped and the module callback receives a
// recording stand-in for the Workbox runtime. Every registerRoute, strategy, plugin and precache
// entry is captured as a value, and verifyInspectedWorker() asks the captured routes real
// questions: which route answers a navigation, and which routes answer a gated URL.

const STRATEGIES = ['NetworkOnly', 'NetworkFirst', 'CacheFirst', 'CacheOnly', 'StaleWhileRevalidate']
const PLUGINS = [
  'PrecacheFallbackPlugin',
  'ExpirationPlugin',
  'CacheableResponsePlugin',
  'BroadcastUpdatePlugin',
  'RangeRequestsPlugin',
  'BackgroundSyncPlugin'
]
// Workbox calls that change no route and serve nothing.
const NEUTRAL_CALLS = ['cleanupOutdatedCaches', 'clientsClaim', 'skipWaiting']
export const OFFLINE_PATH = '/offline'

/**
 * Runs a generated worker against a recording Workbox stand-in and returns what it registered.
 *
 * Every textual `registerRoute(` call site is first renamed to a numbered `__registerRouteN(`, and
 * each N must run exactly once. A site that runs twice (a helper called twice), never (deferred to a
 * promise or a listener, or behind a condition), or a `registerRoute` reached any other way (a
 * computed name such as `e["regis" + "terRoute"]`) is therefore visible, rather than balancing a
 * plain count.
 */
export function inspectWorker(source, {siteUrl}) {
  let sites = 0
  const instrumented = source.replace(/registerRoute\(/g, () => `__registerRoute${sites++}(`)
  const record = {routes: [], precache: [], forbidden: [], unknown: [], listeners: [], siteRuns: new Array(sites).fill(0)}
  // The stand-in has a null prototype, and the inspection is NOT a security boundary: `node:vm` shares
  // host objects (URL, Promise, closures), so code in the worker can reach the build process. That is
  // acceptable only because the input is this repo's own workbox-build output. Never point this at
  // untrusted code.
  const workbox = Object.assign(Object.create(null), {
    precacheAndRoute: (entries) => record.precache.push(...entries),
    setDefaultHandler: () => record.forbidden.push('setDefaultHandler'),
    setCatchHandler: () => record.forbidden.push('setCatchHandler'),
    createHandlerBoundToURL: () => record.forbidden.push('createHandlerBoundToURL'),
    NavigationRoute: class {
      constructor() {
        record.forbidden.push('NavigationRoute')
      }
    }
  })
  for (const name of NEUTRAL_CALLS) {
    workbox[name] = () => {}
  }
  for (const name of [...STRATEGIES, ...PLUGINS]) {
    workbox[name] = class {
      constructor(options = {}) {
        this.kind = name
        this.options = options
      }
    }
  }
  const recorder = new Proxy(workbox, {
    get(target, key) {
      const site = typeof key === 'string' ? /^__registerRoute(\d+)$/.exec(key) : null
      if (site) {
        const index = Number(site[1])
        return (matcher, handler, method) => {
          record.siteRuns[index] = (record.siteRuns[index] ?? 0) + 1
          record.routes.push({matcher, handler, method, site: index})
        }
      }
      if (key === 'registerRoute') {
        record.forbidden.push('registerRoute reached by a computed name')
        return () => {}
      }
      if (typeof key === 'string' && !(key in target)) {
        record.unknown.push(key)
        return () => {}
      }
      return target[key]
    }
  })
  const sandbox = {
    importScripts: () => {},
    skipWaiting: () => {},
    // The generated entry worker registers no listener of its own (Workbox's live in its runtime
    // chunk, and the purge's in the imported script). Any listener here is recorded and fails: one
    // could register a route, or answer a request, after this inspection has finished.
    addEventListener: (type) => record.listeners.push(String(type)),
    clients: {claim: () => {}},
    caches: {delete: () => Promise.resolve(true)},
    location: new URL('/sw.js', `${siteUrl}/`),
    URL,
    Promise,
    console: {log: () => {}, warn: () => {}, error: () => {}}
  }
  sandbox.self = sandbox
  sandbox.define = (_dependencies, factory) => factory(recorder)
  runInNewContext(instrumented, sandbox, {timeout: 2000})
  return record
}

// A request with only the properties this check models. Reading any other property throws, so a
// matcher that depends on, say, `request.headers` or `request.cache` lands in routeMatches' catch and
// counts as matching everything, rather than silently answering false.
const MODELLED_REQUEST_KEYS = new Set(['url', 'mode', 'method', 'destination'])
function modelledObject(fields, keys, name) {
  const refuse = (key) => {
    if (typeof key === 'string' && !keys.has(key)) {
      throw new Error(`the inspection does not model ${name}.${key}`)
    }
  }
  return new Proxy(fields, {
    get(target, key) {
      refuse(key)
      return target[key]
    },
    has(target, key) {
      refuse(key)
      return key in target
    },
    ownKeys() {
      throw new Error(`the inspection does not model enumerating ${name}`)
    }
  })
}
const modelledRequest = (fields) => modelledObject(fields, MODELLED_REQUEST_KEYS, 'request')

function routeMatches(route, url, mode, siteOrigin) {
  const target = new URL(url)
  if (route.matcher instanceof RegExp || Object.prototype.toString.call(route.matcher) === '[object RegExp]') {
    route.matcher.lastIndex = 0
    return route.matcher.test(target.href)
  }
  if (typeof route.matcher !== 'function') {
    return true // an unknown matcher shape is assumed to match everything
  }
  try {
    const request = modelledRequest({url: target.href, mode, method: 'GET', destination: mode === 'navigate' ? 'document' : ''})
    const event = modelledObject({request}, new Set(['request']), 'event')
    return Boolean(route.matcher({url: target, request, sameOrigin: target.origin === siteOrigin, event}))
  } catch {
    return true // a matcher that throws on a plain request is assumed to match it
  }
}

/** True when the handler is NetworkOnly whose only plugin falls back to the precached /offline. */
function isOfflineFallbackNetworkOnly(handler, siteUrl) {
  if (!handler || handler.kind !== 'NetworkOnly') {
    return false
  }
  // `plugins` is the only option allowed. Any other option can reintroduce a cache: for example
  // `fetchOptions: {cache: 'force-cache'}` lets a "NetworkOnly" request be answered from the
  // browser HTTP cache, and `matchOptions` or `cacheName` signal intent to read a cache.
  // Own keys of every kind (Reflect.ownKeys sees non-enumerable and symbol keys), and a plain object
  // of the sandbox realm (a prototype chain could carry an inherited fetchOptions Workbox would read).
  const options = handler.options ?? {}
  const prototype = Object.getPrototypeOf(options)
  if ((prototype !== null && Object.getPrototypeOf(prototype) !== null) || Reflect.ownKeys(options).some((key) => key !== 'plugins')) {
    return false
  }
  const plugins = handler.options?.plugins ?? []
  if (plugins.length === 0) {
    return true
  }
  return plugins.length === 1 && plugins[0]?.kind === 'PrecacheFallbackPlugin' &&
    new URL(String(plugins[0].options?.fallbackURL ?? ''), `${siteUrl}/`).pathname === OFFLINE_PATH
}

/** A precache entry that is an HTML document: `/`, a `.html` file, or a path with no extension. */
function isDocumentEntry(entry, siteUrl) {
  const url = typeof entry === 'string' ? entry : entry?.url
  const path = new URL(String(url), `${siteUrl}/`).pathname
  return path.endsWith('/') || path.endsWith('.html') || !/\.[a-z0-9]+$/i.test(path)
}

/**
 * Judges an inspected worker. Rules (atlas decision 0160, PR 0b; openspec/specs/client-privacy):
 * - navigations are NetworkOnly, and the only allowed fallback serves the precached /offline;
 * - /offline is precached and no other HTML document is;
 * - every route that answers a gated URL is NetworkOnly (nothing cached), with at most that fallback;
 * - no default handler, catch handler or NavigationRoute, and no Workbox API this check cannot model.
 */
export function verifyInspectedWorker(record, {gatedUrls, siteUrl, label = '/sw.js'}) {
  const problems = []
  const siteOrigin = new URL(siteUrl).origin
  for (const name of record.forbidden) {
    problems.push(`${label}: uses ${name}, which can serve a navigation or gated request outside the NetworkOnly route`)
  }
  // Every registerRoute call site in the source must have run during the inspection. A route
  // registered later (in a promise callback, an event listener, or behind a condition) is a route
  // this check never judged.
  record.siteRuns.forEach((runs, index) => {
    if (runs !== 1) {
      problems.push(
        `${label}: registerRoute call site ${index} ran ${runs} time(s) while the worker was inspected; each call site must run exactly once, or its routes cannot be judged`
      )
    }
  })
  for (const type of [...new Set(record.listeners)]) {
    problems.push(`${label}: registers a '${type}' listener in the entry worker; a listener can register routes or answer requests after inspection`)
  }
  for (const name of [...new Set(record.unknown)]) {
    problems.push(`${label}: uses Workbox ${name}, which this check does not model; teach scripts/lib/sw-privacy.mjs about it first`)
  }

  const documents = record.precache.filter((entry) => isDocumentEntry(entry, siteUrl)).map((entry) =>
    new URL(String(typeof entry === 'string' ? entry : entry.url), `${siteUrl}/`).pathname
  )
  if (!documents.includes(OFFLINE_PATH)) {
    problems.push(`${label}: the data-free ${OFFLINE_PATH} page is not precached; an offline navigation would have nothing to show`)
  }
  for (const path of documents.filter((path) => path !== OFFLINE_PATH)) {
    problems.push(`${label}: precaches the HTML document ${path}; a precached document answers navigations before the NetworkOnly route`)
  }

  const fallbackRoutes = record.routes.filter((route) => (route.handler?.options?.plugins ?? []).some((plugin) => plugin?.kind === 'PrecacheFallbackPlugin'))
  for (const route of fallbackRoutes) {
    if (!isOfflineFallbackNetworkOnly(route.handler, siteUrl)) {
      problems.push(`${label}: a PrecacheFallbackPlugin is not the single plugin of a NetworkOnly route falling back to ${OFFLINE_PATH}`)
    }
  }
  if (fallbackRoutes.length > 1) {
    problems.push(`${label}: ${fallbackRoutes.length} routes carry a precache fallback; exactly one navigation fallback is allowed`)
  }

  for (const path of ['/', '/privacy', OFFLINE_PATH, '/no-such-page']) {
    const url = new URL(path, `${siteUrl}/`).href
    const first = record.routes.find((route) => routeMatches(route, url, 'navigate', siteOrigin))
    if (!first) {
      problems.push(`${label}: no route answers a navigation to ${path}; navigations must be NetworkOnly with the ${OFFLINE_PATH} fallback`)
    } else if (!isOfflineFallbackNetworkOnly(first.handler, siteUrl) || (first.handler.options?.plugins ?? []).length !== 1) {
      problems.push(
        `${label}: a navigation to ${path} is answered by ${first.handler?.kind ?? 'an unknown handler'}, not NetworkOnly with the ${OFFLINE_PATH} fallback`
      )
    }
  }

  for (const url of gatedUrls) {
    for (const mode of ['cors', 'no-cors', 'navigate']) {
      for (const route of record.routes.filter((candidate) => routeMatches(candidate, url, mode, siteOrigin))) {
        if (!isOfflineFallbackNetworkOnly(route.handler, siteUrl)) {
          problems.push(`${label}: a ${route.handler?.kind ?? 'unknown'} route answers gated URL ${url} (${mode}); gated responses must never be cached`)
        }
      }
    }
  }
  return [...new Set(problems)]
}

/**
 * Scans the whole worker: the entry script, its precache manifest, and every script it imports,
 * recursively. `readWorkerFile(path)` returns the source of a site-absolute path, or null when the
 * file does not exist.
 *
 * @returns {string[]} problems; empty when the tree is clean
 */
export function scanWorkerTree({entry = '/sw.js', readWorkerFile, gatedUrls, siteUrl}) {
  const problems = []
  const visited = new Set()
  const queue = [{path: entry, isEntry: true}]
  while (queue.length > 0) {
    const {path, isEntry} = queue.shift()
    if (visited.has(path)) {
      continue
    }
    visited.add(path)
    const source = readWorkerFile(path)
    if (source === null) {
      problems.push(`${path} is imported by the worker but missing; the import would fail the worker install`)
      continue
    }
    let matchersInspected = false
    if (isEntry) {
      try {
        problems.push(...verifyInspectedWorker(inspectWorker(source, {siteUrl}), {gatedUrls, siteUrl, label: path}))
        matchersInspected = true
      } catch (error) {
        problems.push(`${path}: could not be run for inspection (${error instanceof Error ? error.message : String(error)}); its routes cannot be verified`)
      }
    }
    problems.push(...scanWorkerSource(source, {gatedUrls, requirePurgeImport: isEntry, label: path, matchersInspected}))
    if (isEntry) {
      for (const url of precachedGatedUrls(source, {gatedUrls, siteUrl})) {
        problems.push(`${path}: precaches gated URL ${url}; a precached gated response replays until the next deploy`)
      }
    }
    const {imports, problems: importProblems} = workerImports(source, path)
    problems.push(...importProblems)
    for (const target of imports) {
      queue.push({path: new URL(target, `${siteUrl}${path}`).pathname, isEntry: false})
    }
  }
  return problems
}

/**
 * Runs the purge script in a sandboxed service-worker scope and checks what it DOES, not what it
 * contains: it must register exactly one `activate` listener, that listener must delete the
 * retired cache inside `waitUntil`, and activation must still settle when the delete rejects. A
 * string match on the source passed a script that only mentioned the cache name in a comment.
 *
 * @returns {Promise<string[]>} problems; empty when the purge behaves
 */
export async function verifyPurgeScript(source, retiredCache = RETIRED_CACHE) {
  const problems = []

  async function activateWith(deleteImpl) {
    const listeners = []
    const deleted = []
    const sandbox = {
      self: {addEventListener: (type, listener) => listeners.push({type, listener})},
      caches: {
        delete: (name) => {
          deleted.push(name)
          const result = deleteImpl(name)
          // Observe the promise on a side branch: a purge that ignores a rejected delete must be
          // reported as a problem, not crash the caller with an unhandled rejection.
          result.catch(() => {})
          return result
        }
      },
      Promise
    }
    runInNewContext(source, sandbox)
    // Held on an object so the callback's assignment is visible to the type checker.
    /** @type {{pending: Promise<unknown> | null}} */
    const activation = {pending: null}
    for (const {type, listener} of listeners) {
      if (type === 'activate') {
        listener({waitUntil: (promise) => (activation.pending = promise)})
      }
    }
    return {listeners, deleted, pending: activation.pending}
  }

  let run
  try {
    run = await activateWith(() => Promise.resolve(true))
  } catch (error) {
    return [`purge script throws when evaluated: ${error instanceof Error ? error.message : String(error)}`]
  }
  const types = run.listeners.map(({type}) => type)
  if (types.length !== 1 || types[0] !== 'activate') {
    problems.push(`purge script must register exactly one 'activate' listener; it registered [${types.join(', ')}]`)
  }
  if (!run.pending) {
    problems.push('purge activate listener does not call event.waitUntil')
  } else {
    await Promise.resolve(run.pending)
  }
  if (!run.deleted.includes(retiredCache)) {
    problems.push(`purge activate listener does not delete the "${retiredCache}" cache`)
  }

  try {
    const failing = await activateWith(() => Promise.reject(new Error('quota')))
    await Promise.resolve(failing.pending)
  } catch {
    problems.push('purge activation rejects when the cache delete rejects; the new worker would fail to activate')
  }
  return problems
}
