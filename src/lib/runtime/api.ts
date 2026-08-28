import {CLOUDFRONT_BASE, ENDPOINTS, HIDING_FOCUS_MODES} from '@j0nathan-ll0yd/portal-contract/constants'
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

function isFocusUrl(url: string): boolean {
  return url.split('?')[0]?.endsWith(ENDPOINTS.focus) === true
}

async function focusFallback(timeoutMs: number): Promise<EndpointSuppressed | null> {
  const focus = await fetchWithTimeout<FocusExport>(BASE + ENDPOINTS.focus, timeoutMs, false)
  if (focus.status === 'ok' && HIDING_FOCUS_MODE_SET.has(focus.data.currentFocus)) {
    return {status: 'suppressed', reason: 'focus mode active', currentFocus: focus.data.currentFocus}
  }
  return null
}

export async function fetchWithTimeout<T>(url: string, timeoutMs: number = 5000, allowFocusFallback = true): Promise<EndpointResult<T>> {
  const controller = new AbortController()
  const timer = setTimeout(() => controller.abort(), timeoutMs)
  try {
    const res = await fetch(url, {signal: controller.signal, cache: 'no-store'})
    if (res.ok) {
      return {status: 'ok', data: await res.json() as T}
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

    if (res.status === 403 && allowFocusFallback && !isFocusUrl(url)) {
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

function generatedAt<T>(result: EndpointResult<T>): string | null {
  if (result.status !== 'ok' || typeof result.data !== 'object' || result.data === null) {
    return null
  }
  const value = (result.data as {generatedAt?: unknown}).generatedAt
  return typeof value === 'string' ? value : null
}

function suppressed(reason: string, currentFocus?: string): EndpointSuppressed {
  return {status: 'suppressed', reason, ...(currentFocus ? {currentFocus} : {})}
}

export async function fetchAllEndpoints(): Promise<FetchResult> {
  const focus = await fetchWithTimeout<FocusExport>(BASE + ENDPOINTS.focus)
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
      fetchWithTimeout<HealthExport>(BASE + ENDPOINTS.health),
      fetchWithTimeout<SleepExport>(BASE + ENDPOINTS.sleep),
      fetchWithTimeout<WorkoutsExport>(BASE + ENDPOINTS.workouts),
      fetchWithTimeout<BooksExport>(BASE + ENDPOINTS.books),
      fetchWithTimeout<GithubEventsExport>(BASE + ENDPOINTS.githubEvents),
      fetchWithTimeout<GithubStarredReposExport>(BASE + ENDPOINTS.starredRepos),
      fetchWithTimeout<ArticlesExport>(BASE + ENDPOINTS.articles),
      fetchWithTimeout<TheatreReviewsExport>(BASE + ENDPOINTS.theatreReviews)
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
