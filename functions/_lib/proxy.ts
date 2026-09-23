// Shared factory for the CloudFront proxy Pages Functions (/llms.txt,
// /llms-full.txt, /index.md, /feed.xml, /feed.json). The backend
// (mantle-LifegamesPortal) owns the canonical artifacts; these routes ensure the
// spec-required root paths resolve on jonathanlloyd.me without hand-maintained
// static files. Responses are wrapped by functions/_middleware.ts, which injects
// the security headers.
//
// Not itself a route: Pages Functions only creates routes for modules that
// export an onRequest* handler; this module exports a factory.

import {createEdgeLogger} from '@j0nathan-ll0yd/observability/edge'
import {CLOUDFRONT_BASE, ENDPOINTS, HIDING_FOCUS_MODES} from '@j0nathan-ll0yd/portal-contract/constants'

const FRESH_CACHE_SECONDS = 60
const LAST_KNOWN_GOOD_SECONDS = 3 * 60 * 60
const MAX_ATTEMPTS = 3
const RETRY_DELAYS_MS = [100, 300]

/**
 * Wall-clock bounds. Retry COUNT alone bounded nothing: a single never-resolving fetch, or a
 * response whose body stalls mid-stream, held the request open past any useful deadline and
 * prevented BOTH a prompt failure and the last-known-good fallback. Every network attempt is
 * now bounded twice -- by its own per-operation deadline, and by ONE total request budget that
 * covers the focus probe, its retry, every artifact attempt, every retry delay, and every
 * response-body read.
 *
 * The per-operation deadlines are deliberately far below the total: the budget is what the
 * whole request may spend, not what one hung socket may hold.
 */
const FOCUS_TIMEOUT_MS = 2_000
const ARTIFACT_TIMEOUT_MS = 4_000
const TOTAL_BUDGET_MS = 10_000
const FOCUS_MAX_ATTEMPTS = 2
const FOCUS_RETRY_DELAY_MS = 100

/** The bounds, exported so tests assert against the REAL numbers instead of restating them. */
export const PROXY_TIMEOUTS = Object.freeze({focusMs: FOCUS_TIMEOUT_MS, artifactMs: ARTIFACT_TIMEOUT_MS, totalMs: TOTAL_BUDGET_MS})
const PUBLIC_NO_STORE = 'no-store'
const SUPPRESSION_RETRY_SECONDS = 60
const HIDING_FOCUS_MODE_SET = new Set<string>(HIDING_FOCUS_MODES)
const FOCUS_URL = `${CLOUDFRONT_BASE}${ENDPOINTS.focus}`
const logger = createEdgeLogger({service: 'cloudfront-pages-proxy'})

// Minimal Cloudflare Pages Function types -- only the fields used here.
interface CfRequestInit extends RequestInit {
  cf?: {cacheTtlByStatus?: Record<string, number>; cacheEverything?: boolean}
}

interface CacheLike {
  match(request: Request): Promise<Response | undefined>
  put(request: Request, response: Response): Promise<void>
}

interface CloudflareCacheStorage {
  default?: CacheLike
}

export interface CloudfrontProxyContext {
  request: Request
  waitUntil(promise: Promise<unknown>): void
}

/**
 * Cache directives for the two paths that serve ARTIFACT CONTENT: the success path and the stale
 * last-known-good path. Everything else -- suppression, focus-error, terminal-error, 405 -- is
 * unconditionally no-store via `setPublicNoStore` and is not configurable per route.
 *
 * `cdnCacheControl` is emitted on BOTH `CDN-Cache-Control` and `Cloudflare-CDN-Cache-Control`.
 * Cloudflare always strips `Cloudflare-CDN-Cache-Control` before the client, so it is invisible
 * in a curl; it is set anyway because it turns Origin Cache Control on and is what decides
 * Cloudflare's own edge behavior. `CDN-Cache-Control` and `Cache-Control` reach the client.
 * Omit it to leave both CDN headers unset.
 */
export interface CachePolicy {
  cacheControl: string
  cdnCacheControl?: string
}

/**
 * Default: a browser revalidate plus a short shared-cache TTL. Carried by /feed.xml and
 * /feed.json, which are the `rss-feed` surface and are deliberately edge-cacheable.
 */
