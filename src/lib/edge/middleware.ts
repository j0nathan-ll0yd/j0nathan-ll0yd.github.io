// The site middleware: content negotiation + response headers. It wraps every response
// the Worker builds (src/worker.ts). On Pages it was functions/_middleware.ts and ran on
// every path that public/_routes.json routed to Functions. Cloudflare applies `_headers`
// only to static-asset responses, so this middleware carries the same cross-cutting policy
// on Worker responses. The policy itself lives in ./security-headers.ts, which also writes
// `_headers` (atlas decision 0160, plan Step 3.3).

import {LLM_CONTENT_PATHS} from '@j0nathan-ll0yd/portal-contract/constants'
import {AGENT_PATHS, AI_CATALOG_MEDIA_TYPE, OPENAPI_MEDIA_TYPE} from './agent-paths.mjs'
import {LLMS_TXT_PATH} from './llms-artifacts'
import {NOT_FOUND_MARKDOWN} from './not-found-markdown.mjs'
import {SITEMAP_INDEX_PATH} from './site-paths'
import {LLM_OUTPUT_CACHE_POLICY, makeCloudfrontProxy} from './proxy'
import {BASE_SECURITY_HEADERS, CONTENT_USAGE, CSP, CSP_HEADERS, SITE_RUNTIME, SITE_RUNTIME_HEADER} from './security-headers'

// Re-exported: the CSP golden test and the middleware tests read them from here.
export { CONTENT_USAGE, CSP }

/**
 * Paths where this middleware sets a header beyond the shared policy. Each is a static file on
 * Workers, so wrangler.jsonc lists it in `run_worker_first`, or the static-asset plane would
 * answer it without these headers. tests/unit/worker-routing.test.ts pins that list.
 */
export const HEADER_OVERRIDE_PATHS = Object.freeze([
  '/',
  '/sw.js',
  '/version.json',
  '/.well-known/api-catalog',
  '/.well-known/webfinger',
  AGENT_PATHS.aiCatalog,
  AGENT_PATHS.openapi
])

export const LINK_HEADER = [
  `<${LLMS_TXT_PATH}>; rel="describedby"; type="text/plain"`,
  `<${AGENT_PATHS.apiCatalog}>; rel="api-catalog"`,
  `<${AGENT_PATHS.aiCatalog}>; rel="ai-catalog"`,
  `<${AGENT_PATHS.ard}>; rel="ard"`,
  `<${SITEMAP_INDEX_PATH}>; rel="sitemap"`,
  '</humans.txt>; rel="author"',
  '</feed.xml>; rel="alternate"; type="application/rss+xml"',
  '</feed.json>; rel="alternate"; type="application/feed+json"'
].join(', ')

// The request context src/worker.ts passes in. It keeps the shape of the Pages Function
// context, so the code below runs unchanged. Avoids pulling in @cloudflare/workers-types.
export interface MiddlewareContext {
  request: Request
  next(): Promise<Response>
  waitUntil(promise: Promise<unknown>): void
}

interface MediaRange {
  type: string
  subtype: string
  q: number
}

/** Parse an Accept header into media ranges with RFC 9110 q weights (default 1, clamped 0..1). */
function parseAccept(accept: string): MediaRange[] {
  const ranges: MediaRange[] = []
  for (const part of accept.split(',')) {
    const [range = '', ...params] = part.split(';')
    const media = range.trim().toLowerCase()
    const slash = media.indexOf('/')
    if (slash < 1) {
      continue
    }
    let q = 1
    for (const param of params) {
      const eq = param.indexOf('=')
      if (eq < 0 || param.slice(0, eq).trim().toLowerCase() !== 'q') {
        continue
      }
      const value = Number.parseFloat(param.slice(eq + 1))
      q = Number.isFinite(value) ? Math.min(Math.max(value, 0), 1) : 1
      break // the first q ends the media-type parameters (RFC 9110 12.4.2)
    }
    ranges.push({type: media.slice(0, slash), subtype: media.slice(slash + 1), q})
  }
  return ranges
}

