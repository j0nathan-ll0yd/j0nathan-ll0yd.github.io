// Shared factory for the CloudFront proxy Pages Functions (/llms.txt,
// /llms-full.txt, /index.md, /feed.xml, /feed.json). The backend
// (mantle-LifegamesPortal) owns the canonical artifacts; these routes ensure the
// spec-required root paths resolve on jonathanlloyd.me without hand-maintained
// static files. Responses are wrapped by functions/_middleware.ts, which injects
// the security headers.
//
// Not itself a route: Pages Functions only creates routes for modules that
// export an onRequest* handler; this module exports a factory.
//
// Disclosure model (atlas decision 0160, PR 0b). All five artifacts are
// SUPPRESSIBLE_PATHS of the backend focus gate, a CloudFront Function that runs
// on viewer-request BEFORE CloudFront's cache. The gate is authoritative; the
// focus signal is not. The backend closes the gate before it publishes a hiding
// signal, and a failed publication leaves the gate shut over a VISIBLE signal
// with no repair. So a visible focus probe is necessary but never sufficient:
//
// 1. Every artifact fetch is `cache: 'no-store'` with no `cf` cache options, so
//    each one reaches CloudFront and passes the gate. No Cloudflare cache sits
//    in front of the gate. A 200 that Cloudflare still served from its own cache
//    (`cf-cache-status` HIT, STALE, UPDATING or REVALIDATED), or that carries no
//    `x-amz-cf-id`, is refused and admits no last-known-good copy.
// 2. A 403 suppression body from the gate wins over a visible focus probe: the
//    route answers with its 503 suppression response.
// 3. The last-known-good copy is admitted only with fresh evidence, in the same
//    request, that the gate is open (a 200 that passed it; no CloudFront error
//    status proves that), and only when its upstream composition stamp is at
//    most 3 hours old.
// 4. Every response this factory builds is no-store at the browser, generic CDN
//    and Cloudflare layers, the two feed routes included.
//
// Residual windows: KeyValueStore propagation (the backend spec records about
// 30 s to first denial and about 75 s to convergence, with no SLA), and a
// response that passed the gate before a flip and is still in flight.
//
// One window is NOT this module's to close. Cloudflare's zone edge cache sits in
// front of this Function, and a zone Edge Cache TTL rule can store a feed
// response and replay it with no focus probe and no gate check. On 2026-10-08
// /feed.xml and /feed.json answered `cf-cache-status: HIT` with `Age` up to
// 796 s while they still sent `s-maxage=60`, so that rule, not the header, set
// the window. Whether the no-store policy below ends it depends on the rule's
// mode: a rule that respects origin headers stops caching, one that overrides
// them does not. audits/checks/b2-check-cloudflare-llms-cache-rules.mjs measures
// the rule for all five paths; the zone change is an owner decision.

import {createEdgeLogger} from '@j0nathan-ll0yd/observability/edge'
import {CLOUDFRONT_BASE, ENDPOINTS, HIDING_FOCUS_MODES} from '@j0nathan-ll0yd/portal-contract/constants'
import {COMPOSED_AT_METADATA_HEADER} from './feed-artifacts'

/**
 * The oldest upstream composition the last-known-good path may serve. It equals the registry's
 * `audit.error` threshold for these artifacts (3 h). Storage time is not source age: a copy stored
 * a minute ago can hold an artifact composed days ago, so the bound reads the composition stamp.
 */
const LKG_MAX_SOURCE_AGE_MS = 3 * 60 * 60 * 1000
/**
 * The Cache API lifetime of a stored copy. A copy stored longer than the source-age bound is
 * necessarily older than it, so keeping it would only hold an entry that can never be served.
 */
const LAST_KNOWN_GOOD_SECONDS = LKG_MAX_SOURCE_AGE_MS / 1000
/** A composition stamp further ahead of this clock than this is malformed, not merely skewed. */
const LKG_MAX_FUTURE_SKEW_MS = 5 * 60 * 1000
const LKG_COMPOSED_AT_HEADER = 'X-Proxy-Lkg-Composed-At'
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
const GATE_PROBE_TIMEOUT_MS = 2_000
const TOTAL_BUDGET_MS = 10_000
const FOCUS_MAX_ATTEMPTS = 2
const FOCUS_RETRY_DELAY_MS = 100