const EDGE_CACHED_POLICY: CachePolicy = {cacheControl: `public, max-age=0, s-maxage=${FRESH_CACHE_SECONDS}`}

/**
 * The llm-outputs trio (/llms.txt, /llms-full.txt, /index.md). The llms-assurance contract
 * requires no-store on all three cache headers for every response class of this surface, so the
 * success and stale paths carry what the suppression and error paths already emit.
 */
export const LLM_OUTPUT_CACHE_POLICY: CachePolicy = {cacheControl: PUBLIC_NO_STORE, cdnCacheControl: PUBLIC_NO_STORE}

/** Last-known-good entries are written to the edge Cache API, so they carry their own TTL. */
const LKG_CACHE_POLICY: CachePolicy = {cacheControl: `public, max-age=${LAST_KNOWN_GOOD_SECONDS}`}

export interface CloudfrontProxyConfig {
  /** Artifact path on the CloudFront data plane, e.g. '/llms-full.txt'. */
  path: string
  /** Content-Type served to the client (CloudFront serves its own; the route owns the public one). */
  contentType: string
  /** Cache directives for the success and stale paths. Defaults to the shared 60s edge policy. */
  cachePolicy?: CachePolicy
}

interface UpstreamSuccess {
  ok: true
  attempts: number
  response: Response
  /** The artifact bytes, already read under a deadline. The Response body is spent. */
  body: ArrayBuffer
}

interface UpstreamFailure {
  ok: false
  attempts: number
  response?: Response
  errorName?: string
}

type UpstreamResult = UpstreamSuccess | UpstreamFailure

interface FocusVisible {
  status: 'visible'
}

interface FocusSuppressed {
  status: 'suppressed'
  currentFocus: string
}

interface FocusUnavailable {
  status: 'unavailable'
  upstreamStatus?: number
  errorName?: string
  /** Transport-shaped failures earn one more probe; a malformed or rejected answer does not. */
  retryable: boolean
}

type FocusResult = FocusVisible | FocusSuppressed | FocusUnavailable

/**
 * The remaining share of ONE request's total wall-clock budget. Every deadline in this module
 * is sized to `min(per-operation cap, remainingMs())`, so no sequence of individually-bounded
 * operations can outrun the request as a whole.
 */
export interface RequestBudget {
  remainingMs(): number
}

export function startBudget(totalMs: number = TOTAL_BUDGET_MS): RequestBudget {
  const startedAt = Date.now()
  return {remainingMs: () => Math.max(0, totalMs - (Date.now() - startedAt))}
}

/** Raised when a bounded operation outlives its deadline. Named TimeoutError so diagnostics read like the platform's own. */
class DeadlineError extends Error {
  constructor(message: string) {
    super(message)
    this.name = 'TimeoutError'
  }
}

function errorClass(error: unknown): string {
  return error instanceof Error ? error.name : 'UnknownError'
}

/**
 * Run one network operation under a hard wall-clock bound.
 *
 * The AbortSignal ASKS the platform to cancel; the race GUARANTEES the bound. Those are two
 * different jobs. `fetch` honors the signal and releases the socket, but a body read takes no
 * signal at all, and a runtime that ignored one would hold the request open forever -- which is
 * the exact failure this bounds. When the deadline wins it aborts the controller so nothing keeps
 * running behind the answer; when the operation wins the timer is cleared and the deadline never
 * fires. The operation is invoked INSIDE the try so a synchronous throw still clears the timer.
 */
async function withDeadline<T>(operation: (signal: AbortSignal) => Promise<T>, timeoutMs: number, label: string): Promise<T> {
  if (timeoutMs <= 0) {
    throw new DeadlineError(`${label} had no remaining request budget`)
  }
  const controller = new AbortController()
  let timer: ReturnType<typeof setTimeout> | undefined
  const expiry = new Promise<never>((_resolve, reject) => {
    timer = setTimeout(() => {
      controller.abort()
      reject(new DeadlineError(`${label} exceeded ${timeoutMs}ms`))
    }, timeoutMs)
  })
  try {
    const attempt = operation(controller.signal)
    // The loser of the race still settles. Without this, its rejection surfaces as an unhandled one.
    attempt.catch(() => {})
    return await Promise.race([attempt, expiry])
  } finally {
    clearTimeout(timer)
  }
}

