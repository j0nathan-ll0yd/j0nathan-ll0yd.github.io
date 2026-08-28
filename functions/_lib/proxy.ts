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
const PUBLIC_CACHE_CONTROL = `public, max-age=0, s-maxage=${FRESH_CACHE_SECONDS}`
const STALE_CACHE_CONTROL = `public, max-age=0, s-maxage=${FRESH_CACHE_SECONDS}`
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

export interface CloudfrontProxyConfig {
  /** Artifact path on the CloudFront data plane, e.g. '/llms-full.txt'. */
  path: string
  /** Content-Type served to the client (CloudFront serves its own; the route owns the public one). */
  contentType: string
}

interface UpstreamSuccess {
  ok: true
  attempts: number
  response: Response
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
}

type FocusResult = FocusVisible | FocusSuppressed | FocusUnavailable

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

function isRetryableStatus(status: number): boolean {
  return status === 408 || status === 429 || status >= 500
}

async function probeFocus(): Promise<FocusResult> {
  let response: Response
  try {
    response = await fetch(FOCUS_URL, {cache: 'no-store'})
  } catch (error) {
    return {status: 'unavailable', errorName: error instanceof Error ? error.name : 'UnknownError'}
  }

  if (!response.ok) {
    return {status: 'unavailable', upstreamStatus: response.status}
  }

  try {
    const focus = await response.json() as {currentFocus?: unknown}
    if (typeof focus.currentFocus !== 'string') {
      return {status: 'unavailable', errorName: 'InvalidFocusState'}
    }
    if (HIDING_FOCUS_MODE_SET.has(focus.currentFocus)) {
      return {status: 'suppressed', currentFocus: focus.currentFocus}
    }
    return {status: 'visible'}
  } catch {
    return {status: 'unavailable', errorName: 'InvalidFocusJson'}
  }
}

function suppressionResponse(method: string): Response {
  const headers = new Headers({
    'Content-Type': 'application/json; charset=utf-8',
    'Cache-Control': 'no-store',
    'Retry-After': String(SUPPRESSION_RETRY_SECONDS),
    'X-Source': 'cloudfront-proxy-suppressed'
  })
  const body = method === 'HEAD' ? null : JSON.stringify({suppressed: true, reason: 'focus mode active'})
  return new Response(body, {status: 503, headers})
}

function focusUnavailableResponse(path: string, result: FocusUnavailable): Response {
  logger.error('cloudfront_proxy_focus_probe_failed', {
    artifact: path,
    upstream_status: result.upstreamStatus ?? null,
    error_class: result.errorName ?? null
  })
  return new Response('focus state unavailable', {
    status: 502,
    headers: {'Content-Type': 'text/plain; charset=utf-8', 'Cache-Control': 'no-store', 'X-Source': 'cloudfront-proxy-focus-error'}
  })
}

