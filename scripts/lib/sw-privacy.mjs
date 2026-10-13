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
import {types} from 'node:util'
import {createContext, runInContext, runInNewContext} from 'node:vm'
import {CLOUDFRONT_BASE, ENDPOINTS, LLM_CONTENT_PATHS, SITE_URL} from '@j0nathan-ll0yd/portal-contract/constants'
import {FEED_ARTIFACTS} from '../../functions/_lib/feed-artifacts.ts'
import {LLMS_ARTIFACTS, LLMS_TXT_PATH} from '../../functions/_lib/llms-artifacts.ts'

/**
 * Runtime caches a retired route wrote, deleted on activate by the purge script and on every page
 * load by public/js/sw-register.js. `live-data` held CloudFront JSON under a NetworkFirst route.
 * `local-images` held whatever its unanchored /\/images\/(books|theatre)\// regex matched, and a
 * regex tests the whole URL: /feed.json?preview=/images/books/ matched and cached a gated feed.
 */
export const RETIRED_CACHES = Object.freeze(['live-data', 'local-images'])
export const PURGE_SCRIPT = '/js/sw-purge.js'

/**
 * The image routes' pinned shapes (scripts/check-sw-precache.mjs asserts the built worker carries
 * exactly these). Each ends in ONE file-name segment: a letter or digit, then letters, digits, `.`,
 * `_` or `-`. Every mirror file under public/images/books and public/images/theatre matches it
 * (tests/unit/sw-privacy.test.ts reads them), and no `%`, `/` or `\` can, so an encoded slash or a
 * dot-segment escape never reaches a cache.
 */
export const IMAGE_FILE_NAME_SOURCE = '[A-Za-z0-9][A-Za-z0-9._-]*'
export const LOCAL_IMAGE_PATH_SOURCE = `^\\/images\\/(books|theatre)\\/${IMAGE_FILE_NAME_SOURCE}$`
/** The CloudFront fallback route's source, as `new RegExp` builds it from the escaped host. */
export function cloudfrontImageUrlSource(cloudfrontBase) {
  const host = new URL(cloudfrontBase).host.replace(/[.*+?^${}()|[\]\\]/g, '\\$&')
  return new RegExp(`^https://${host}/images/(books|theatre)/${IMAGE_FILE_NAME_SOURCE}$`).source
}

/**
 * Query strings and fragments appended to every gated URL. A route must skip a gated pathname
 * whatever follows it, so the probes carry the shapes that fooled a whole-URL regex (an image path
 * in a query value, a bare query, a fragment) and generic ones that name no route at all.
 */
export const GATED_URL_SUFFIXES = Object.freeze([
  '?_poll=1',
  '?v=1',
  '?a=1&b=2',
  '?preview=/images/books/',
  '?x=/images/theatre/cover.avif',
  '?/images/books/',
  '?q=https://example.com/images/',
  '#x',
  '#/images/books/',
  '?a=1#/images/theatre/'
])

/**
 * Every URL a route matcher must NOT match: each CloudFront `.json` endpoint and each site-origin
 * gated path, bare and with every suffix in GATED_URL_SUFFIXES. A route that excludes `?_poll=1`, or
 * that a query value can steer, still fails.
 */
export function gatedProbeUrls({cloudfrontBase, endpointPaths, siteUrl, siteGatedPaths, originUrls = []}) {
  const bases = [
    ...endpointPaths.filter((path) => path.endsWith('.json')).map((path) => `${cloudfrontBase}${path}`),
    ...siteGatedPaths.map((path) => `${siteUrl}${path}`),
    ...originUrls
  ]
  return bases.flatMap((base) => [base, ...GATED_URL_SUFFIXES.map((suffix) => `${base}${suffix}`)])
}

/**
 * The production probe set, derived from the same registries the proxy routes and the client read:
 * every CloudFront export, the five site-origin gated routes, and the CloudFront origin of each of
 * those five (the proxy's upstream, also published as a dataset distribution).
 */