function defaultCache(): CacheLike | undefined {
  return (globalThis as typeof globalThis & {caches?: CloudflareCacheStorage}).caches?.default
}

function lkgCacheKey(request: Request, path: string): Request {
  const publicUrl = new URL(path, request.url)
  publicUrl.search = '?__cloudfront_proxy_lkg=v1'
  return new Request(publicUrl.toString(), {method: 'GET'})
}

function upstreamRequestId(response?: Response): string | undefined {
  return response?.headers.get('x-amz-cf-id') || response?.headers.get('x-request-id') || response?.headers.get('cf-ray') || undefined
}

function diagnosticHeaders(failure: UpstreamFailure): Headers {
  const headers = new Headers({
    'X-Proxy-Attempts': String(failure.attempts),
    'X-Proxy-Upstream-Status': failure.response ? String(failure.response.status) : 'unreachable'
  })
  const requestId = upstreamRequestId(failure.response)
  if (requestId) {
    headers.set('X-Proxy-Upstream-Request-Id', requestId)
  }
  return headers
}

function diagnosticFields(path: string, failure: UpstreamFailure, staleHit?: boolean): Record<string, unknown> {
  return {
    artifact: path,
    attempts: failure.attempts,
    upstream_status: failure.response?.status ?? null,
    upstream_request_id: upstreamRequestId(failure.response) ?? null,
    error_class: failure.errorName ?? null,
    stale_hit: staleHit ?? null
  }
}

/**
 * Keep every public cache layer outside this Function from storing a response.
 * Cloudflare-CDN-Cache-Control is Cloudflare-specific, CDN-Cache-Control covers
 * any other shared intermediary, and Cache-Control reaches the browser. The
 * origin fetch cache and private LKG cache are configured separately below.
 *
 * This is the UNCONDITIONAL form, for responses no route may ever have cached:
 * suppression, focus-error, terminal-error and method-not-allowed. Artifact
 * content goes through the route's own `CachePolicy` instead.
 */
function setPublicNoStore(headers: Headers): void {
  applyCachePolicy(headers, LLM_OUTPUT_CACHE_POLICY)
}

function isRetryableStatus(status: number): boolean {
  return status === 408 || status === 429 || status >= 500
}

/**
 * One bounded read of the ungated focus signal.
 *
 * Every branch that does not return a DEFINITE answer returns `unavailable`, and the caller
 * turns that into a 502. The gate fails CLOSED: a focus state this Function could not read is
 * never treated as permission to serve.
 */
async function probeFocusOnce(budget: RequestBudget): Promise<FocusResult> {
  let response: Response
  try {
    response = await withDeadline((signal) => fetch(FOCUS_URL, {cache: 'no-store', signal}), Math.min(FOCUS_TIMEOUT_MS, budget.remainingMs()), 'focus probe')
  } catch (error) {
    return {status: 'unavailable', errorName: errorClass(error), retryable: true}
  }

  if (!response.ok) {
    return {status: 'unavailable', upstreamStatus: response.status, retryable: isRetryableStatus(response.status)}
  }

  let focus: {currentFocus?: unknown}
  try {
    focus = await withDeadline(() => response.json() as Promise<{currentFocus?: unknown}>, Math.min(FOCUS_TIMEOUT_MS, budget.remainingMs()), 'focus body')
  } catch (error) {
    // A stalled body is transport; malformed JSON is an answer, and a second read returns it again.
    return error instanceof DeadlineError
      ? {status: 'unavailable', errorName: errorClass(error), retryable: true}
      : {status: 'unavailable', errorName: 'InvalidFocusJson', retryable: false}
  }

  if (typeof focus.currentFocus !== 'string') {
    return {status: 'unavailable', errorName: 'InvalidFocusState', retryable: false}
  }
  if (HIDING_FOCUS_MODE_SET.has(focus.currentFocus)) {
    return {status: 'suppressed', currentFocus: focus.currentFocus}
  }
  return {status: 'visible'}
}

