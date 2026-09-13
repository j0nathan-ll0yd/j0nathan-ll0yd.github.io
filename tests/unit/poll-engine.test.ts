// @vitest-environment jsdom
import {afterEach, beforeEach, describe, expect, it, vi} from 'vitest'
import {PollEngine} from '../../src/lib/runtime/poll-engine'
import {ENDPOINTS, type ResourceKey} from '@j0nathan-ll0yd/portal-contract/constants'

// Mock constants module
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

function makeFetchResponse(data: unknown, ok = true, status = 200) {
  return {ok, status, json: () => Promise.resolve(data)}
}

// Poll responses are decoded against the producer's published export schemas before the engine
// sees them, so every payload below is one the producer could legally publish. The previous
// stand-ins (`{generatedAt, value: 42}`) were accepted only by the unchecked cast this change
// removed; they are corrected here rather than the decoding being relaxed to keep them.
const RESOURCE_BODIES: Record<ResourceKey, Record<string, unknown>> = {
  health: {date: '2024-01-01', quantities: {}},
  sleep: {date: '2024-01-01'},
  workouts: {date: '2024-01-01', workouts: []},
  books: {books: []},
  starredRepos: {repos: []},
  githubEvents: {events: []},
  articles: {articles: []},
  focus: {currentFocus: 'Personal'},
  theatreReviews: {source: 'coasttocoastreviews.com', totalReviews: 0, reviews: []}
}

const RESOURCE_KEYS = Object.keys(RESOURCE_BODIES) as ResourceKey[]

/** A schema-valid body for `key`, stamped with `generatedAt` so fingerprint behavior stays testable. */
function body(key: ResourceKey, generatedAt: string, overrides: Record<string, unknown> = {}): Record<string, unknown> {
  return {generatedAt, ...RESOURCE_BODIES[key], ...overrides}
}

/** A fetch double that answers every endpoint with a schema-valid body for that resource. */
function fetchEveryResource(generatedAt: string) {
  return vi.fn().mockImplementation((url: string) => {
    const key = RESOURCE_KEYS.find((candidate) => url.includes(ENDPOINTS[candidate]))
    return Promise.resolve(key ? makeFetchResponse(body(key, generatedAt)) : makeFetchResponse(null, false, 404))
  })
}

