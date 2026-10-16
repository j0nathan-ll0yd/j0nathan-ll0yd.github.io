// Bounded reads of the gated data plane, and the admission rules of the disclosure model (atlas
// decision 0160, plan Step 4.1). The CloudFront proxy routes (src/lib/edge/proxy.ts) and the
// dashboard loader (./loader.ts) share this module, so both read the gate the same way.
//
// The authoritative gate is the backend's CloudFront Function, which runs on viewer-request BEFORE
// CloudFront's cache. A gated value is admitted only from a 200 that CloudFront served for that path
// in THIS request:
//
// 1. Every gated fetch is `cache: 'no-store'` with no `cf` cache options, so it reaches CloudFront
//    and passes the gate. No Cloudflare cache sits in front of the gate.
// 2. A 200 that Cloudflare still served from its own cache (`cf-cache-status` HIT, STALE, UPDATING
//    or REVALIDATED), or that carries no `x-amz-cf-id`, proves nothing about the gate now. It is
//    refused.
// 3. A 403 with the gate's suppression body wins over every other signal.

/**
 * The fetch options for every request to a gated path.
 *
 * `cache: 'no-store'` makes a subrequest to an origin that Cloudflare does not host bypass
 * Cloudflare's caches. There are deliberately no `cf` cache options: `cacheEverything` and
 * `cacheTtlByStatus` put a Cloudflare cache IN FRONT of the gate. `redirect: 'manual'` keeps a
 * redirect from carrying the request to a URL the gate does not guard.
 */
export const GATED_FETCH_INIT: RequestInit = Object.freeze({cache: 'no-store', redirect: 'manual'})

/** `cf-cache-status` values that mean Cloudflare answered from its own cache, not from the origin. */
const CLOUDFLARE_CACHE_SERVED = new Set(['HIT', 'STALE', 'UPDATING', 'REVALIDATED'])

/**
 * The remaining share of ONE request's wall-clock budget. Every deadline is sized to
 * `min(per-operation cap, remainingMs())`, so no sequence of individually-bounded operations can
 * outrun the request as a whole.
 */
export interface RequestBudget {
  remainingMs(): number
}

export function startBudget(totalMs: number): RequestBudget {
  const startedAt = Date.now()
  return {remainingMs: () => Math.max(0, totalMs - (Date.now() - startedAt))}
}

/** The same budget, less `reserveMs` that the holder may not spend. */
export function reserving(budget: RequestBudget, reserveMs: number): RequestBudget {
  return {remainingMs: () => Math.max(0, budget.remainingMs() - reserveMs)}
}

/** Raised when a bounded operation outlives its deadline. Named TimeoutError so diagnostics read like the platform's own. */
export class DeadlineError extends Error {
  constructor(message: string) {
    super(message)
    this.name = 'TimeoutError'
  }
}

export function errorClass(error: unknown): string {
  return error instanceof Error ? error.name : 'UnknownError'
}

/**
 * Run one network operation under a hard wall-clock bound.
 *
 * The AbortSignal ASKS the platform to cancel; the race GUARANTEES the bound. `fetch` honors the
 * signal, but a body read takes no signal at all, and a runtime that ignored one would hold the
 * request open forever. When the deadline wins it aborts the controller so nothing keeps running
 * behind the answer; when the operation wins the timer is cleared. The operation is invoked INSIDE
 * the try so a synchronous throw still clears the timer.
 */
export async function withDeadline<T>(operation: (signal: AbortSignal) => Promise<T>, timeoutMs: number, label: string): Promise<T> {
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

export function isRetryableStatus(status: number): boolean {
  return status === 408 || status === 429 || status >= 500
}

/** True when Cloudflare answered from its own cache rather than forwarding to CloudFront. */
export function servedFromCloudflareCache(response: Response): boolean {
  const status = response.headers.get('cf-cache-status')
  return status !== null && CLOUDFLARE_CACHE_SERVED.has(status.trim().toUpperCase())
}

/**
 * True when this response came from CloudFront in this request, so the viewer-request gate let the
 * request through. CloudFront stamps `x-amz-cf-id` on every response, including its own errors. A
 * Cloudflare cache hit replays stored headers, `x-amz-cf-id` included, so a cache-served response
 * proves nothing about the gate now and is excluded explicitly.
 */
export function passedGate(response: Response): boolean {
  return Boolean(response.headers.get('x-amz-cf-id')) && !servedFromCloudflareCache(response)
}

/** Why a success-class gated response may not be admitted. */
export type Refusal = 'cloudflare-cache' | 'no-cloudfront-id' | 'non-200-success'

/** Why a success-class response may not be admitted, or undefined when it may. */
export function successRefusal(response: Response): Refusal | undefined {
  if (response.status !== 200) {
    return 'non-200-success'
  }
  if (servedFromCloudflareCache(response)) {
    return 'cloudflare-cache'
  }
  return passedGate(response) ? undefined : 'no-cloudfront-id'
}

/** True when a parsed body is the gate's suppression body (`{"suppressed":true,...}`). */
export function isSuppressionValue(body: unknown): boolean {
  return typeof body === 'object' && body !== null && 'suppressed' in body && body.suppressed === true
}

/**
 * Reads a 403 body under a deadline and reports whether it is the gate's suppression body. Any read
 * or parse failure is `false`: an unreadable 403 is not evidence of anything, and every caller
 * already treats a non-suppression 403 as a refusal.
 */
export async function isSuppressionBody(response: Response, timeoutMs: number, label: string): Promise<boolean> {
  try {
    const text = await withDeadline(() => response.text(), timeoutMs, label)
    return isSuppressionValue(JSON.parse(text))
  } catch {
    return false
  }
}

/** Release a response body the caller will not read, so the socket does not wait on it. */
export function discardBody(response: Response): void {
  response.body?.cancel().catch(() => {})
}