/** Bounded retry over the focus probe: one extra attempt for a transport-shaped failure, never for a definite answer. */
async function probeFocus(budget: RequestBudget): Promise<FocusResult> {
  let failure: FocusUnavailable = {status: 'unavailable', errorName: 'FocusProbeNotAttempted', retryable: false}

  for (let attempt = 1; attempt <= FOCUS_MAX_ATTEMPTS; attempt++) {
    const result = await probeFocusOnce(budget)
    if (result.status !== 'unavailable') {
      return result
    }
    failure = result
    if (!result.retryable || attempt === FOCUS_MAX_ATTEMPTS || budget.remainingMs() <= FOCUS_RETRY_DELAY_MS) {
      break
    }
    logger.warn('cloudfront_proxy_focus_retry', {attempts: attempt, upstream_status: result.upstreamStatus ?? null, error_class: result.errorName ?? null})
    await delay(FOCUS_RETRY_DELAY_MS)
  }

  return failure
}

function suppressionResponse(method: string): Response {
  const headers = new Headers({
    'Content-Type': 'application/json; charset=utf-8',
    'Retry-After': String(SUPPRESSION_RETRY_SECONDS),
    'X-Source': 'cloudfront-proxy-suppressed'
  })
  setPublicNoStore(headers)
  const body = method === 'HEAD' ? null : JSON.stringify({suppressed: true, reason: 'focus mode active'})
  return new Response(body, {status: 503, headers})
}

function focusUnavailableResponse(path: string, result: FocusUnavailable): Response {
  logger.error('cloudfront_proxy_focus_probe_failed', {
    artifact: path,
    upstream_status: result.upstreamStatus ?? null,
    error_class: result.errorName ?? null
  })
  const headers = new Headers({'Content-Type': 'text/plain; charset=utf-8', 'X-Source': 'cloudfront-proxy-focus-error'})
  setPublicNoStore(headers)
  return new Response('focus state unavailable', {status: 502, headers})
}

export async function focusPrivacyResponse(method: string, path: string, budget: RequestBudget = startBudget()): Promise<Response | null> {
  const focus = await probeFocus(budget)
  if (focus.status === 'suppressed') {
    logger.info?.('cloudfront_proxy_suppressed', {artifact: path, current_focus: focus.currentFocus})
    return suppressionResponse(method)
  }
  if (focus.status === 'unavailable') {
    return focusUnavailableResponse(path, focus)
  }
  return null
}

function delay(ms: number): Promise<void> {
  return new Promise((resolve) => setTimeout(resolve, ms))
}

/**
 * Origin fetch cache directives, and what they are actually worth.
 *
 * `cacheEverything: true` makes the subrequest ELIGIBLE for the edge cache and nothing more --
 * Cloudflare documents it as "Treats all content as static and caches all file types beyond the
 * Cloudflare default cached content. Respects cache headers from the origin web server", and the
 * cache-using-fetch example states "For time-to-live (TTL), Cloudflare will still rely on headers
 * set by the origin". So `cacheEverything` alone does NOT produce 60 seconds.
 *
 * `cacheTtlByStatus` is what pins the number: 60s for 2xx, zero for every 3xx-5xx so a transient
 * upstream failure is never held at the edge. THE PROXY RELIES ON IT, and its availability is not
 * a settled fact. The property description at
 * https://developers.cloudflare.com/workers/runtime-apis/request/ states no plan restriction (the
 * Enterprise-only annotation there attaches to `cacheKey`), while Cloudflare Community threads
 * have long asserted `cacheTtlByStatus` is Enterprise-only. Neither claim was verifiable against
 * this zone's plan from the docs alone. Read the 60 as CONDITIONAL, not as a fact about the
 * deployed site: where the option is honored the TTL is 60s for 2xx and 0 otherwise; where it is
 * ignored the real TTL is whatever `Cache-Control` the CloudFront origin sent.
 *
 * Nothing downstream depends on which of the two holds. This cache sits BEHIND the privacy gate,
 * the public cache policy is set independently by `applyCachePolicy`, and the last-known-good
 * fallback carries its own TTL. The difference is an origin-fetch efficiency, not a policy.
 */