describe('PollEngine', () => {
  let onUpdate: ReturnType<typeof vi.fn>
  let onError: ReturnType<typeof vi.fn>
  let onSuppressed: ReturnType<typeof vi.fn>
  let onStatusChange: ReturnType<typeof vi.fn>
  let engine: PollEngine

  beforeEach(() => {
    vi.useFakeTimers()
    onUpdate = vi.fn()
    onError = vi.fn()
    onSuppressed = vi.fn()
    onStatusChange = vi.fn()
    vi.stubGlobal('fetch', vi.fn())
    Object.defineProperty(navigator, 'onLine', {value: true, configurable: true})
    engine = new PollEngine({onUpdate, onError, onSuppressed, onStatusChange})
  })

  afterEach(() => {
    engine.stop()
    vi.useRealTimers()
    vi.unstubAllGlobals()
  })

  describe('constructor', () => {
    it('creates engine without throwing', () => {
      expect(engine).toBeDefined()
    })

    it('getStatus() returns disconnected initially', () => {
      const status = engine.getStatus()
      expect(status.connected).toBe(false)
      expect(status.lastPollAt).toBeNull()
      expect(status.errorCounts).toEqual({})
      expect(status.wsConnected).toBe(false)
    })
  })

  describe('seed()', () => {
    it('seeds fingerprints so unchanged data is skipped', async () => {
      const fetchMock = vi.fn().mockResolvedValue(makeFetchResponse(body('health', '2024-01-01T00:00:00Z')))
      vi.stubGlobal('fetch', fetchMock)

      engine.seed({health: '2024-01-01T00:00:00Z'})
      await engine.pollResource('health')

      // onUpdate should NOT be called because fingerprint matches
      expect(onUpdate).not.toHaveBeenCalled()
    })

    it('ignores null values in seed timestamps', () => {
      engine.seed({health: null as unknown as string, sleep: '2024-01-01T00:00:00Z'})
      // No error thrown; null values are skipped
      expect(engine.getStatus().errorCounts).toEqual({})
    })
  })

  describe('start()', () => {
    it('sets connected=true after start when online', () => {
      engine.start()
      expect(engine.getStatus().connected).toBe(true)
    })

    it('is idempotent — calling start() twice does not double-register timers', () => {
      engine.start()
      engine.start()
      expect(onStatusChange).toHaveBeenCalledTimes(1)
    })

    it('emits status on start', () => {
      engine.start()
      expect(onStatusChange).toHaveBeenCalledOnce()
    })
  })

  describe('stop()', () => {
    it('sets connected=false after stop', () => {
      engine.start()
      engine.stop()
      expect(engine.getStatus().connected).toBe(false)
    })

    it('emits status on stop', () => {
      engine.start()
      onStatusChange.mockClear()
      engine.stop()
      expect(onStatusChange).toHaveBeenCalledOnce()
    })

    it('cleans up visibilitychange listener on stop', () => {
      const removeSpy = vi.spyOn(document, 'removeEventListener')
      engine.start()
      engine.stop()
      expect(removeSpy).toHaveBeenCalledWith('visibilitychange', expect.any(Function))
    })
  })

  describe('setMode()', () => {
    it('setMode("passive") sets wsConnected=true', () => {
      engine.setMode('passive')
      expect(engine.getStatus().wsConnected).toBe(true)
    })

    it('setMode("active") sets wsConnected=false', () => {
      engine.setMode('passive')
      engine.setMode('active')
      expect(engine.getStatus().wsConnected).toBe(false)
    })

    it('calling setMode with the same mode is a no-op', () => {
      engine.setMode('active') // already active by default
      expect(onStatusChange).not.toHaveBeenCalled()
    })

    it('passive mode uses longer intervals (120s fast, 300s slow)', () => {
      const fetchMock = fetchEveryResource('2024-01-01T00:00:00Z')
      vi.stubGlobal('fetch', fetchMock)

      engine.start()
      engine.setMode('passive')
      fetchMock.mockClear()

      // At 30s (active fast interval) — should NOT fire in passive mode
      vi.advanceTimersByTime(30_000)
      expect(fetchMock).not.toHaveBeenCalled()

      // At 120s — passive fast interval fires
      vi.advanceTimersByTime(90_000)
      expect(fetchMock).toHaveBeenCalled()
    })

    it('active mode uses shorter intervals (30s fast)', () => {
      const fetchMock = fetchEveryResource('2024-01-01T00:00:00Z')
      vi.stubGlobal('fetch', fetchMock)

      engine.start()
      vi.advanceTimersByTime(30_000)
      expect(fetchMock).toHaveBeenCalled()
    })
  })

  describe('fetchResource()', () => {
    it('calls onUpdate with new data when fingerprint differs', async () => {
      const fresh = body('health', '2024-01-02T00:00:00Z', {quantities: {heartRate: {value: 42, unit: 'count/min'}}})
      const fetchMock = vi.fn().mockResolvedValue(makeFetchResponse(fresh))
      vi.stubGlobal('fetch', fetchMock)

      engine.seed({health: '2024-01-01T00:00:00Z'})
      await engine.pollResource('health')

      expect(onUpdate).toHaveBeenCalledWith('health', fresh)
    })

    it('skips onUpdate when fingerprint is unchanged', async () => {
      const ts = '2024-01-01T00:00:00Z'
      vi.stubGlobal('fetch', vi.fn().mockResolvedValue(makeFetchResponse(body('health', ts))))

      engine.seed({health: ts})
      await engine.pollResource('health')

      expect(onUpdate).not.toHaveBeenCalled()
    })

    it('calls onError on HTTP error (non-ok response)', async () => {
      vi.stubGlobal('fetch', vi.fn().mockResolvedValue(makeFetchResponse(null, false, 500)))

      await engine.pollResource('health')

      expect(onError).toHaveBeenCalledWith('health', expect.objectContaining({message: 'HTTP 500'}))
    })

    it('calls onError on network error', async () => {
      vi.stubGlobal('fetch', vi.fn().mockRejectedValue(new Error('Network failure')))

      await engine.pollResource('health')

      expect(onError).toHaveBeenCalledWith('health', expect.objectContaining({message: 'Network failure'}))
    })

    it('increments errorCounts on repeated errors', async () => {
      vi.stubGlobal('fetch', vi.fn().mockRejectedValue(new Error('fail')))

      await engine.pollResource('health')
      await engine.pollResource('health')

      expect(engine.getStatus().errorCounts.health).toBe(2)
    })

    it('clears errorCounts on successful fetch', async () => {
      vi.stubGlobal('fetch',
        vi.fn().mockRejectedValueOnce(new Error('fail')).mockResolvedValueOnce(makeFetchResponse(body('health', '2024-01-02T00:00:00Z'))))

      await engine.pollResource('health')
      expect(engine.getStatus().errorCounts.health).toBe(1)

      await engine.pollResource('health')
      expect(engine.getStatus().errorCounts.health).toBeUndefined()
    })

    it('updates lastPollAt after a poll', async () => {
      vi.stubGlobal('fetch', vi.fn().mockResolvedValue(makeFetchResponse(body('health', '2024-01-01T00:00:00Z'))))

      expect(engine.getStatus().lastPollAt).toBeNull()
      await engine.pollResource('health')
      expect(engine.getStatus().lastPollAt).not.toBeNull()
    })

    it('issues no request for an inherited property name', async () => {
      // End-to-end through the real engine and the real fetch path: a key that survived the old
      // prototype-inclusive admission check produced a request built from `ENDPOINTS.constructor`,
      // which is a function rather than a path. No request may leave the browser for it.
      const fetchMock = vi.fn()
      vi.stubGlobal('fetch', fetchMock)

      await engine.pollResource('constructor' as never)

      expect(fetchMock).not.toHaveBeenCalled()
      expect(onUpdate).not.toHaveBeenCalled()
    })

    it('records a poll body that violates its contract as an error and dispatches no update', async () => {
      // The export schemas forbid unmapped properties, so this body is one the producer could not
      // have published. It must never reach an updater as fresh data: a poll that cannot be decoded
      // is an error, and the retained on-screen values stay in place.
      const fetchMock = vi.fn().mockResolvedValue(makeFetchResponse(body('health', '2024-01-02T00:00:00Z', {unexpectedField: true})))
      vi.stubGlobal('fetch', fetchMock)

      engine.seed({health: '2024-01-01T00:00:00Z'})
      await engine.pollResource('health')

      expect(onUpdate).not.toHaveBeenCalled()
      expect(onError).toHaveBeenCalledWith('health', expect.objectContaining({message: 'Invalid /health.json payload'}))
      expect(engine.getStatus().errorCounts.health).toBe(1)
    })

    it('does not advance the fingerprint past a rejected body', async () => {
      // A rejected payload must not be remembered as seen: the next valid publication carrying the
      // same timestamp has to be dispatched, not skipped as unchanged.
      const rejected = body('health', '2024-01-02T00:00:00Z', {unexpectedField: true})
      const accepted = body('health', '2024-01-02T00:00:00Z')
      vi.stubGlobal('fetch', vi.fn().mockResolvedValueOnce(makeFetchResponse(rejected)).mockResolvedValueOnce(makeFetchResponse(accepted)))

      await engine.pollResource('health')
      await engine.pollResource('health')

      expect(onUpdate).toHaveBeenCalledOnce()
      expect(onUpdate).toHaveBeenCalledWith('health', accepted)
    })
  })

  describe('setSuppressed()', () => {
    it('recognizes a suppression response, pauses gated polling, and emits no poll error', async () => {
      const fetchMock = vi.fn().mockResolvedValue(makeFetchResponse({suppressed: true, reason: 'focus mode active'}, false, 503))
      vi.stubGlobal('fetch', fetchMock)

      await engine.pollResource('health')
      await engine.pollResource('books')

      expect(fetchMock).toHaveBeenCalledOnce()
      expect(onSuppressed).toHaveBeenCalledWith({status: 'suppressed', reason: 'focus mode active'})
      expect(onError).not.toHaveBeenCalled()
      expect(onUpdate).not.toHaveBeenCalled()
    })

    it('skips a gated resource while suppressed (no fetch, no update)', async () => {
      const fetchMock = vi.fn().mockResolvedValue(makeFetchResponse(body('health', '2024-01-02T00:00:00Z')))
      vi.stubGlobal('fetch', fetchMock)

      engine.setSuppressed(true)
      await engine.pollResource('health')

      expect(fetchMock).not.toHaveBeenCalled()
      expect(onUpdate).not.toHaveBeenCalled()
    })

    it('keeps polling focus while suppressed (overlay fallback is never gated)', async () => {
      const fetchMock = vi.fn().mockResolvedValue(makeFetchResponse(body('focus', '2024-01-02T00:00:00Z', {currentFocus: 'Do Not Disturb'})))
      vi.stubGlobal('fetch', fetchMock)

      engine.setSuppressed(true)
      await engine.pollResource('focus')

      expect(fetchMock).toHaveBeenCalledTimes(1)
      expect(onUpdate).toHaveBeenCalledWith('focus', expect.objectContaining({currentFocus: 'Do Not Disturb'}))
    })

    it('resumes gated polling once suppression is cleared', async () => {
      const restored = body('health', '2024-01-02T00:00:00Z')
      const fetchMock = vi.fn().mockResolvedValue(makeFetchResponse(restored))
      vi.stubGlobal('fetch', fetchMock)

      engine.setSuppressed(true)
      await engine.pollResource('health')
      expect(fetchMock).not.toHaveBeenCalled()

      engine.setSuppressed(false)
      await engine.pollResource('health')
      expect(fetchMock).toHaveBeenCalledTimes(1)
      expect(onUpdate).toHaveBeenCalledWith('health', restored)
    })

    it('pollNow() fetches every resource once suppression is cleared', async () => {
      const fetchMock = fetchEveryResource('2024-01-02T00:00:00Z')
      vi.stubGlobal('fetch', fetchMock)

      engine.setSuppressed(false)
      await engine.pollNow()

      // FAST (health, sleep, workouts, focus) + SLOW (books, articles, githubEvents,
      // starredRepos, theatreReviews) = 9 resources.
      expect(fetchMock.mock.calls.length).toBeGreaterThanOrEqual(9)
      // Each of the nine decoded through its own contract: a key whose schema mapping regressed
      // would surface here as a missing update, not as a silently unvalidated payload.
      expect(onError).not.toHaveBeenCalled()
      expect(onUpdate.mock.calls.map((call) => call[0]).sort()).toEqual([...RESOURCE_KEYS].sort())
    })
  })

  describe('getStatus()', () => {
    it('returns correct shape', () => {
      const status = engine.getStatus()
      expect(status).toHaveProperty('connected')
      expect(status).toHaveProperty('lastPollAt')
      expect(status).toHaveProperty('errorCounts')
      expect(status).toHaveProperty('wsConnected')
    })

    it('connected reflects navigator.onLine', () => {
      engine.start()
      Object.defineProperty(navigator, 'onLine', {value: false, configurable: true})
      expect(engine.getStatus().connected).toBe(false)
    })
  })

  describe('visibility change', () => {
    it('pauses timers when document becomes hidden', () => {
      const fetchMock = fetchEveryResource('2024-01-01T00:00:00Z')
      vi.stubGlobal('fetch', fetchMock)

      engine.start()

      // Simulate tab hidden
      Object.defineProperty(document, 'hidden', {value: true, configurable: true})
      document.dispatchEvent(new Event('visibilitychange'))

      fetchMock.mockClear()
      vi.advanceTimersByTime(60_000)
      expect(fetchMock).not.toHaveBeenCalled()
    })

    it('resumes and immediately polls when document becomes visible', async () => {
      const fetchMock = fetchEveryResource('2024-01-01T00:00:00Z')
      vi.stubGlobal('fetch', fetchMock)

      engine.start()

      // Hide then show
      Object.defineProperty(document, 'hidden', {value: true, configurable: true})
      document.dispatchEvent(new Event('visibilitychange'))

      fetchMock.mockClear()

      Object.defineProperty(document, 'hidden', {value: false, configurable: true})
      document.dispatchEvent(new Event('visibilitychange'))

      // Flush microtasks so the async pollNow() call can initiate fetches
      await Promise.resolve()
      await Promise.resolve()

      expect(fetchMock).toHaveBeenCalled()
    })
  })
})