export function siteGatedProbeUrls() {
  return gatedProbeUrls({
    cloudfrontBase: CLOUDFRONT_BASE,
    endpointPaths: Object.values(ENDPOINTS),
    siteUrl: SITE_URL,
    siteGatedPaths: [LLMS_TXT_PATH, LLM_CONTENT_PATHS.llmsFull, LLM_CONTENT_PATHS.indexMarkdown, ...FEED_ARTIFACTS.map((artifact) => artifact.path)],
    originUrls: [...LLMS_ARTIFACTS, ...FEED_ARTIFACTS].map((artifact) => artifact.originUrl)
  })
}

/** A gated URL with its query and fragment removed. */
const bareUrl = (url) => url.split(/[?#]/)[0]

/**
 * Probe URLs built from one route's own matcher: each gated base URL with the route's literal text
 * in a query value, as a bare query, and as a fragment. A whole-URL regex that a query value can
 * satisfy matches at least one of these, whatever image path it names.
 */
export function routeDerivedProbeUrls(gatedUrls, matcherRegex) {
  const samples = regexSamples(matcherRegex)
  const bases = [...new Set(gatedUrls.map(bareUrl))]
  return bases.flatMap((base) => samples.flatMap((sample) => [`${base}?q=${sample}`, `${base}?${sample}`, `${base}#${sample}`, `${base}?q=${sample}x.avif`]))
}

/**
 * Path escapes appended to a route's own prefix, with `{t}` standing for a gated file name. A
 * browser keeps each of these inside the route's prefix (it decodes neither `%2F` nor `%5C`, and a
 * literal backslash or `..` is resolved before any route sees the URL), but an origin that decodes
 * `%2F` or `%5C` and then resolves dot segments serves the gated file for it. A route anchored on a
 * single file-name segment matches none of them.
 */
export const TRAVERSAL_SUFFIXES = Object.freeze([
  '..%2F..%2F{t}',
  '..%2f..%2f..%2f{t}',
  '%2E%2E%2F%2E%2E%2F{t}',
  '.%2E%2F.%2E%2F{t}',
  '%2e%2e/%2e%2e/{t}',
  '..%5C..%5C{t}',
  '..%5c..%5c..%5c{t}',
  '%2E%2E%5C%2E%2E%5C{t}',
  '..\\..\\{t}',
  'x%2F..%2F..%2F..%2F{t}',
  '..%252F..%252F{t}',
  'x/..%2F..%2F..%2F{t}',
  '%2F{t}',
  // An origin that strips `;` parameters, or decodes `%3F`, `%23` or `%00` before it splits the
  // path, serves the gated file for these, whatever image extension a route demands.
  ...['avif', 'webp', 'png', 'jpg', 'jpeg', 'gif', 'svg'].flatMap((extension) => [
    `..%2F..%2F{t};x.${extension}`,
    `..%2F..%2F{t}%3F.${extension}`,
    `..%2F..%2F{t}%23.${extension}`,
    `..%2F..%2F{t}%00.${extension}`
  ])
])

/**
 * Probe URLs that escape one route's own prefix: each literal prefix the route is built around
 * (`regexSamples`), followed by every TRAVERSAL_SUFFIXES form aimed at every gated file name. A
 * pathname sample is placed on `origin`. Each URL is returned as the browser normalizes it.
 */
export function traversalProbeUrls(gatedUrls, matcherRegex, origin) {
  const targets = [...new Set(gatedUrls.map((url) => new URL(url).pathname.replace(/^\/+/, '')).filter(Boolean))]
  const urls = regexSamples(matcherRegex).flatMap((sample) => {
    const base = sample.startsWith('/') ? `${origin}${sample}` : sample
    return /^https?:\/\/[^/]+\//.test(base) ? TRAVERSAL_SUFFIXES.flatMap((suffix) => targets.map((target) => `${base}${suffix.replace('{t}', target)}`)) : []
  })
  return [...new Set(urls.map((url) => new URL(url).href))]
}

/**
 * True when a regex ends in an unescaped `$`, so nothing may follow what it describes. Strict on
 * purpose: an equivalent anchor inside a group (`(?:x$)`, `(a|b$)`) is refused, never passed.
 */
function isEndAnchored(regex) {
  const trailing = /(\\*)\$$/.exec(regex.source)
  return Boolean(trailing) && trailing[1].length % 2 === 0
}

// The only regex shape a route may take: `^`, then a LITERAL path -- plain characters, escaped
// `/ . - :`, and groups of plain alternatives such as `(books|theatre)` -- then `/`, exactly ONE
// file-name segment and `$`. No class, quantifier or `.` may sit anywhere else. An open or
// suffix-matched tail (`.+\.avif$`, `[^/]+\.(avif|webp)$`) passes an end anchor and every probe that
// ends in a gated file name, yet carries `..%2F..%2Ffeed.json;.avif` to an origin that strips `;`
// parameters. Probes cannot prove a tail safe; this structure can.
const LITERAL_PATH_HEAD = /^\^(?:[A-Za-z0-9:_-]|\\[/.:-]|\((?:\?:)?[A-Za-z0-9_-]+(?:\|[A-Za-z0-9_-]+)*\))*$/
function endsInOneFileName(regex) {
  const tail = `\\/${IMAGE_FILE_NAME_SOURCE}$`
  return regex.source.endsWith(tail) && LITERAL_PATH_HEAD.test(regex.source.slice(0, -tail.length))
}

/** Literal strings a regex is built around: escapes undone, each alternative of a group expanded. */
function regexSamples(regex) {
  let variants = [regex.source.replace(/^\^/, '').replace(/\$$/, '')]
  // Expand non-nested groups, one at a time, capped so a pathological regex cannot explode.
  for (let round = 0; round < 4; round++) {
    const next = []
    let expanded = false
    for (const variant of variants) {
      const group = /\((?:\?:)?([^()]*)\)/.exec(variant)
      if (!group) {
        next.push(variant)
        continue
      }
      expanded = true
      for (const alternative of group[1].split('|')) {
        next.push(variant.slice(0, group.index) + alternative + variant.slice(group.index + group[0].length))
      }
    }
    variants = next.slice(0, 16)
    if (!expanded) {
      break
    }
  }
  return [
    ...new Set(
      variants.map((variant) =>
        variant.replace(/\[[^\]]*\][*+?]?/g, '').replace(/(^|[^\\])\.[*+?]?/g, '$1').replace(/\\([^dwsbDWSBnrtfv0-9])/g, '$1').replace(
          /\\[dwsbDWSBnrtfv0-9]/g,
          ''
        ).replace(/[\^$*+?{}|]/g, '')
      ).filter(Boolean)
    )
  ]
}

/**
 * The literal text an anchored regex requires at the start of its input, or null when the regex
 * is not anchored with `^`, carries a top-level alternation (whose other branch would not be
 * anchored), or uses the `g`, `y`, `m` or `i` flag. The `i` flag is refused outright: with `u` or
 * `v`, Unicode case folding maps characters such as U+017F to `s`, so no lower-casing of the
 * prefix models what it matches. Lower-cased all the same, as a second line. A regex whose prefix is `https://host/images/` can only match URLs whose origin
 * is that host and whose pathname starts with `/images/`: no query string or fragment changes that.
 */
export function anchoredLiteralPrefix(regex) {
  const source = regex.source
  if (/[gimy]/.test(regex.flags) || source[0] !== '^') {
    return null
  }
  let depth = 0
  let inClass = false
  for (let i = 0; i < source.length; i++) {
    const ch = source[i]
    if (ch === '\\') {
      i++
    } else if (inClass) {
      inClass = ch !== ']'
    } else if (ch === '[') {
      inClass = true
    } else if (ch === '(') {
      depth++
    } else if (ch === ')') {
      depth--
    } else if (ch === '|' && depth === 0) {
      return null
    }
  }
  let prefix = ''
  for (let i = 1; i < source.length;) {
    let literal
    let width
    if (source[i] === '\\') {
      if (/[A-Za-z0-9]/.test(source[i + 1] ?? 'x')) {
        break // a class escape (\d, \w) or a backreference: not a literal
      }
      literal = source[i + 1]
      width = 2
    } else if ('.*+?()[]{}|^$'.includes(source[i])) {
      break
    } else {
      literal = source[i]
      width = 1
    }
    const quantifier = source[i + width]
    if (quantifier === '*' || quantifier === '?' || quantifier === '{') {
      break // the character may be absent, so it is not required
    }
    prefix += literal
    if (quantifier === '+') {
      break
    }
    i += width
  }
  return prefix.toLowerCase()
}

/** True when a required prefix and a gated path can describe the same resource, either way round. */
const overlaps = (prefix, target) => target.toLowerCase().startsWith(prefix) || prefix.startsWith(target.toLowerCase())

/**
 * Problems with a whole-URL regex matcher. It must classify by origin and pathname: anchored on a
 * literal `https://<host>/` (with any literal path after it), and that prefix must not cover a gated
 * URL's origin and pathname.
 */
export function urlRegexProblems(regex, gatedUrls, label) {
  const prefix = anchoredLiteralPrefix(regex)
  if (prefix === null || !/^https?:\/\/[^/?#\s]+\//.test(prefix)) {
    return [
      `${label}: runtime route ${regex} is not anchored on a literal origin and path (^https://host/...); a query string or fragment could steer it onto a gated URL`
    ]
  }
  // Compared by PATH against every gated pathname, whatever its origin: the gated routes also run on
  // hosts the probe set does not name (www, a *.pages.dev preview), and a route anchored on one of
  // those must not cover them either.
  const origin = new URL(prefix).origin
  const pathPrefix = prefix.slice(origin.length)
  if (pathPrefix === '/') {
    return [
      `${label}: runtime route ${regex} is anchored on the bare origin ${origin}/ with no literal path segment; the gated routes answer on hosts the guard cannot list (www, a *.pages.dev preview), so a route must also name a literal path that is not gated (^${origin}/<segment>/...)`
    ]
  }
  const problems = []
  const exact = gatedUrls.map((url) => new URL(url)).find((url) => overlaps(prefix, `${url.origin}${url.pathname}`))
  const byPath = exact ? null : gatedUrls.map((url) => new URL(url)).find((url) => overlaps(pathPrefix, url.pathname))
  if (exact) {
    problems.push(`${label}: runtime route ${regex} covers gated URL ${exact.origin}${exact.pathname}; gated responses must never be cached`)
  } else if (byPath) {
    problems.push(
      `${label}: runtime route ${regex} has the literal path prefix ${pathPrefix}, which covers the gated path ${byPath.pathname}; the gated routes answer on every host, so a route on ${origin} must not cover it either`
    )
  }
  if (!isEndAnchored(regex)) {
    problems.push(
      `${label}: runtime route ${regex} is not end-anchored ($); anchor it on a file-name shape so no further path, query or encoded escape can follow`
    )
  } else if (!endsInOneFileName(regex)) {
    problems.push(`${label}: ${fileNameShapeMessage(regex)}`)
  }
  return problems
}

/**
 * Problems with the pathname regex of a same-origin pathname matcher. It must be anchored on a
 * literal path (`^/segment...`), and that prefix must not cover the pathname of any gated URL. Every
 * gated pathname is checked, CloudFront's included, which is stricter than the same-origin test.
 */
export function pathRegexProblems(regex, gatedUrls, label) {
  const prefix = anchoredLiteralPrefix(regex)
  if (prefix === null || !/^\/[^/?#]/.test(prefix)) {
    return [`${label}: runtime route pathname test ${regex} is not anchored on a literal path (^/segment...)`]
  }
  const problems = []
  const hit = gatedUrls.map((url) => new URL(url).pathname).find((pathname) => overlaps(prefix, pathname))
  if (hit) {
    problems.push(`${label}: runtime route pathname test ${regex} covers gated path ${hit}; gated responses must never be cached`)
  }
  if (!isEndAnchored(regex)) {
    problems.push(
      `${label}: runtime route pathname test ${regex} is not end-anchored ($); anchor it on a file-name shape so an encoded slash or dot segment cannot follow`
    )
  } else if (!endsInOneFileName(regex)) {
    problems.push(`${label}: ${fileNameShapeMessage(regex)}`)
  }
  return problems
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
  return readRegexLiteralSpan(source, start)?.regex ?? null
}

/** The regex literal at `start` and the offset just past it (after its flags), or null. */
function readRegexLiteralSpan(source, start) {
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
        return {regex: new RegExp(source.slice(start + 1, i), flags), end: i + 1 + flags.length}
      } catch {
        return null
      }
    }
  }
  return null
}