/** The bounds, exported so tests assert against the REAL numbers instead of restating them. */
export const PROXY_TIMEOUTS = Object.freeze({
  focusMs: FOCUS_TIMEOUT_MS,
  artifactMs: ARTIFACT_TIMEOUT_MS,
  gateProbeMs: GATE_PROBE_TIMEOUT_MS,
  totalMs: TOTAL_BUDGET_MS
})
/** The last-known-good admission bounds, exported for the same reason. */
export const LKG_ADMISSION = Object.freeze({maxSourceAgeMs: LKG_MAX_SOURCE_AGE_MS, maxFutureSkewMs: LKG_MAX_FUTURE_SKEW_MS})
const PUBLIC_NO_STORE = 'no-store'
const SUPPRESSION_RETRY_SECONDS = 60
const HIDING_FOCUS_MODE_SET = new Set<string>(HIDING_FOCUS_MODES)
const FOCUS_URL = `${CLOUDFRONT_BASE}${ENDPOINTS.focus}`
const logger = createEdgeLogger({service: 'cloudfront-pages-proxy'})

/**
 * The fetch options for every request to a gated path: the artifact attempts and the gate probe.
 *
 * `cache: 'no-store'` makes a subrequest to an origin that Cloudflare does not host bypass
 * Cloudflare's caches, so every attempt reaches CloudFront and passes the viewer-request gate.
 * There are deliberately no `cf` cache options: `cacheEverything` and `cacheTtlByStatus` put a
 * Cloudflare cache IN FRONT of the gate, and a hit there served gated content without asking it.
 * `redirect: 'manual'` keeps a redirect from carrying the request to a URL the gate does not
 * guard; a 3xx is then an ordinary non-retryable failure.
 */
const GATED_FETCH_INIT: RequestInit = Object.freeze({cache: 'no-store', redirect: 'manual'})

/** `cf-cache-status` values that mean Cloudflare answered from its own cache, not from the origin. */
const CLOUDFLARE_CACHE_SERVED = new Set(['HIT', 'STALE', 'UPDATING', 'REVALIDATED'])

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
 * No-store on all three cache headers. The llms-assurance contract requires it for every response
 * class of the llm-outputs trio (/llms.txt, /llms-full.txt, /index.md), and atlas decision 0160
 * (plan D3: no Cloudflare artifact cache on a gated path) requires it for the `rss-feed` routes
 * (/feed.xml, /feed.json) too, because all five are gated. It is therefore the factory DEFAULT:
 * a route that passes no policy is no-store, and none of the five passes another.
 */
export const LLM_OUTPUT_CACHE_POLICY: CachePolicy = {cacheControl: PUBLIC_NO_STORE, cdnCacheControl: PUBLIC_NO_STORE}
const GATED_ARTIFACT_CACHE_POLICY: CachePolicy = LLM_OUTPUT_CACHE_POLICY

/** Last-known-good entries are written to the edge Cache API, so they carry their own TTL. */
const LKG_CACHE_POLICY: CachePolicy = {cacheControl: `public, max-age=${LAST_KNOWN_GOOD_SECONDS}`}

export interface CloudfrontProxyConfig {
  /** Artifact path on the CloudFront data plane, e.g. '/llms-full.txt'. */
  path: string
  /** Content-Type served to the client (CloudFront serves its own; the route owns the public one). */
  contentType: string
  /** Cache directives for the success and stale paths. Defaults to no-store, which every gated route needs. */
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
  suppressed?: false
  attempts: number
  response?: Response
  errorName?: string
  /**
   * True when an attempt in THIS request returned gate-open evidence (`isGateOpenEvidence`): a 200
   * that carried `x-amz-cf-id` and that Cloudflare did not serve from cache. No error status counts
   * (see `isGateOpenEvidence`), nor does a transport failure or a Cloudflare-generated 52x.
   */
  gateOpen: boolean
  /**
   * Set when a success-class response was refused: a 200 that cannot prove it passed the gate, or
   * a 2xx other than 200, which is not a complete artifact. The refusal is a privacy decision; its
   * status is never retryable, so it admits no last-known-good copy.
   */
  refused?: Refusal
}

