import {decodeArtifact} from '@j0nathan-ll0yd/portal-contract/decoders'
import {afterEach, beforeEach, describe, expect, it, vi} from 'vitest'
import {fetchAllEndpoints, fetchArtifact, isResourceKey} from '../../src/lib/runtime/api'

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

// Every fixture below satisfies the export's published JSON Schema, because fetchArtifact now
// decodes each body against that schema before returning `ok`. They were previously trimmed to
// whatever the assertion read (health without `date`, theatre without `source`/`totalReviews`),
// which the unchecked `as T` cast accepted. Those omissions were fixed rather than the validation
// loosened: a fixture the producer could not legally publish proves nothing about the runtime.
const healthFixture = {date: '2024-01-01', generatedAt: '2024-01-01T00:00:00Z', quantities: {}}
const sleepFixture = {generatedAt: '2024-01-01T00:00:00Z', date: '2024-01-01'}
const workoutsFixture = {date: '2024-01-01', generatedAt: '2024-01-01T00:00:00Z', workouts: []}
const booksFixture = {generatedAt: '2024-01-01T00:00:00Z', books: []}
const githubEventsFixture = {generatedAt: '2024-01-01T00:00:00Z', events: []}
const starredReposFixture = {generatedAt: '2024-01-01T00:00:00Z', repos: []}
const articlesFixture = {generatedAt: '2024-01-01T00:00:00Z', articles: []}
const focusFixture = {generatedAt: '2024-01-01T00:00:00Z', currentFocus: 'Personal'}
const theatreFixture = {generatedAt: '2024-01-01T00:00:00Z', source: 'coasttocoastreviews.com', totalReviews: 0, reviews: []}

describe('fetchArtifact', () => {
  beforeEach(() => {
    vi.useFakeTimers()
  })

  afterEach(() => {
    vi.useRealTimers()
    vi.unstubAllGlobals()
  })

  it('returns a discriminated ok result on success', async () => {
    const fetchMock = vi.fn().mockResolvedValue(jsonResponse(booksFixture))
    vi.stubGlobal('fetch', fetchMock)

    const promise = fetchArtifact('books')
    await vi.runAllTimersAsync()

    expect(await promise).toEqual({status: 'ok', data: booksFixture})
    // The key selects the URL: no caller supplies one, so the decoded contract and the requested
    // object can never be a mismatched pair.
    expect(fetchMock).toHaveBeenCalledWith('/api/live/books.json', expect.objectContaining({cache: 'no-store'}))
  })

  it('appends the caller query to the endpoint URL', async () => {
    const fetchMock = vi.fn().mockResolvedValue(jsonResponse(healthFixture))
    vi.stubGlobal('fetch', fetchMock)

    const promise = fetchArtifact('health', {query: '?_poll=1'})
    await vi.runAllTimersAsync()

    expect(await promise).toEqual({status: 'ok', data: healthFixture})
    expect(fetchMock).toHaveBeenCalledWith('/api/live/health.json?_poll=1', expect.objectContaining({cache: 'no-store'}))
  })

  it('recognizes the suppression disclosure body without logging a generic failure', async () => {
    vi.stubGlobal('fetch', vi.fn().mockResolvedValue(jsonResponse({suppressed: true, reason: 'focus mode active'}, 403)))

    const promise = fetchArtifact('books')
    await vi.runAllTimersAsync()

    expect(await promise).toEqual({status: 'suppressed', reason: 'focus mode active'})
  })

  it('falls back to focus.json for an unrecognized 403 and identifies hiding', async () => {
    const fetchMock = vi.fn().mockResolvedValueOnce(jsonResponse({message: 'forbidden'}, 403)).mockResolvedValueOnce(
      jsonResponse({currentFocus: 'Do Not Disturb', generatedAt: '2026-08-27T00:00:00Z'})
    )
    vi.stubGlobal('fetch', fetchMock)

    const promise = fetchArtifact('books')
    await vi.runAllTimersAsync()

    expect(await promise).toEqual({status: 'suppressed', reason: 'focus mode active', currentFocus: 'Do Not Disturb'})
    expect(fetchMock).toHaveBeenLastCalledWith('/api/live/focus.json', expect.objectContaining({cache: 'no-store'}))
  })

  it('never falls back to focus.json for a forbidden focus request', async () => {
    const fetchMock = vi.fn().mockResolvedValue(jsonResponse({message: 'forbidden'}, 403))
    vi.stubGlobal('fetch', fetchMock)

    const promise = fetchArtifact('focus')
    await vi.runAllTimersAsync()

    // The suppression signal cannot suppress itself: one request, and an explicit failure.
    expect(await promise).toEqual({status: 'failed', reason: 'HTTP 403', httpStatus: 403})
    expect(fetchMock).toHaveBeenCalledOnce()
  })

  it.each([404, 500])('returns a discriminated failed result for HTTP %s', async (status) => {
    vi.stubGlobal('fetch', vi.fn().mockResolvedValue(new Response(null, {status})))

    const promise = fetchArtifact('books')
    await vi.runAllTimersAsync()

    expect(await promise).toEqual({status: 'failed', reason: `HTTP ${status}`, httpStatus: status})
  })

  it('returns failed on a network error', async () => {
    vi.stubGlobal('fetch', vi.fn().mockRejectedValue(new Error('Network error')))

    const promise = fetchArtifact('books')
    await vi.runAllTimersAsync()

    expect(await promise).toEqual({status: 'failed', reason: 'Network error'})
  })

  it('returns failed on timeout', async () => {
    vi.stubGlobal('fetch',
      vi.fn().mockImplementation((_url: string, opts: {signal?: AbortSignal}) =>
        new Promise((_resolve, reject) => opts.signal?.addEventListener('abort', () => reject(new DOMException('aborted', 'AbortError'))))
      ))

    const promise = fetchArtifact('books', {timeoutMs: 1000})
    vi.advanceTimersByTime(1000)
    await vi.runAllTimersAsync()

    expect(await promise).toEqual({status: 'failed', reason: 'AbortError: aborted'})
  })

  it('aborts a stalled response body inside the same request budget', async () => {
    // The 200 arrives promptly; the BODY never does. Before contract decoding the body was read
    // with `await res.json()` under the same signal, and that budget must survive the change --
    // otherwise a hung body would hang the dashboard forever behind a successful status line.
    vi.stubGlobal('fetch',
      vi.fn().mockImplementation((_url: string, opts: {signal?: AbortSignal}) =>
        Promise.resolve({
          ok: true,
          status: 200,
          json: () =>
            new Promise((_resolve, reject) => {
              // Real body reads reject immediately on an already-aborted signal and on a later
              // abort; the double has to honour both so the assertion cannot pass on ordering luck.
              const abort = () => reject(new DOMException('aborted', 'AbortError'))
              if (opts.signal?.aborted) {
                abort()
                return
              }
              opts.signal?.addEventListener('abort', abort)
            })
        })
      ))

    const promise = fetchArtifact('books', {timeoutMs: 1000})
    // Async advance so the response resolves and the body read is in flight BEFORE the deadline
    // fires. That is the ordering under test: the budget must still cover the body, not just the
    // response head.
    await vi.advanceTimersByTimeAsync(1000)

    expect(await promise).toEqual({status: 'failed', reason: 'AbortError: aborted'})
  })
})

