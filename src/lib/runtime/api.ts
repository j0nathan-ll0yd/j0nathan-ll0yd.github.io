import {CLOUDFRONT_BASE, ENDPOINTS, HIDING_FOCUS_MODES, type ResourceKey} from '@j0nathan-ll0yd/portal-contract/constants'
import {type ArtifactValues, decodeArtifact} from '@j0nathan-ll0yd/portal-contract/decoders'
import type {
  ArticlesExport,
  BooksExport,
  FocusExport,
  GithubEventsExport,
  GithubStarredReposExport,
  HealthExport,
  SleepExport,
  TheatreReviewsExport,
  WorkoutsExport
} from '@j0nathan-ll0yd/portal-contract/schemas'

// In dev mode, Vite proxies /api/live/* to CloudFront to avoid CORS issues.
// In production, fetch directly from CloudFront (CORS allows jonathanlloyd.me).
const BASE = import.meta.env.DEV ? '/api/live' : CLOUDFRONT_BASE
const HIDING_FOCUS_MODE_SET = new Set<string>(HIDING_FOCUS_MODES)

export interface EndpointOk<T> {
  status: 'ok'
  data: T
}

export interface EndpointSuppressed {
  status: 'suppressed'
  reason: string
  currentFocus?: string
}

export interface EndpointFailed {
  status: 'failed'
  reason: string
  httpStatus?: number
}

export type EndpointResult<T> = EndpointOk<T> | EndpointSuppressed | EndpointFailed

export interface FetchResult {
  health: EndpointResult<HealthExport>
  sleep: EndpointResult<SleepExport>
  workouts: EndpointResult<WorkoutsExport>
  books: EndpointResult<BooksExport>
  githubEvents: EndpointResult<GithubEventsExport>
  starredRepos: EndpointResult<GithubStarredReposExport>
  articles: EndpointResult<ArticlesExport>
  focus: EndpointResult<FocusExport>
  theatreReviews: EndpointResult<TheatreReviewsExport>
  timestamps: Record<string, string | null>
}

function isSuppressionBody(value: unknown): value is {suppressed: true; reason: string} {
  return Boolean(
    value && typeof value === 'object' && (value as {suppressed?: unknown}).suppressed === true && typeof (value as {reason?: unknown}).reason === 'string'
  )
}

/**
 * Narrow an untrusted string to a dashboard resource key.
 *
 * `key in ENDPOINTS` is NOT equivalent and must not be used: `in` walks the prototype chain, so it
 * admits `constructor`, `toString`, `valueOf` and friends. Those names resolve to inherited
 * functions rather than paths, which stringify into a junk URL and -- where a lookup table is
 * indexed the same way -- can select an inherited function in place of a real validator. Every
 * admission is an own property of the published `ENDPOINTS` table; there is no second key list.
 */
export function isResourceKey(value: unknown): value is ResourceKey {
  return typeof value === 'string' && Object.hasOwn(ENDPOINTS, value)
}

async function focusFallback(timeoutMs: number): Promise<EndpointSuppressed | null> {
  const focus = await fetchArtifact('focus', {timeoutMs})
  if (focus.status === 'ok' && HIDING_FOCUS_MODE_SET.has(focus.data.currentFocus)) {
    return {status: 'suppressed', reason: 'focus mode active', currentFocus: focus.data.currentFocus}
  }
  return null
}

export interface FetchArtifactOptions {
  /** Whole-request budget: the response body and its decode are consumed inside it. */
  timeoutMs?: number
  /** Query string appended to the endpoint URL -- the poll engine's `?_poll=1` service-worker bypass. */
  query?: string
}

/**
 * Fetch one dashboard artifact and decode it against the producer's published contract.
 *
 * The resource key binds three things that used to be supplied separately and could disagree: the
 * URL (`ENDPOINTS[key]`), the decoder (`decodeArtifact(key, ...)`), and the returned type
 * (`ArtifactValues[K]`). There is no caller-supplied URL and no caller-supplied type parameter, so
 * an arriving body can no longer reach the UI as `ok` under a type nothing checked (atlas decision
 * 0124 section 5, replacing `await res.json() as T`). `decodeArtifact` is generated from the same
 * JSON Schemas the producer validates against before it writes the object, compiled ahead of time
 * so the browser needs neither a schema compiler nor runtime code evaluation.
 *
 * A malformed body is NOT a new UI state. `res.json()` and `decodeArtifact` both throw into the
 * existing catch, so a contract violation surfaces exactly like a network failure
 * (`{status: 'failed'}`) and the retained/server-rendered presentation stays in place.
 */