type Refusal = 'cloudflare-cache' | 'no-cloudfront-id' | 'non-200-success'

/** The gate answered an artifact request with its 403 suppression body. The gate wins. */
interface UpstreamSuppressed {
  ok: false
  suppressed: true
  attempts: number
  response: Response
}

type UpstreamResult = UpstreamSuccess | UpstreamFailure | UpstreamSuppressed

type GateObservation = 'open' | 'suppressed' | 'unknown'

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
    gate_open: failure.gateOpen,
    stale_hit: staleHit ?? null
  }
}

/**
 * Keep every public cache layer outside this Function from storing a response.
 * Cloudflare-CDN-Cache-Control is Cloudflare-specific, CDN-Cache-Control covers
 * any other shared intermediary, and Cache-Control reaches the browser. The
 * private LKG cache is configured separately below; there is no origin fetch
 * cache, because every artifact fetch is `cache: 'no-store'`.
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

/** True when Cloudflare answered from its own cache rather than forwarding to CloudFront. */
function servedFromCloudflareCache(response: Response): boolean {
  const status = response.headers.get('cf-cache-status')
  return status !== null && CLOUDFLARE_CACHE_SERVED.has(status.trim().toUpperCase())
}

/**
 * True when this response came from CloudFront in this request, so the viewer-request gate let the
 * request through. CloudFront stamps `x-amz-cf-id` on every response, including its own errors. A
 * Cloudflare cache hit replays stored headers, `x-amz-cf-id` included, so a cache-served response
 * proves nothing about the gate now and is excluded explicitly.
 */
function passedGate(response: Response): boolean {
  return Boolean(response.headers.get('x-amz-cf-id')) && !servedFromCloudflareCache(response)
}

/**
 * True when this response is evidence, for the last-known-good path, that the gate is open now: a
 * 200 that passed the gate in this request. No CloudFront error status proves that the gate
 * function let the request through. AWS documents that with CloudFront Functions "an HTTP 503
 * status code can indicate that your function returned an execution error"
 * (https://docs.aws.amazon.com/AmazonCloudFront/latest/DeveloperGuide/http-503-service-unavailable.html)
 * and that "an HTTP 502 status code can indicate that the CloudFront function is trying to add,
 * delete, or change a read-only header"
 * (https://docs.aws.amazon.com/AmazonCloudFront/latest/DeveloperGuide/http-502-bad-gateway.html),
 * and no documented header tells a function failure from an origin failure.
 */
function isGateOpenEvidence(response: Response): boolean {
  return response.status === 200 && passedGate(response)
}

/** Why a success-class response may not be admitted, or undefined when it may. */
function successRefusal(response: Response): Refusal | undefined {
  if (response.status !== 200) {
    return 'non-200-success'
  }
  if (servedFromCloudflareCache(response)) {
    return 'cloudflare-cache'
  }
  return passedGate(response) ? undefined : 'no-cloudfront-id'
}

/**
 * Reads a 403 body under a deadline and reports whether it is the gate's suppression body
 * (`{"suppressed":true,...}`). Any read or parse failure is `false`: an unreadable 403 is not
 * evidence of anything, and every caller already treats a non-suppression 403 as a refusal.
 */
async function isSuppressionBody(response: Response, budget: RequestBudget, label: string): Promise<boolean> {
  try {
    const text = await withDeadline(() => response.text(), Math.min(ARTIFACT_TIMEOUT_MS, budget.remainingMs()), label)
    const body: unknown = JSON.parse(text)
    return typeof body === 'object' && body !== null && 'suppressed' in body && body.suppressed === true
  } catch {
    return false
  }
}

/** Release a response body this module will not read, so the socket does not wait on it. */
function discardBody(response: Response): void {
  response.body?.cancel().catch(() => {})
}