export async function focusPrivacyResponse(method: string, path: string): Promise<Response | null> {
  const focus = await probeFocus()
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

async function fetchWithRetry(upstreamUrl: string, path: string): Promise<UpstreamResult> {
  const init: CfRequestInit = {cf: {cacheEverything: true, cacheTtlByStatus: {'200-299': FRESH_CACHE_SECONDS, '300-599': 0}}}

  let lastResponse: Response | undefined
  let errorName: string | undefined

  for (let attempt = 1; attempt <= MAX_ATTEMPTS; attempt++) {
    try {
      lastResponse = await fetch(upstreamUrl, init)
      errorName = undefined
      if (lastResponse.ok) {
        return {ok: true, attempts: attempt, response: lastResponse}
      }
      if (!isRetryableStatus(lastResponse.status)) {
        return {ok: false, attempts: attempt, response: lastResponse}
      }
    } catch (error) {
      lastResponse = undefined
      errorName = error instanceof Error ? error.name : 'UnknownError'
    }

    const failure: UpstreamFailure = {ok: false, attempts: attempt, response: lastResponse, errorName}
    if (attempt === MAX_ATTEMPTS) {
      return failure
    }
    logger.warn('cloudfront_proxy_retry', diagnosticFields(path, failure))
    await delay(RETRY_DELAYS_MS[attempt - 1] ?? 0)
  }

  return {ok: false, attempts: MAX_ATTEMPTS, response: lastResponse, errorName}
}

function publicResponse(upstream: Response, contentType: string, attempts: number): Response {
  const headers = new Headers({
    'Content-Type': contentType,
    'Cache-Control': PUBLIC_CACHE_CONTROL,
    'X-Proxy-Attempts': String(attempts),
    'X-Proxy-Upstream-Status': String(upstream.status),
    'X-Source': 'cloudfront-proxy'
  })
  const requestId = upstreamRequestId(upstream)
  if (requestId) {
    headers.set('X-Proxy-Upstream-Request-Id', requestId)
  }
  return new Response(upstream.body, {status: 200, headers})
}

async function saveLastKnownGood(cache: CacheLike, cacheKey: Request, response: Response, path: string): Promise<void> {
  const headers = new Headers(response.headers)
  headers.set('Cache-Control', `public, max-age=${LAST_KNOWN_GOOD_SECONDS}`)
  headers.set('X-Proxy-Lkg-Stored-At', new Date().toISOString())
  try {
    await cache.put(cacheKey, new Response(response.body, {status: 200, headers}))
  } catch (error) {
    logger.error('cloudfront_proxy_lkg_write_failed', {artifact: path, error_class: error instanceof Error ? error.name : 'UnknownError'})
  }
}

async function staleResponse(
  cache: CacheLike | undefined,
  cacheKey: Request,
  contentType: string,
  path: string,
  failure: UpstreamFailure
): Promise<Response | undefined> {
  if (!cache || (failure.response && !isRetryableStatus(failure.response.status))) {
    return undefined
  }

  let cached: Response | undefined
  try {
    cached = await cache.match(cacheKey)
  } catch (error) {
    logger.error('cloudfront_proxy_lkg_read_failed', {artifact: path, error_class: error instanceof Error ? error.name : 'UnknownError'})
    return undefined
  }
  if (!cached) {
    return undefined
  }

  const headers = new Headers(cached.headers)
  const diagnostics = diagnosticHeaders(failure)
  diagnostics.forEach((value, name) => headers.set(name, value))
  headers.set('Content-Type', contentType)
  headers.set('Cache-Control', STALE_CACHE_CONTROL)
  headers.set('Warning', '110 - "Response is stale"')
  headers.set('X-Proxy-Stale', 'true')
  headers.set('X-Source', 'cloudfront-proxy-stale')
  logger.warn('cloudfront_proxy_stale_fallback', diagnosticFields(path, failure, true))
  return new Response(cached.body, {status: 200, headers})
}

/** Builds an onRequest handler that proxies one CloudFront artifact resiliently. */
export function makeCloudfrontProxy({path, contentType}: CloudfrontProxyConfig): (context: CloudfrontProxyContext) => Promise<Response> {
  const upstreamUrl = `${CLOUDFRONT_BASE}${path}`
  const artifactName = path.slice(1)

  return async function onRequest(context: CloudfrontProxyContext): Promise<Response> {
    if (context.request.method !== 'GET' && context.request.method !== 'HEAD') {
      return new Response('Method not allowed', {status: 405, headers: {Allow: 'GET, HEAD', 'Cache-Control': 'no-store'}})
    }

    // Privacy gate first. The focus signal is never itself gated, and no-store forces every
    // Function execution to observe the current state before an artifact fetch or LKG lookup.
    // Public artifact responses have only a 60s edge TTL, so a response already cached ahead
    // of a hiding transition has a bounded residual disclosure window and cannot enter SWR.
    const privacyResponse = await focusPrivacyResponse(context.request.method, path)
    if (privacyResponse) {
      return privacyResponse
    }

    const cache = defaultCache()
    const cacheKey = lkgCacheKey(context.request, path)
    const upstream = await fetchWithRetry(upstreamUrl, path)

    if (upstream.ok) {
      const response = publicResponse(upstream.response, contentType, upstream.attempts)
      if (cache) {
        context.waitUntil(saveLastKnownGood(cache, cacheKey, response.clone(), path))
      }
      return response
    }

    const stale = await staleResponse(cache, cacheKey, contentType, path, upstream)
    if (stale) {
      return stale
    }

    logger.error('cloudfront_proxy_terminal_failure', diagnosticFields(path, upstream, false))
    const headers = diagnosticHeaders(upstream)
    headers.set('Content-Type', 'text/plain; charset=utf-8')
    headers.set('Cache-Control', 'no-store')
    headers.set('X-Source', 'cloudfront-proxy-error')
    return new Response(`${artifactName} unavailable`, {status: 502, headers})
  }
}