describe('resource key admission', () => {
  afterEach(() => {
    vi.unstubAllGlobals()
  })

  it('admits every published endpoint key', () => {
    for (const key of ['health', 'sleep', 'workouts', 'books', 'starredRepos', 'githubEvents', 'articles', 'focus', 'theatreReviews']) {
      expect(isResourceKey(key)).toBe(true)
    }
  })

  // `key in ENDPOINTS` reported true for all of these, because `in` walks the prototype chain.
  // `constructor` is the damaging one: it resolves to a function, so the old check passed it
  // through and the URL builder concatenated the function's source text into the request path.
  it.each(['constructor', 'toString', 'valueOf', 'hasOwnProperty', '__proto__', 'toLocaleString'])('refuses the inherited property name %s', (name) => {
    expect(isResourceKey(name)).toBe(false)
  })

  it('refuses non-string values', () => {
    expect(isResourceKey(undefined)).toBe(false)
    expect(isResourceKey(null)).toBe(false)
    expect(isResourceKey(0)).toBe(false)
    expect(isResourceKey({})).toBe(false)
  })

  // THE SAME REFUSAL, ONE LAYER DOWN. `decodeArtifact` runs its own `Object.hasOwn` gate over the
  // validator table before it selects a validator, and until now nothing in this repo covered it
  // -- `fetchArtifact`'s `isResourceKey` guard sits above it, so the consumer path never reaches
  // the decoder with a bad key. That makes the producer's gate load-bearing and untested from the
  // side that ships it: the moment a second call site appears, `Object(payload)` becomes the
  // "validator" and returns truthy for every input.
  //
  // WHAT THIS TEST CANNOT SEE, stated rather than implied. Under vitest the decoder loads as
  // native ESM, where a module namespace has a NULL prototype, so `key in validators` and
  // `Object.hasOwn(validators, key)` agree and this assertion passes under either. It pins the
  // CONTRACT (an unknown key throws), not the guard's form. The guard's form only matters once the
  // namespace is bundled into a plain object rooted at `Object.prototype`, which is what this repo
  // actually ships -- so the mutation gate for it lives in tests/build/decoder-guard.test.ts,
  // against the built chunk. Measured: replacing `Object.hasOwn` with `in` in the published
  // package leaves this test green and reds that one.
  it('refuses an inherited property name at the decoder, not just at the fetch boundary', () => {
    expect(() => decodeArtifact('constructor' as never, {evil: 1})).toThrow(/Unknown artifact resource/)
    expect(() => decodeArtifact('toString' as never, {evil: 1})).toThrow(/Unknown artifact resource/)
  })

  it('issues no request at all for an inherited property name', async () => {
    const fetchMock = vi.fn()
    vi.stubGlobal('fetch', fetchMock)

    // The signature constrains callers at compile time; this exercises the runtime backstop that
    // protects the WebSocket path, where the value began as an untrusted string.
    const result = await fetchArtifact('constructor' as never)

    expect(result).toEqual({status: 'failed', reason: 'Unknown resource constructor'})
    expect(fetchMock).not.toHaveBeenCalled()
  })
})