export async function fetchArtifact<K extends ResourceKey>(key: K, options: FetchArtifactOptions = {}): Promise<EndpointResult<ArtifactValues[K]>> {
  const {timeoutMs = 5000, query = ''} = options
  // The compiler constrains K, but the WebSocket push path reaches this function with a value that
  // began as an untrusted string. Refusing anything but an own key here means no present or future
  // dynamic caller can turn an inherited property name into a request.
  if (!isResourceKey(key)) {
    return {status: 'failed', reason: `Unknown resource ${String(key)}`}
  }
  const url = BASE + ENDPOINTS[key] + query
  const controller = new AbortController()
  const timer = setTimeout(() => controller.abort(), timeoutMs)
  try {
    const res = await fetch(url, {signal: controller.signal, cache: 'no-store'})
    if (res.ok) {
      // The body is read and decoded while the abort signal is still armed, so a stalled body is a
      // timeout rather than an unbounded wait, and an invalid one never becomes an `ok` result.
      return {status: 'ok', data: decodeArtifact(key, await res.json())}
    }

    let errorBody: unknown = null
    try {
      errorBody = await res.json()
    } catch {
      // Non-JSON failures are handled below by status.
    }
    if (isSuppressionBody(errorBody)) {
      return {status: 'suppressed', reason: errorBody.reason}
    }

    // focus.json is the honest suppression signal and is never itself edge-gated, so it must never
    // fall back to itself. The key makes that restriction structural rather than a caller argument.
    if (res.status === 403 && key !== 'focus') {
      const fallback = await focusFallback(timeoutMs)
      if (fallback) {
        return fallback
      }
    }

    return {status: 'failed', reason: `HTTP ${res.status}`, httpStatus: res.status}
  } catch (error) {
    return {status: 'failed', reason: error instanceof Error ? error.message : String(error)}
  } finally {
    clearTimeout(timer)
  }
}

/**
 * The composition stamp of a successfully decoded artifact, or null when there is nothing to date.
 *
 * Every export schema requires `generatedAt`, and only decoded values reach here, so the field is
 * read directly. The previous shape-assertion plus `typeof` re-check existed because the result
 * could hold anything the cast let through.
 */
function generatedAt(result: EndpointResult<{generatedAt: string}>): string | null {
  return result.status === 'ok' ? result.data.generatedAt : null
}

function suppressed(reason: string, currentFocus?: string): EndpointSuppressed {
  return {status: 'suppressed', reason, ...(currentFocus ? {currentFocus} : {})}
}

export async function fetchAllEndpoints(): Promise<FetchResult> {
  const focus = await fetchArtifact('focus')
  const hiding = focus.status === 'ok' && HIDING_FOCUS_MODE_SET.has(focus.data.currentFocus)

  let health: EndpointResult<HealthExport>
  let sleep: EndpointResult<SleepExport>
  let workouts: EndpointResult<WorkoutsExport>
  let books: EndpointResult<BooksExport>
  let githubEvents: EndpointResult<GithubEventsExport>
  let starredRepos: EndpointResult<GithubStarredReposExport>
  let articles: EndpointResult<ArticlesExport>
  let theatreReviews: EndpointResult<TheatreReviewsExport>

  if (hiding) {
    const reason = 'focus mode active'
    const currentFocus = focus.data.currentFocus
    health = suppressed(reason, currentFocus)
    sleep = suppressed(reason, currentFocus)
    workouts = suppressed(reason, currentFocus)
    books = suppressed(reason, currentFocus)
    githubEvents = suppressed(reason, currentFocus)
    starredRepos = suppressed(reason, currentFocus)
    articles = suppressed(reason, currentFocus)
    theatreReviews = suppressed(reason, currentFocus)
  } else {
    ;[health, sleep, workouts, books, githubEvents, starredRepos, articles, theatreReviews] = await Promise.all([
      fetchArtifact('health'),
      fetchArtifact('sleep'),
      fetchArtifact('workouts'),
      fetchArtifact('books'),
      fetchArtifact('githubEvents'),
      fetchArtifact('starredRepos'),
      fetchArtifact('articles'),
      fetchArtifact('theatreReviews')
    ])
  }

  return {
    health,
    sleep,
    workouts,
    books,
    githubEvents,
    starredRepos,
    articles,
    focus,
    theatreReviews,
    timestamps: {
      health: generatedAt(health),
      sleep: generatedAt(sleep),
      books: generatedAt(books),
      githubEvents: generatedAt(githubEvents),
      starredRepos: generatedAt(starredRepos),
      articles: generatedAt(articles),
      focus: generatedAt(focus),
      theatreReviews: generatedAt(theatreReviews)
    }
  }
}