async function fetchWithRetry(upstreamUrl: string, path: string, budget: RequestBudget): Promise<UpstreamResult> {
  let lastResponse: Response | undefined
  let errorName: string | undefined
  let gateOpen = false

  for (let attempt = 1; attempt <= MAX_ATTEMPTS; attempt++) {
    try {
      lastResponse = await withDeadline((signal) => fetch(upstreamUrl, {...GATED_FETCH_INIT, signal}), Math.min(ARTIFACT_TIMEOUT_MS, budget.remainingMs()),
        `${path} fetch`)
      errorName = undefined
      if (lastResponse.status === 403 && await isSuppressionBody(lastResponse, budget, `${path} 403 body`)) {
        return {ok: false, suppressed: true, attempts: attempt, response: lastResponse}
      }
      if (lastResponse.ok) {
        // Only a 200 is admitted, and only when it provably passed the gate in this request. With
        // no-store a Cloudflare cache hit should not occur; this is the second line if it ever does.
        const refused = successRefusal(lastResponse)
        if (refused) {
          discardBody(lastResponse)
          return {ok: false, attempts: attempt, response: lastResponse, gateOpen: false, refused}
        }
        gateOpen = true
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
        discardBody(lastResponse)
        return {ok: false, attempts: attempt, response: lastResponse, gateOpen}
      }
    } catch (error) {
      // A body-read failure lands here too, with a 2xx `lastResponse` already assigned. Clearing it
      // is deliberate: this run never held a complete representation, so the failure must read as
      // unreachable. A retained 2xx would make `staleResponse` treat it as a definite non-retryable
      // answer and withhold the last-known-good fallback -- the opposite of what a stall warrants.
      // `gateOpen` survives: the headers of that 200 still came through the gate in this request.
      lastResponse = undefined
      errorName = errorClass(error)
    }

    const failure: UpstreamFailure = {ok: false, attempts: attempt, response: lastResponse, errorName, gateOpen}
    const retryDelayMs = RETRY_DELAYS_MS[attempt - 1] ?? 0
    if (attempt === MAX_ATTEMPTS || budget.remainingMs() <= retryDelayMs) {
      return failure
    }
    logger.warn('cloudfront_proxy_retry', diagnosticFields(path, failure))
    await delay(retryDelayMs)
  }

  return {ok: false, attempts: MAX_ATTEMPTS, response: lastResponse, errorName, gateOpen}
}

/**
 * One bounded `no-store` GET of the gated path, asked only when no artifact attempt in this
 * request produced gate-open evidence: every failure was transport (a timeout, DNS, a Cloudflare
 * 52x without `x-amz-cf-id`) or a CloudFront error status, which a failed gate function can also
 * return. It answers one question -- is the gate open right now -- and its body is never served.
 * `open` needs gate-open evidence (`isGateOpenEvidence`, a 200); a suppression body is
 * `suppressed`; everything else, a failed probe or another 5xx included, is `unknown`, which
 * admits nothing. During a CloudFront outage of the path itself the probe answers 5xx too, so the
 * copy is withheld: fail-closed by design.
 *
 * A hung origin hangs this probe too, and the artifact attempts may already have spent the budget.
 * Then the answer is `unknown` and no copy is served: without a gate observation there is no
 * permission to serve one.
 */