describe('fetchArtifact contract decoding', () => {
  beforeEach(() => {
    vi.useFakeTimers()
  })

  afterEach(() => {
    vi.useRealTimers()
    vi.unstubAllGlobals()
  })

  it('rejects an unknown property the producer could not have published', async () => {
    // The export schemas are `additionalProperties: false`, so an unmapped field is a contract
    // violation even when every expected field is present and well typed.
    vi.stubGlobal('fetch', vi.fn().mockResolvedValue(jsonResponse({...booksFixture, unexpectedField: true})))

    const promise = fetchArtifact('books')
    await vi.runAllTimersAsync()

    expect(await promise).toEqual({status: 'failed', reason: 'Invalid /books.json payload'})
  })

  it('rejects a nested value whose type violates the schema', async () => {
    vi.stubGlobal('fetch', vi.fn().mockResolvedValue(jsonResponse({...healthFixture, quantities: {heartRate: {value: '199', unit: 'count/min'}}})))

    const promise = fetchArtifact('health')
    await vi.runAllTimersAsync()

    expect(await promise).toEqual({status: 'failed', reason: 'Invalid /health.json payload'})
  })

  it('rejects a body that is missing a required field', async () => {
    const {date: _date, ...withoutDate} = healthFixture
    vi.stubGlobal('fetch', vi.fn().mockResolvedValue(jsonResponse(withoutDate)))

    const promise = fetchArtifact('health')
    await vi.runAllTimersAsync()

    expect(await promise).toEqual({status: 'failed', reason: 'Invalid /health.json payload'})
  })

  it('rejects a 200 response whose body is not JSON at all', async () => {
    vi.stubGlobal('fetch', vi.fn().mockResolvedValue(new Response('<html>edge error</html>', {status: 200})))

    const promise = fetchArtifact('books')
    await vi.runAllTimersAsync()

    const result = await promise
    expect(result.status).toBe('failed')
  })

  it('refuses to suppress the dashboard from a malformed focus signal', async () => {
    // A 403 on a gated artifact consults focus.json to distinguish intentional hiding from a real
    // denial. A focus body that violates its contract is not evidence of hiding, so the original
    // failure stands and the dashboard is not blanked by an unreadable signal.
    const fetchMock = vi.fn().mockResolvedValueOnce(jsonResponse({message: 'forbidden'}, 403)).mockResolvedValueOnce(
      jsonResponse({generatedAt: '2026-08-27T00:00:00Z', currentFocus: 'Do Not Disturb', bogus: 1})
    )
    vi.stubGlobal('fetch', fetchMock)

    const promise = fetchArtifact('books')
    await vi.runAllTimersAsync()

    expect(await promise).toEqual({status: 'failed', reason: 'HTTP 403', httpStatus: 403})
    expect(fetchMock).toHaveBeenCalledTimes(2)
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

  it('isolates one contract violation without discarding its valid siblings', async () => {
    const fetchMock = vi.fn().mockResolvedValueOnce(jsonResponse(focusFixture)).mockResolvedValueOnce(
      jsonResponse({...healthFixture, unexpectedField: true})
    ).mockResolvedValueOnce(jsonResponse(sleepFixture)).mockResolvedValueOnce(jsonResponse(workoutsFixture)).mockResolvedValueOnce(
      jsonResponse(booksFixture)
    ).mockResolvedValueOnce(jsonResponse(githubEventsFixture)).mockResolvedValueOnce(jsonResponse(starredReposFixture)).mockResolvedValueOnce(
      jsonResponse(articlesFixture)
    ).mockResolvedValueOnce(jsonResponse(theatreFixture))
    vi.stubGlobal('fetch', fetchMock)

    const result = await fetchAllEndpoints()

    expect(result.health).toEqual({status: 'failed', reason: 'Invalid /health.json payload'})
    // A rejected artifact contributes no timestamp, so the system-status panel reports that source
    // offline instead of dating the dashboard from data the contract refused.
    expect(result.timestamps.health).toBeNull()
    expect(result.books).toEqual({status: 'ok', data: booksFixture})
    expect(result.timestamps.books).toBe('2024-01-01T00:00:00Z')
  })
})