/**
 * The ONE homepage negotiation decision: does this Accept value select the markdown
 * representation of `/` over the HTML one?
 *
 * text/markdown is eligible only when NAMED EXPLICITLY with q>0 -- no wildcard
 * range (full or `text/*`) ever selects markdown, and `text/markdown;q=0` is a
 * rejection, not a request. text/html competes with standard precedence (exact
 * `text/html`, then `text/*`, then the full wildcard). Markdown wins only on a
 * STRICTLY higher q: an equal-q tie serves HTML, the canonical representation
 * (openspec/specs/llms-txt/spec.md, "Markdown negotiation applies only to the
 * homepage and honors Accept q-values").
 */
export function prefersMarkdown(accept: string | null): boolean {
  if (!accept) {
    return false
  }
  const ranges = parseAccept(accept)

  let markdownQ = 0
  for (const range of ranges) {
    if (range.type === 'text' && range.subtype === 'markdown') {
      markdownQ = Math.max(markdownQ, range.q)
    }
  }
  if (markdownQ <= 0) {
    return false
  }

  let htmlQ = 0
  let htmlSpecificity = -1
  for (const range of ranges) {
    let specificity = -1
    if (range.type === 'text' && range.subtype === 'html') {
      specificity = 2
    } else if (range.type === 'text' && range.subtype === '*') {
      specificity = 1
    } else if (range.type === '*' && range.subtype === '*') {
      specificity = 0
    }
    if (specificity < 0 || specificity < htmlSpecificity) {
      continue
    }
    htmlQ = specificity > htmlSpecificity ? range.q : Math.max(htmlQ, range.q)
    htmlSpecificity = specificity
  }

  return markdownQ > htmlQ
}

// The negotiated homepage markdown IS the /llms-full.txt representation, served
// through the same proxy machinery as the explicit route (src/pages/llms-full.txt.ts):
// privacy gate, bounded retry, last-known-good fallback under the shared cache key,
// and the llm-outputs no-store cache policy. No independent fetch path exists here.
const serveLlmsFull = makeCloudfrontProxy({
  path: LLM_CONTENT_PATHS.llmsFull,
  contentType: 'text/markdown; charset=utf-8',
  cachePolicy: LLM_OUTPUT_CACHE_POLICY
})

// The markdown 404 body is generated at prebuild by scripts/generate-not-found.mjs from
// @j0nathan-ll0yd/copy (llm.notFound) and the contract paths. The import is one constant string:
// a copy change can fail the build, never this Worker's start.
export { NOT_FOUND_MARKDOWN }

/**
 * The markdown 404: the routed 404's headers (the asset plane's CORS header among them) with the
 * markdown body. Only the headers that describe the HTML body are replaced.
 */
function markdownNotFound(routed: Response): Response {
  const headers = new Headers(routed.headers)
  // The body-describing headers, and the cache-state headers of the 404 page the markdown replaces.
  for (const name of ['Content-Length', 'Content-Encoding', 'ETag', 'Last-Modified', 'CF-Cache-Status', 'Age']) {
    headers.delete(name)
  }
  headers.set('Content-Type', 'text/markdown; charset=utf-8')
  headers.set('Cache-Control', 'no-store')
  return new Response(NOT_FOUND_MARKDOWN, {status: 404, headers})
}

/** Merge `Accept` into Vary so every cache layer keys negotiated representations on it. */
function mergeVaryAccept(headers: Headers): void {
  const existing = headers.get('Vary')
  if (!existing) {
    headers.set('Vary', 'Accept')
    return
  }
  const tokens = existing.split(',').map((token) => token.trim().toLowerCase())
  if (!tokens.includes('accept') && !tokens.includes('*')) {
    headers.set('Vary', `${existing}, Accept`)
  }
}