const ORIGIN_FETCH_INIT: CfRequestInit = {cf: {cacheEverything: true, cacheTtlByStatus: {'200-299': FRESH_CACHE_SECONDS, '300-599': 0}}}

async function fetchWithRetry(upstreamUrl: string, path: string, budget: RequestBudget): Promise<UpstreamResult> {
  let lastResponse: Response | undefined
  let errorName: string | undefined

  for (let attempt = 1; attempt <= MAX_ATTEMPTS; attempt++) {
    try {
      lastResponse = await withDeadline((signal) => fetch(upstreamUrl, {...ORIGIN_FETCH_INIT, signal}), Math.min(ARTIFACT_TIMEOUT_MS, budget.remainingMs()),
        `${path} fetch`)
      errorName = undefined
      if (lastResponse.ok) {
        // Read the artifact HERE, under its own deadline, rather than streaming the upstream body
        // to the client. A stalled body is the second half of the hang this bounds, and it is
        // invisible to any deadline placed on the fetch alone. These artifacts are small text
        // files, so buffering costs little and also removes the tee `response.clone()` needed to
        // write the last-known-good copy.
        const response = lastResponse
        const body = await withDeadline(() => response.arrayBuffer(), Math.min(ARTIFACT_TIMEOUT_MS, budget.remainingMs()), `${path} body`)
        return {ok: true, attempts: attempt, response, body}
      }
      if (!isRetryableStatus(lastResponse.status)) {
        return {ok: false, attempts: attempt, response: lastResponse}
      }
    } catch (error) {
      // A body-read failure lands here too, with a 2xx `lastResponse` already assigned. Clearing it
      // is deliberate: this run never held a complete representation, so the failure must read as
      // unreachable. A retained 2xx would make `staleResponse` treat it as a definite non-retryable
      // answer and withhold the last-known-good fallback -- the opposite of what a stall warrants.
      lastResponse = undefined
      errorName = errorClass(error)
    }

    const failure: UpstreamFailure = {ok: false, attempts: attempt, response: lastResponse, errorName}
    const retryDelayMs = RETRY_DELAYS_MS[attempt - 1] ?? 0
    if (attempt === MAX_ATTEMPTS || budget.remainingMs() <= retryDelayMs) {
      return failure
    }
    logger.warn('cloudfront_proxy_retry', diagnosticFields(path, failure))
    await delay(retryDelayMs)
  }

  return {ok: false, attempts: MAX_ATTEMPTS, response: lastResponse, errorName}
}

/**
 * Writes one cache policy onto a header set, clearing the CDN headers first so a policy without
 * `cdnCacheControl` can never inherit one from a copied response (the stale and last-known-good
 * paths both start from headers they did not author).
 */
function applyCachePolicy(headers: Headers, policy: CachePolicy): void {
  headers.set('Cache-Control', policy.cacheControl)
  headers.delete('CDN-Cache-Control')
  headers.delete('Cloudflare-CDN-Cache-Control')
  if (policy.cdnCacheControl) {
    headers.set('CDN-Cache-Control', policy.cdnCacheControl)
    headers.set('Cloudflare-CDN-Cache-Control', policy.cdnCacheControl)
  }
}

function publicResponse(upstream: UpstreamSuccess, contentType: string, policy: CachePolicy): Response {
  const headers = new Headers({
    'Content-Type': contentType,
    'X-Proxy-Attempts': String(upstream.attempts),
    'X-Proxy-Upstream-Status': String(upstream.response.status),
    'X-Source': 'cloudfront-proxy'
  })
  applyCachePolicy(headers, policy)
  const requestId = upstreamRequestId(upstream.response)
  if (requestId) {
    headers.set('X-Proxy-Upstream-Request-Id', requestId)
  }
  return new Response(upstream.body, {status: 200, headers})
}

