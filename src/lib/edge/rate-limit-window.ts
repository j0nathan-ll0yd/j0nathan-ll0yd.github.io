// The fixed-window arithmetic of the developer API's rate limit, with no imports at all. Two Workers
// share it: the rate-limiter Worker (workers/rate-limiter/, which owns the ClientRateLimitWindow Durable
// Object) and the site Worker (src/lib/edge/rate-limit.ts, which re-exports it). Keep it
// dependency-free, so the rate-limiter Worker bundles nothing else from the site.

export interface RateLimitPolicy {
  readonly policy: string
  readonly limit: number
  readonly windowSeconds: number
}

/** What the counter stores for one client: the requests counted in the window, and when it ends. */
export interface WindowState {
  count: number
  windowEndMs: number
}

/** True for a stored window: two non-negative integers. */
export function isWindowState(value: unknown): value is WindowState {
  if (typeof value !== 'object' || value === null) {
    return false
  }
  const {count, windowEndMs} = value as Record<string, unknown>
  return Number.isInteger(count) && (count as number) >= 0 && Number.isInteger(windowEndMs) && (windowEndMs as number) >= 0
}

export interface RateLimitDecision {
  allowed: boolean
  /** The available quota after this request (draft section 4.1.1 `r`). */
  remaining: number
  /** Whole seconds until the window ends (draft section 4.1.2 `t`), at least 1. */
  resetSeconds: number
}

/**
 * One request against a fixed window. Pure: the Durable Object runs it over its stored state, and
 * the unit tests run it with a fixed clock. A request at or after the window end opens a new window.
 * A refused request is not counted, so the count never exceeds the limit.
 */
export function consumeWindow(state: WindowState | undefined, nowMs: number, policy: RateLimitPolicy): {state: WindowState; decision: RateLimitDecision} {
  const open = state !== undefined && nowMs < state.windowEndMs
  const current: WindowState = open ? {...state} : {count: 0, windowEndMs: nowMs + policy.windowSeconds * 1000}
  const allowed = current.count < policy.limit
  if (allowed) {
    current.count += 1
  }
  const resetSeconds = Math.max(1, Math.ceil((current.windowEndMs - nowMs) / 1000))
  return {state: current, decision: {allowed, remaining: policy.limit - current.count, resetSeconds}}
}