async function observeGate(upstreamUrl: string, path: string, budget: RequestBudget): Promise<GateObservation> {
  let response: Response
  try {
    response = await withDeadline((signal) => fetch(upstreamUrl, {...GATED_FETCH_INIT, signal}), Math.min(GATE_PROBE_TIMEOUT_MS, budget.remainingMs()),
      `${path} gate probe`)
  } catch (error) {
    logger.warn('cloudfront_proxy_gate_probe_failed', {artifact: path, error_class: errorClass(error)})
    return 'unknown'
  }
  if (response.status === 403) {
    return await isSuppressionBody(response, budget, `${path} gate probe body`) ? 'suppressed' : 'unknown'
  }
  discardBody(response)
  return isGateOpenEvidence(response) ? 'open' : 'unknown'
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

interface ComposedAt {
  stamp: string
  ms: number
}

/**
 * Parses an ISO-8601 composition stamp. `Date.parse` alone accepts loose forms such as `'1'`, so
 * the value must also look like an ISO date-time; anything else reads as no stamp at all.
 */
function parseComposedAt(value: string | null): ComposedAt | null {
  const stamp = value?.trim()
  if (!stamp || !/^\d{4}-\d{2}-\d{2}T\d{2}:\d{2}/.test(stamp)) {
    return null
  }
  const ms = Date.parse(stamp)
  return Number.isFinite(ms) ? {stamp, ms} : null
}

async function saveLastKnownGood(
  cache: CacheLike,
  cacheKey: Request,
  response: Response,
  body: ArrayBuffer,
  path: string,
  composedAt: string | null
): Promise<void> {
  // The copy is admitted later only by its SOURCE age, so a copy without a readable composition
  // stamp could never be served. Skip the write and keep any older stamped copy in place.
  const parsed = parseComposedAt(composedAt)
  if (!parsed) {
    logger.warn('cloudfront_proxy_lkg_unstamped', {artifact: path, header: COMPOSED_AT_METADATA_HEADER})
    return
  }
  const headers = new Headers(response.headers)
  // The public policy may be no-store; the Cache API reads these headers to decide the entry's
  // TTL, so the stored copy carries the LKG TTL and no CDN override instead. Storing a no-store
  // copy would silently disable the stale fallback for the trio.
  applyCachePolicy(headers, LKG_CACHE_POLICY)
  headers.set('X-Proxy-Lkg-Stored-At', new Date().toISOString())
  headers.set(LKG_COMPOSED_AT_HEADER, parsed.stamp)
  try {
    await cache.put(cacheKey, new Response(body, {status: 200, headers}))
  } catch (error) {
    logger.error('cloudfront_proxy_lkg_write_failed', {artifact: path, error_class: errorClass(error)})
  }
}

type LkgRefusal = 'no-composed-at' | 'composed-at-in-future' | 'source-too-old' | 'no-gate-evidence'

/** Why a stored copy may not be served on source-age grounds, or null when its age admits it. */
function sourceAgeRefusal(cached: Response): LkgRefusal | null {
  const composedAt = parseComposedAt(cached.headers.get(LKG_COMPOSED_AT_HEADER))
  if (!composedAt) {
    return 'no-composed-at'
  }
  const ageMs = Date.now() - composedAt.ms
  if (ageMs < -LKG_MAX_FUTURE_SKEW_MS) {
    return 'composed-at-in-future'
  }
  return ageMs > LKG_MAX_SOURCE_AGE_MS ? 'source-too-old' : null
}

type StaleOutcome = {kind: 'served'; response: Response} | {kind: 'suppressed'} | {kind: 'none'}

/**
 * The last-known-good path. A stored copy is served only when ALL of these hold:
 *
 * 1. The failure was retryable, which no privacy refusal is.
 * 2. The copy's upstream composition stamp is at most `LKG_MAX_SOURCE_AGE_MS` old.
 * 3. This request holds fresh evidence that the gate is open (`isGateOpenEvidence`, a 200): from
 *    an artifact attempt whose body then stalled, or else from one gate probe (`observeGate`).
 *
 * A suppression body at step 3 returns `suppressed`: the gate wins and the route answers 503.
 * The copy is checked before the probe so an ineligible copy costs no extra request.
 */
interface StaleRequest {
  cache: CacheLike | undefined
  cacheKey: Request
  contentType: string
  path: string
  upstreamUrl: string
  failure: UpstreamFailure
  policy: CachePolicy
  budget: RequestBudget
}

async function staleResponse({cache, cacheKey, contentType, path, upstreamUrl, failure, policy, budget}: StaleRequest): Promise<StaleOutcome> {
  // A refusal always carries its success-class response, whose status is never retryable, so this
  // one test also withholds the copy from every refusal.
  if (!cache || (failure.response && !isRetryableStatus(failure.response.status))) {
    return {kind: 'none'}
  }

  let cached: Response | undefined
  try {
    cached = await cache.match(cacheKey)
  } catch (error) {
    logger.error('cloudfront_proxy_lkg_read_failed', {artifact: path, error_class: errorClass(error)})
    return {kind: 'none'}
  }
  if (!cached) {
    return {kind: 'none'}
  }

  const refusal = sourceAgeRefusal(cached)
  if (refusal) {
    discardBody(cached)
    logger.warn('cloudfront_proxy_lkg_refused', {...diagnosticFields(path, failure, false), reason: refusal})
    return {kind: 'none'}
  }

  const gate: GateObservation = failure.gateOpen ? 'open' : await observeGate(upstreamUrl, path, budget)
  if (gate === 'suppressed') {
    discardBody(cached)
    return {kind: 'suppressed'}
  }
  if (gate !== 'open') {
    discardBody(cached)
    logger.warn('cloudfront_proxy_lkg_refused', {...diagnosticFields(path, failure, false), reason: 'no-gate-evidence' satisfies LkgRefusal})
    return {kind: 'none'}
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
  return {kind: 'served', response: new Response(cached.body, {status: 200, headers})}
}

function gateSuppressedResponse(method: string, path: string, attempts: number): Response {
  logger.info?.('cloudfront_proxy_gate_suppressed', {artifact: path, attempts})
  return suppressionResponse(method)
}

/** Builds an onRequest handler that proxies one CloudFront artifact resiliently. */
export function makeCloudfrontProxy(
  {path, contentType, cachePolicy = GATED_ARTIFACT_CACHE_POLICY}: CloudfrontProxyConfig
): (context: CloudfrontProxyContext) => Promise<Response> {
  const upstreamUrl = `${CLOUDFRONT_BASE}${path}`
  const artifactName = path.slice(1)

  return async function onRequest(context: CloudfrontProxyContext): Promise<Response> {
    if (context.request.method !== 'GET' && context.request.method !== 'HEAD') {
      const headers = new Headers({Allow: 'GET, HEAD'})
      setPublicNoStore(headers)
      return new Response('Method not allowed', {status: 405, headers})
    }

    // Privacy gate first. The focus signal is never itself gated, and a hiding value denies at
    // once. A VISIBLE value is not permission on its own: the backend gate can be shut over a
    // visible signal, so every artifact fetch below still passes the gate itself (no-store), and a
    // suppression body from it wins. Every route's responses, the feeds included, are no-store at
    // the browser, generic CDN, and Cloudflare-specific layers. Whether every request then reaches
    // this Function is the Cloudflare zone's decision, not this header's: see the zone-edge-cache
    // note at the top of this module. No route can enter SWR.
    // ONE budget for the whole request: the focus probe, its retry, every artifact attempt, every
    // retry delay, every body read and the gate probe draw from it. Started here, before the first
    // network call.
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
        context.waitUntil(saveLastKnownGood(cache, cacheKey, response, upstream.body, path, upstream.response.headers.get(COMPOSED_AT_METADATA_HEADER)))
      }
      return response
    }

    if (upstream.suppressed) {
      return gateSuppressedResponse(context.request.method, path, upstream.attempts)
    }

    if (upstream.refused) {
      logger.error('cloudfront_proxy_unproven_response', {
        ...diagnosticFields(path, upstream, false),
        reason: upstream.refused,
        cf_cache_status: upstream.response?.headers.get('cf-cache-status') ?? null
      })
    }

    const stale = await staleResponse({cache, cacheKey, contentType, path, upstreamUrl, failure: upstream, policy: cachePolicy, budget})
    if (stale.kind === 'served') {
      return stale.response
    }
    if (stale.kind === 'suppressed') {
      return gateSuppressedResponse(context.request.method, path, upstream.attempts)
    }

    logger.error('cloudfront_proxy_terminal_failure', diagnosticFields(path, upstream, false))
    const headers = diagnosticHeaders(upstream)
    headers.set('Content-Type', 'text/plain; charset=utf-8')
    headers.set('X-Source', 'cloudfront-proxy-error')
    if (upstream.refused) {
      headers.set('X-Proxy-Refused', upstream.refused)
    }
    setPublicNoStore(headers)
    return new Response(`${artifactName} unavailable`, {status: 502, headers})
  }
}