async function saveLastKnownGood(cache: CacheLike, cacheKey: Request, response: Response, body: ArrayBuffer, path: string): Promise<void> {
  const headers = new Headers(response.headers)
  // The public policy may be no-store; the Cache API reads these headers to decide the entry's
  // TTL, so the stored copy carries the LKG TTL and no CDN override instead. Storing a no-store
  // copy would silently disable the stale fallback for the trio.
  applyCachePolicy(headers, LKG_CACHE_POLICY)
  headers.set('X-Proxy-Lkg-Stored-At', new Date().toISOString())
  try {
    await cache.put(cacheKey, new Response(body, {status: 200, headers}))
  } catch (error) {
    logger.error('cloudfront_proxy_lkg_write_failed', {artifact: path, error_class: errorClass(error)})
  }
}

async function staleResponse(
  cache: CacheLike | undefined,
  cacheKey: Request,
  contentType: string,
  path: string,
  failure: UpstreamFailure,
  policy: CachePolicy
): Promise<Response | undefined> {
  if (!cache || (failure.response && !isRetryableStatus(failure.response.status))) {
    return undefined
  }

  let cached: Response | undefined
  try {
    cached = await cache.match(cacheKey)
  } catch (error) {
    logger.error('cloudfront_proxy_lkg_read_failed', {artifact: path, error_class: errorClass(error)})
    return undefined
  }
  if (!cached) {
    return undefined
  }

  const headers = new Headers(cached.headers)
  const diagnostics = diagnosticHeaders(failure)
  diagnostics.forEach((value, name) => headers.set(name, value))
  headers.set('Content-Type', contentType)
  applyCachePolicy(headers, policy)
  headers.set('Warning', '110 - "Response is stale"')
  headers.set('X-Proxy-Stale', 'true')
  headers.set('X-Source', 'cloudfront-proxy-stale')
  logger.warn('cloudfront_proxy_stale_fallback', diagnosticFields(path, failure, true))
  return new Response(cached.body, {status: 200, headers})
}

/** Builds an onRequest handler that proxies one CloudFront artifact resiliently. */
export function makeCloudfrontProxy(
  {path, contentType, cachePolicy = EDGE_CACHED_POLICY}: CloudfrontProxyConfig
): (context: CloudfrontProxyContext) => Promise<Response> {
  const upstreamUrl = `${CLOUDFRONT_BASE}${path}`
  const artifactName = path.slice(1)

  return async function onRequest(context: CloudfrontProxyContext): Promise<Response> {
    if (context.request.method !== 'GET' && context.request.method !== 'HEAD') {
      const headers = new Headers({Allow: 'GET, HEAD'})
      setPublicNoStore(headers)
      return new Response('Method not allowed', {status: 405, headers})
    }

    // Privacy gate first. The focus signal is never itself gated. The trio's responses are
    // no-store at the browser, generic CDN, and Cloudflare-specific layers, so every request for
    // them reaches this check. The residual disclosure window after a hiding transition is
    // bounded by the route's own policy: zero for the no-store trio, 60s for the edge-cached
    // feeds. No route can enter SWR. The origin fetch cache (ORIGIN_FETCH_INIT) and three-hour LKG remain
    // behind the gate.
    // ONE budget for the whole request: the focus probe, its retry, every artifact attempt, every
    // retry delay and every body read draw from it. Started here, before the first network call.
    const budget = startBudget()

    const privacyResponse = await focusPrivacyResponse(context.request.method, path, budget)
    if (privacyResponse) {
      return privacyResponse
    }

    const cache = defaultCache()
    const cacheKey = lkgCacheKey(context.request, path)
    const upstream = await fetchWithRetry(upstreamUrl, path, budget)

    if (upstream.ok) {
      const response = publicResponse(upstream, contentType, cachePolicy)
      if (cache) {
        context.waitUntil(saveLastKnownGood(cache, cacheKey, response, upstream.body, path))
      }
      return response
    }

    const stale = await staleResponse(cache, cacheKey, contentType, path, upstream, cachePolicy)
    if (stale) {
      return stale
    }

    logger.error('cloudfront_proxy_terminal_failure', diagnosticFields(path, upstream, false))
    const headers = diagnosticHeaders(upstream)
    headers.set('Content-Type', 'text/plain; charset=utf-8')
    headers.set('X-Source', 'cloudfront-proxy-error')
    setPublicNoStore(headers)
    return new Response(`${artifactName} unavailable`, {status: 502, headers})
  }
}