const IDENTIFIER = '[A-Za-z_$][\\w$]*'
const PATH_MATCHER_HEAD = new RegExp(
  `^\\(\\{\\s*(url|sameOrigin)\\s*(?::\\s*(${IDENTIFIER}))?\\s*,\\s*(url|sameOrigin)\\s*(?::\\s*(${IDENTIFIER}))?\\s*\\}\\)\\s*=>\\s*(${IDENTIFIER})\\s*&&\\s*`
)
const PATH_MATCHER_TAIL = new RegExp(`^\\.test\\(\\s*(${IDENTIFIER})\\.pathname\\s*\\)\\s*,`)

/**
 * The pathname regex of a same-origin pathname matcher at `start`, or null when the text there is
 * not exactly `({url, sameOrigin}) => sameOrigin && /<regex>/.test(url.pathname)`, in the form
 * generateSW emits it (minified, `({url:e,sameOrigin:s})=>s&&/.../.test(e.pathname)`, or readable),
 * followed by the argument-separating comma. Such a matcher classifies a request by its origin and
 * pathname only: no query string or fragment reaches the regex.
 */
export function sameOriginPathMatcherAt(source, start) {
  const head = PATH_MATCHER_HEAD.exec(source.slice(start))
  if (!head) {
    return null
  }
  // A repeated key leaves one binding undefined, which the checks below refuse.
  const bindings = {[head[1]]: head[2] ?? head[1], [head[3]]: head[4] ?? head[3]}
  if (bindings.url === bindings.sameOrigin || head[5] !== bindings.sameOrigin) {
    return null
  }
  const literal = readRegexLiteralSpan(source, start + head[0].length)
  if (!literal) {
    return null
  }
  const tail = PATH_MATCHER_TAIL.exec(source.slice(literal.end))
  return tail && tail[1] === bindings.url ? literal.regex : null
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
  // Every route must classify a request by origin and pathname, never by its query or fragment:
  // a whole-URL regex anchored on a literal origin and path, a same-origin pathname test, or the
  // navigation test (judged by inspectWorker/verifyInspectedWorker). Then every route is also
  // probed with the gated URLs, their query and fragment variants, and variants built from every
  // route's own regex text.
  const routes = []
  for (const start of routeStarts) {
    // A regex literal counts only when it IS the whole first argument: `/re/||(()=>!0)` is an
    // expression, not the literal.
    const span = readRegexLiteralSpan(source, start)
    const regex = span && /^\s*,/.test(source.slice(span.end)) ? span.regex : null
    if (regex) {
      routes.push({start, kind: 'url', regex})
      problems.push(...urlRegexProblems(regex, gatedUrls, label))
      continue
    }
    const pathRegex = sameOriginPathMatcherAt(source, start)
    if (pathRegex) {
      routes.push({start, kind: 'path', regex: pathRegex})
      problems.push(...pathRegexProblems(pathRegex, gatedUrls, label))
      continue
    }
    // The one other function matcher allowed is the navigation test, spelled exactly, in a worker
    // whose routes inspectWorker() has run and verifyInspectedWorker() has judged (the entry
    // sw.js). Any other function -- one that reads the query, reads event, sniffs the environment,
    // keeps state, or is chosen by an expression -- is refused, because no evaluation can prove
    // what it matches.
    if (!(matchersInspected && isNavigationMatcherAt(source, start))) {
      problems.push(
        `${label}: runtime route at offset ${start} has a matcher that is neither an anchored regex literal, a same-origin pathname test, nor the navigation test; cannot prove it skips gated URLs`
      )
    }
  }
  const probes = [...new Set([...gatedUrls, ...routes.flatMap((route) => routeDerivedProbeUrls(gatedUrls, route.regex))])]
  for (const {kind, regex} of routes) {
    const hit = probes.find((url) => {
      regex.lastIndex = 0
      return regex.test(kind === 'path' ? new URL(url).pathname : url)
    })
    if (hit) {
      problems.push(`${label}: runtime route ${regex} matches gated URL ${hit}; gated responses must never be cached`)
    }
    const escape = traversalProbeUrls(gatedUrls, regex, 'https://probe.invalid').find((url) => {
      regex.lastIndex = 0
      return regex.test(kind === 'path' ? new URL(url).pathname : url)
    })
    if (escape) {
      problems.push(`${label}: ${traversalMessage(regex, escape)}`)
    }
  }

  for (const {pattern, name} of UNROUTED_HANDLERS) {
    if (pattern.test(source)) {
      problems.push(`${label}: uses ${name}, which can answer gated requests outside any route this scan can test`)
    }
  }

  for (const retired of RETIRED_CACHES) {
    if (new RegExp(`["']?cacheName["']?\\s*:\\s*["']${retired}["']`).test(source)) {
      problems.push(`${label}: declares the retired "${retired}" cache`)
    }
  }

  if (requirePurgeImport) {
    const escaped = PURGE_SCRIPT.replace(/[.*+?^${}()|[\]\\]/g, '\\$&')
    if (!new RegExp(`importScripts\\(\\s*["']${escaped}["']\\s*\\)`).test(source)) {
      problems.push(`${label}: does not importScripts("${PURGE_SCRIPT}"); returning visitors keep the retired caches (${RETIRED_CACHES.join(', ')})`)
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
  const context = createContext(sandbox)
  // The sandbox realm's own Object.prototype, and its keys before the worker runs. Options objects
  // the worker builds must have exactly this prototype (or none), and the worker must not add keys
  // to it: a key planted there (say fetchOptions) would be inherited by every options object.
  record.objectPrototype = runInContext('Object.prototype', context)
  const builtInKeys = new Set(Reflect.ownKeys(record.objectPrototype))
  runInContext(instrumented, context, {timeout: 2000})
  record.prototypeAdditions = Reflect.ownKeys(record.objectPrototype).filter((key) => !builtInKeys.has(key)).map(String)
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
function isOfflineFallbackNetworkOnly(handler, siteUrl, realmPrototype) {
  if (!handler || handler.kind !== 'NetworkOnly') {
    return false
  }
  // `plugins` is the only option allowed. Any other option can reintroduce a cache: for example
  // `fetchOptions: {cache: 'force-cache'}` lets a "NetworkOnly" request be answered from the
  // browser HTTP cache, and `matchOptions` or `cacheName` signal intent to read a cache.
  // The options must be a plain object: not a Proxy (whose traps could answer any key), with exactly
  // the sandbox realm's Object.prototype or no prototype at all (any other chain could carry an
  // inherited fetchOptions Workbox would read), and no own key of any kind but plugins
  // (Reflect.ownKeys also sees non-enumerable and symbol keys). verifyInspectedWorker separately
  // fails a worker that adds keys to that Object.prototype.
  const options = handler.options ?? {}
  if (types.isProxy(options)) {
    return false
  }
  const prototype = Object.getPrototypeOf(options)
  if ((prototype !== null && prototype !== realmPrototype) || Reflect.ownKeys(options).some((key) => key !== 'plugins')) {
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
  for (const key of record.prototypeAdditions ?? []) {
    problems.push(`${label}: adds '${key}' to Object.prototype; every options object would inherit it`)
  }
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

  // The precache entries the worker REGISTERED, whatever shape the text took (a variable, string
  // entries, no options argument). A precached gated response replays until the next deploy.
  const gatedBases = new Set(gatedUrls.map(bareUrl))
  for (const entry of record.precache) {
    const url = new URL(String(typeof entry === 'string' ? entry : entry?.url), `${siteUrl}/`).href.split(/[?#]/)[0]
    if (gatedBases.has(url)) {
      problems.push(`${label}: precaches gated URL ${url}; a precached gated response replays until the next deploy`)
    }
  }

  const fallbackRoutes = record.routes.filter((route) => (route.handler?.options?.plugins ?? []).some((plugin) => plugin?.kind === 'PrecacheFallbackPlugin'))
  for (const route of fallbackRoutes) {
    if (!isOfflineFallbackNetworkOnly(route.handler, siteUrl, record.objectPrototype)) {
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
    } else if (!isOfflineFallbackNetworkOnly(first.handler, siteUrl, record.objectPrototype) || (first.handler.options?.plugins ?? []).length !== 1) {
      problems.push(
        `${label}: a navigation to ${path} is answered by ${first.handler?.kind ?? 'an unknown handler'}, not NetworkOnly with the ${OFFLINE_PATH} fallback`
      )
    }
  }

  // Every route must classify by origin and pathname (see scanWorkerSource), judged here on the
  // VALUES the worker registered: a RegExp by its source, a function by its own source text.
  const derivedProbes = []
  const escapeProbes = []
  for (const route of record.routes) {
    const matcher = route.matcher
    if (Object.prototype.toString.call(matcher) === '[object RegExp]') {
      problems.push(...urlRegexProblems(matcher, gatedUrls, label))
      derivedProbes.push(...routeDerivedProbeUrls(gatedUrls, matcher))
      escapeProbes.push(...traversalProbeUrls(gatedUrls, matcher, siteOrigin))
      continue
    }
    // The appended comma stands for the argument separator the text parsers require; any text
    // after the recognised shape (`|| true`, `&& url.search`) sits before it and fails the parse.
    const text = typeof matcher === 'function' ? `${Function.prototype.toString.call(matcher)},` : ''
    const pathRegex = sameOriginPathMatcherAt(text, 0)
    if (pathRegex) {
      problems.push(...pathRegexProblems(pathRegex, gatedUrls, label))
      derivedProbes.push(...routeDerivedProbeUrls(gatedUrls, pathRegex))
      escapeProbes.push(...traversalProbeUrls(gatedUrls, pathRegex, siteOrigin))
    } else if (!isNavigationMatcherAt(text, 0)) {
      problems.push(
        `${label}: a route matcher is neither an anchored RegExp, a same-origin pathname test, nor the navigation test; it may read the query string`
      )
    }
  }

  for (const url of new Set([...gatedUrls, ...derivedProbes])) {
    for (const mode of ['cors', 'no-cors', 'navigate']) {
      for (const route of record.routes.filter((candidate) => routeMatches(candidate, url, mode, siteOrigin))) {
        if (!isOfflineFallbackNetworkOnly(route.handler, siteUrl, record.objectPrototype)) {
          problems.push(`${label}: a ${route.handler?.kind ?? 'unknown'} route answers gated URL ${url} (${mode}); gated responses must never be cached`)
        }
      }
    }
  }
  for (const url of new Set(escapeProbes)) {
    for (const mode of ['cors', 'no-cors']) {
      for (const route of record.routes.filter((candidate) => routeMatches(candidate, url, mode, siteOrigin))) {
        if (!isOfflineFallbackNetworkOnly(route.handler, siteUrl, record.objectPrototype)) {
          problems.push(`${label}: a ${route.handler?.kind ?? 'unknown'} ${traversalMessage(route.matcher, url)} (${mode})`)
        }
      }
    }
  }
  return [...new Set(problems)]
}

/** The problem text for an end-anchored route whose tail is not one file-name segment. */
function fileNameShapeMessage(regex) {
  return `runtime route ${regex} does not end in a literal path and exactly one file-name segment (/${IMAGE_FILE_NAME_SOURCE}$); an open or suffix-matched tail can carry an encoded escape such as ..%2F..%2Ffeed.json;.avif`
}

/** The problem text for a route that accepts a path escape. */
function traversalMessage(matcher, url) {
  return `route ${matcher} accepts ${url}, which an origin that decodes %2F or %5C and resolves dot segments serves as a gated file; anchor the route on a file-name shape`
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
 * retired caches inside `waitUntil`, and activation must still settle when the delete rejects. A
 * string match on the source passed a script that only mentioned the cache name in a comment.
 *
 * @returns {Promise<string[]>} problems; empty when the purge behaves
 */
export async function verifyPurgeScript(source, retiredCaches = RETIRED_CACHES) {
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
  for (const retiredCache of retiredCaches) {
    if (!run.deleted.includes(retiredCache)) {
      problems.push(`purge activate listener does not delete the "${retiredCache}" cache`)
    }
  }

  try {
    const failing = await activateWith(() => Promise.reject(new Error('quota')))
    await Promise.resolve(failing.pending)
  } catch {
    problems.push('purge activation rejects when the cache delete rejects; the new worker would fail to activate')
  }
  return problems
}