export async function onRequest(context: MiddlewareContext): Promise<Response> {
  const {request} = context
  const url = new URL(request.url)

  // Markdown negotiation, HOMEPAGE ONLY (GET/HEAD), plus the 404 exception below.
  // Explicit artifact paths (/llms.txt, /llms-full.txt, /index.md), pages, API routes,
  // and feeds never negotiate: each keeps its own bytes and content type for every
  // Accept value.
  const safeMethod = request.method === 'GET' || request.method === 'HEAD'
  const wantsMarkdown = safeMethod && prefersMarkdown(request.headers.get('Accept'))
  const negotiated = url.pathname === '/' && wantsMarkdown

  const routed = negotiated
    ? await serveLlmsFull({request, waitUntil: (promise) => context.waitUntil(promise)})
    : await context.next()

  // The one exception to homepage-only negotiation: a 404 under the same markdown
  // decision answers with a short markdown body instead of the HTML 404 page. Status
  // stays 404; the body points at the documents an agent can read instead.
  const notFoundMarkdown = routed.status === 404 && wantsMarkdown
  const response = notFoundMarkdown ? markdownNotFound(routed) : routed
  const headers = new Headers(response.headers)

  // Security headers
  for (const [name, value] of [...CSP_HEADERS, ...BASE_SECURITY_HEADERS]) {
    headers.set(name, value)
  }
  // The platform marker: the one intended header difference from Pages (plan Steps 3.1 and 3.6).
  headers.set(SITE_RUNTIME_HEADER, SITE_RUNTIME)

  // sw.js and version.json must always revalidate so a new deploy is picked up
  // promptly: sw.js drives the update-check path in public/js/sw-register.js, and
  // version.json is the smoke check's freshness probe. Set here, not in
  // `_headers`, because these paths run the Worker (run_worker_first) and Cloudflare
  // does not apply that file to Worker responses. Modern Chromium already bypasses the HTTP cache for sw.js via
  // updateViaCache:'imports'; this covers older engines and version.json defensively.
  if (url.pathname === '/sw.js' || url.pathname === '/version.json') {
    headers.set('Cache-Control', 'max-age=0, no-store')
  }
  // Pages served sw.js as application/javascript. On Workers it runs the Worker (run_worker_first),
  // and the ASSETS binding is not documented to apply the `_headers` `/*.js` rule, so set it here.
  if (url.pathname === '/sw.js') {
    headers.set('Content-Type', 'application/javascript')
  }

  // Homepage: disable CDN caching so content negotiation always works
  // (Cloudflare edge cache bypasses Functions on cache HITs,
  //  and Pages overrides Function-set Cache-Control for HTML assets)
  if (url.pathname === '/') {
    headers.set('Link', LINK_HEADER)
    headers.set('CDN-Cache-Control', 'no-store')
    // Both homepage representations (HTML and negotiated markdown) vary on Accept.
    mergeVaryAccept(headers)
    // Prevent UTM/ad-click params from fragmenting the cache or Back/Forward Cache.
    headers.set('No-Vary-Search', 'params=("utm_source" "utm_medium" "utm_campaign" "utm_term" "utm_content" "gclid" "fbclid")')
  }

  // Both 404 representations (HTML and markdown) vary on Accept, and the edge must not
  // cache either one, or a cache HIT would answer without this negotiation.
  if (response.status === 404) {
    mergeVaryAccept(headers)
    headers.set('CDN-Cache-Control', 'no-store')
  }

  // API catalog Content-Type override for RFC 9727 compliance
  if (url.pathname === '/.well-known/api-catalog') {
    headers.set('Content-Type', 'application/linkset+json; profile="https://www.rfc-editor.org/info/rfc9727"')
  }

  // ai-catalog.json carries the ARD catalog media type (see AI_CATALOG_MEDIA_TYPE). ard.json
  // keeps application/json until the owner decides; ARD names no Content-Type for either file.
  if (url.pathname === AGENT_PATHS.aiCatalog) {
    headers.set('Content-Type', AI_CATALOG_MEDIA_TYPE)
  }

  // /openapi.json carries the media type the api-catalog advertises for it.
  if (url.pathname === AGENT_PATHS.openapi) {
    headers.set('Content-Type', OPENAPI_MEDIA_TYPE)
  }

  // WebFinger (RFC 7033) Content-Type + permissive CORS for the static JRD at
  // public/.well-known/webfinger. Mirrors the api-catalog override above.
  if (url.pathname === '/.well-known/webfinger') {
    headers.set('Content-Type', 'application/jrd+json')
    headers.set('Access-Control-Allow-Origin', '*')
  }

  // The proxy machinery and the markdown 404 compose GET bodies; a negotiated HEAD must not
  // carry one. Suppression responses already null theirs; this covers the success and error
  // paths. (Pass-through responses keep their body: src/worker.ts hands HEAD to the ASSETS binding
  // and the Astro endpoints as HEAD, and both answer it without one.)
  const body = (negotiated || notFoundMarkdown) && request.method === 'HEAD' ? null : response.body
  return new Response(body, {status: response.status, statusText: response.statusText, headers})
}
