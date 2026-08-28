import {afterEach, beforeEach, describe, expect, it, vi} from 'vitest'
import {fetchAllEndpoints, fetchWithTimeout} from '../../src/lib/runtime/api'

vi.mock('@j0nathan-ll0yd/portal-contract/constants', async (importActual) => {
  const actual = await importActual<typeof import('@j0nathan-ll0yd/portal-contract/constants')>()
  return {
    ...actual,
    CLOUDFRONT_BASE: 'https://mock.cloudfront.net',
    ENDPOINTS: {
      health: '/health.json',
      sleep: '/sleep.json',
      workouts: '/workouts.json',
      books: '/books.json',
      starredRepos: '/github-starred-repos.json',
      githubEvents: '/github-events.json',
      articles: '/articles.json',
      focus: '/focus.json',
      theatreReviews: '/theatre-reviews.json'
    }
  }
})

function jsonResponse(data: unknown, status = 200): Response {
  return new Response(JSON.stringify(data), {status, headers: {'Content-Type': 'application/json'}})
}

const healthFixture = {generatedAt: '2024-01-01T00:00:00Z', quantities: {}}
const sleepFixture = {generatedAt: '2024-01-01T00:00:00Z', date: '2024-01-01'}
const workoutsFixture = {generatedAt: '2024-01-01T00:00:00Z', workouts: []}
const booksFixture = {generatedAt: '2024-01-01T00:00:00Z', books: []}
const githubEventsFixture = {generatedAt: '2024-01-01T00:00:00Z', events: []}
const starredReposFixture = {generatedAt: '2024-01-01T00:00:00Z', repos: []}
const articlesFixture = {generatedAt: '2024-01-01T00:00:00Z', articles: []}
const focusFixture = {generatedAt: '2024-01-01T00:00:00Z', currentFocus: 'Personal'}
const theatreFixture = {generatedAt: '2024-01-01T00:00:00Z', reviews: []}

describe('fetchWithTimeout', () => {
  beforeEach(() => {
    vi.useFakeTimers()
  })

  afterEach(() => {
    vi.useRealTimers()
    vi.unstubAllGlobals()
  })

  it('returns a discriminated ok result on success', async () => {
    vi.stubGlobal('fetch', vi.fn().mockResolvedValue(jsonResponse({foo: 'bar'})))

    const promise = fetchWithTimeout<{foo: string}>('https://example.com/data.json')
    await vi.runAllTimersAsync()

    expect(await promise).toEqual({status: 'ok', data: {foo: 'bar'}})
  })

  it('recognizes the suppression disclosure body without logging a generic failure', async () => {
    vi.stubGlobal('fetch', vi.fn().mockResolvedValue(jsonResponse({suppressed: true, reason: 'focus mode active'}, 403)))

    const promise = fetchWithTimeout('https://mock.cloudfront.net/books.json')
    await vi.runAllTimersAsync()

    expect(await promise).toEqual({status: 'suppressed', reason: 'focus mode active'})
  })

  it('falls back to focus.json for an unrecognized 403 and identifies hiding', async () => {
    const fetchMock = vi.fn().mockResolvedValueOnce(jsonResponse({message: 'forbidden'}, 403)).mockResolvedValueOnce(
      jsonResponse({currentFocus: 'Do Not Disturb', generatedAt: '2026-08-27T00:00:00Z'})
    )
    vi.stubGlobal('fetch', fetchMock)

    const promise = fetchWithTimeout('https://mock.cloudfront.net/books.json')
    await vi.runAllTimersAsync()

    expect(await promise).toEqual({status: 'suppressed', reason: 'focus mode active', currentFocus: 'Do Not Disturb'})
    expect(fetchMock).toHaveBeenLastCalledWith('/api/live/focus.json', expect.objectContaining({cache: 'no-store'}))
  })

  it.each([404, 500])('returns a discriminated failed result for HTTP %s', async (status) => {
    vi.stubGlobal('fetch', vi.fn().mockResolvedValue(new Response(null, {status})))

    const promise = fetchWithTimeout('https://example.com/error.json')
    await vi.runAllTimersAsync()

    expect(await promise).toEqual({status: 'failed', reason: `HTTP ${status}`, httpStatus: status})
  })

  it('returns failed on a network error', async () => {
    vi.stubGlobal('fetch', vi.fn().mockRejectedValue(new Error('Network error')))

    const promise = fetchWithTimeout('https://example.com/data.json')
    await vi.runAllTimersAsync()

    expect(await promise).toEqual({status: 'failed', reason: 'Network error'})
  })

  it('returns failed on timeout', async () => {
    vi.stubGlobal('fetch',
      vi.fn().mockImplementation((_url: string, opts: {signal?: AbortSignal}) =>
        new Promise((_resolve, reject) => opts.signal?.addEventListener('abort', () => reject(new DOMException('aborted', 'AbortError'))))
      ))

    const promise = fetchWithTimeout('https://example.com/slow.json', 1000)
    vi.advanceTimersByTime(1000)
    await vi.runAllTimersAsync()

    expect(await promise).toEqual({status: 'failed', reason: 'AbortError: aborted'})
  })
})

describe('fetchAllEndpoints', () => {
  afterEach(() => {
    vi.unstubAllGlobals()
  })

  it('returns every successful endpoint and its timestamp', async () => {
    const fetchMock = vi.fn().mockResolvedValueOnce(jsonResponse(focusFixture)).mockResolvedValueOnce(jsonResponse(healthFixture)).mockResolvedValueOnce(
      jsonResponse(sleepFixture)
    ).mockResolvedValueOnce(jsonResponse(workoutsFixture)).mockResolvedValueOnce(jsonResponse(booksFixture)).mockResolvedValueOnce(
      jsonResponse(githubEventsFixture)
    ).mockResolvedValueOnce(jsonResponse(starredReposFixture)).mockResolvedValueOnce(jsonResponse(articlesFixture)).mockResolvedValueOnce(
      jsonResponse(theatreFixture)
    )
    vi.stubGlobal('fetch', fetchMock)

    const result = await fetchAllEndpoints()

    expect(result.health).toEqual({status: 'ok', data: healthFixture})
    expect(result.books).toEqual({status: 'ok', data: booksFixture})
    expect(result.focus).toEqual({status: 'ok', data: focusFixture})
    expect(result.timestamps.health).toBe('2024-01-01T00:00:00Z')
    expect(result.timestamps.books).toBe('2024-01-01T00:00:00Z')
  })

  it('does not request gated endpoints when the honest focus source says hiding', async () => {
    const fetchMock = vi.fn().mockResolvedValue(jsonResponse({...focusFixture, currentFocus: 'Work'}))
    vi.stubGlobal('fetch', fetchMock)

    const result = await fetchAllEndpoints()

    expect(fetchMock).toHaveBeenCalledOnce()
    expect(result.health).toEqual({status: 'suppressed', reason: 'focus mode active', currentFocus: 'Work'})
    expect(result.theatreReviews.status).toBe('suppressed')
    expect(result.focus.status).toBe('ok')
    expect(result.timestamps.health).toBeNull()
  })

  it('keeps endpoint failures explicit without rejecting the aggregate', async () => {
    vi.stubGlobal('fetch', vi.fn().mockRejectedValue(new Error('all fail')))

    const result = await fetchAllEndpoints()

    expect(result.health).toEqual({status: 'failed', reason: 'all fail'})
    expect(result.sleep).toEqual({status: 'failed', reason: 'all fail'})
    expect(result.focus).toEqual({status: 'failed', reason: 'all fail'})
    expect(result.timestamps.health).toBeNull()
  })
})
