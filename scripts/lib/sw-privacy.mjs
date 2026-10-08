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
export function scanWorkerSource(source, {gatedUrls, requirePurgeImport = false, label = 'sw.js'}) {
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
      problems.push(`${label}: runtime route at offset ${start} has a matcher that is not a regex literal; cannot prove it skips gated URLs`)
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
    problems.push(...scanWorkerSource(source, {gatedUrls, requirePurgeImport: isEntry, label: path}))
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
