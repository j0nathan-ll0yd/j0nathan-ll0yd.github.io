// @vitest-environment jsdom
import {afterEach, beforeEach, describe, expect, it, vi} from 'vitest'

// Characterization test for the wiring this refactor relocated from the design
// system: live-data forwards a WebSocket 'app-update' push (and a reconnect) to
// the app-owned service-worker nudge `window.__checkForSwUpdate`, and drives the
// focus overlay + client-side suppression from the focus push/poll/startup.
// live-data.ts is a side-effecting module, so we mock its heavy collaborators and
// drive the captured WSClient callbacks.

interface CapturedWsOpts {
  onAppUpdate?: (build?: string) => void
  onStateChange?: (connected: boolean) => void
  onFocusChange?: (currentFocus: string) => void
}
let wsOpts: CapturedWsOpts | null = null

vi.mock('../../src/lib/runtime/ws-client', () => ({
  WSClient: class {
    constructor(opts: CapturedWsOpts) {
      wsOpts = opts
    }
    connect(): void {}
    disconnect(): void {}
  }
}))

// Engine method spies, so the focus-suppression wiring (setSuppressed / pollNow) is assertable.
const engineSpies = vi.hoisted(() => ({
  setSuppressed: vi.fn<(v: boolean) => void>(),
  pollNow: vi.fn<() => Promise<void>>(() => Promise.resolve()),
  pollResource: vi.fn<() => Promise<void>>(() => Promise.resolve())
}))

// Captures the engine's onUpdate (handleResourceUpdate) so a test can simulate a poll result.
const engineCapture = vi.hoisted(() => ({onUpdate: null as null | ((key: string, data: unknown) => void)}))

vi.mock('../../src/lib/runtime/poll-engine', () => ({
  PollEngine: class {
    constructor(opts: {onUpdate: (key: string, data: unknown) => void}) {
      engineCapture.onUpdate = opts.onUpdate
    }
    seed(): void {}
    start(): void {}
    setMode(): void {}
    setSuppressed = engineSpies.setSuppressed
    pollNow = engineSpies.pollNow
    pollResource = engineSpies.pollResource
  }
}))

// fetchWithTimeout is the focus-signal fetch at startup; a hoisted spy (default null)
// lets a test resolve a hiding focus to exercise the load-during-hiding path.
const fetchSpy = vi.hoisted(() => vi.fn<() => Promise<unknown>>(() => Promise.resolve(null)))

vi.mock('../../src/lib/runtime/api',
  () => ({
    fetchWithTimeout: fetchSpy,
    fetchAllEndpoints: () =>
      Promise.resolve({
        health: null,
        sleep: null,
        workouts: null,
        books: null,
        githubEvents: null,
        starredRepos: null,
        articles: null,
        focus: null,
        theatreReviews: null,
        timestamps: {}
      })
  }))

vi.mock('@lifegames/portal-contract/constants', async (importActual) => {
  // Pull the REAL cross-platform constants (HIDING_FOCUS_MODES, FOCUS_MODES) from the
  // contract so this test enforces the single source of truth instead of duplicating it —
  // a hardcoded copy here would pass even if the contract's hiding modes changed. Only the
  // network URLs + endpoint paths are overridden with test doubles.
  const actual = await importActual<typeof import('@lifegames/portal-contract/constants')>()
  return {
    ...actual,
    CLOUDFRONT_BASE: 'https://mock.cloudfront.net',
    WEBSOCKET_URL: 'wss://mock.example.com/live',
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

type SwWindow = Window & {__checkForSwUpdate?: () => void}

function clearSpies(): void {
  engineSpies.setSuppressed.mockClear()
  engineSpies.pollNow.mockClear()
  engineSpies.pollResource.mockClear()
  fetchSpy.mockClear()
}

async function bootLiveData(): Promise<void> {
  await import('../../src/lib/runtime/live-data')
  await vi.runAllTimersAsync() // flush the deferred startFetch + awaited fetches
}

describe('live-data → service-worker nudge wiring', () => {
  beforeEach(() => {
    wsOpts = null
    vi.resetModules()
    vi.useFakeTimers()
    document.body.innerHTML = ''
    clearSpies()
  })

  afterEach(() => {
    vi.useRealTimers()
    delete (window as SwWindow).__checkForSwUpdate
  })

  it('invokes window.__checkForSwUpdate on an app-update push', async () => {
    const nudge = vi.fn()
    ;(window as SwWindow).__checkForSwUpdate = nudge

    await bootLiveData()

    expect(wsOpts).not.toBeNull()
    expect(typeof wsOpts?.onAppUpdate).toBe('function')
    wsOpts?.onAppUpdate?.('deadbeef')
    expect(nudge).toHaveBeenCalledTimes(1)
  })

  it('re-checks on WebSocket (re)connect to catch a missed push', async () => {
    const nudge = vi.fn()
    ;(window as SwWindow).__checkForSwUpdate = nudge

    await bootLiveData()

    wsOpts?.onStateChange?.(true)
    expect(nudge).toHaveBeenCalledTimes(1)
  })

  it('is a no-op when the service-worker hook is absent', async () => {
    await bootLiveData()
    expect(() => wsOpts?.onAppUpdate?.()).not.toThrow()
  })
})

describe('live-data → focus overlay + suppression wiring', () => {
  beforeEach(() => {
    wsOpts = null
    vi.resetModules()
    vi.useFakeTimers()
    clearSpies()
    // Overlays so the (real) updateFocusOverlay can toggle them.
    document.body.innerHTML = '<div id="focusOverlay" style="display:none"></div>' + '<div id="dndOverlay" style="display:none"></div>'
  })

  afterEach(() => {
    vi.useRealTimers()
  })

  it('shows the overlay immediately from a focus push (no refetch) and suppresses polling', async () => {
    await bootLiveData()
    engineSpies.setSuppressed.mockClear() // discard the startup setSuppressed(false)

    wsOpts?.onFocusChange?.('Do Not Disturb')

    expect(document.getElementById('dndOverlay')?.style.display).toBe('flex')
    expect(engineSpies.setSuppressed).toHaveBeenCalledWith(true)
    // Cards are deliberately NOT re-skeletoned (the overlay covers them); re-skeletoning
    // would strand any unchanged card in its skeleton after restore (pollNow fingerprint skip).
    expect(engineSpies.pollNow).not.toHaveBeenCalled()
  })

  it('restores on exit: hides the overlay, clears suppression, and refetches all', async () => {
    await bootLiveData()
    wsOpts?.onFocusChange?.('Do Not Disturb')
    engineSpies.setSuppressed.mockClear()
    engineSpies.pollNow.mockClear()

    wsOpts?.onFocusChange?.('Personal')

    expect(document.getElementById('dndOverlay')?.style.display).toBe('none')
    expect(engineSpies.setSuppressed).toHaveBeenCalledWith(false)
    expect(engineSpies.pollNow).toHaveBeenCalledTimes(1)
  })

  it('swaps Work→DND overlays without re-toggling suppression (still hiding)', async () => {
    await bootLiveData()
    wsOpts?.onFocusChange?.('Work')
    expect(document.getElementById('focusOverlay')?.style.display).toBe('flex')
    engineSpies.setSuppressed.mockClear()

    wsOpts?.onFocusChange?.('Do Not Disturb')

    expect(document.getElementById('focusOverlay')?.style.display).toBe('none')
    expect(document.getElementById('dndOverlay')?.style.display).toBe('flex')
    expect(engineSpies.setSuppressed).not.toHaveBeenCalled()
  })

  // Load-during-hiding: opening the dashboard while focus is ALREADY a hiding mode. applyFocus
  // runs before the engine exists, so suppression must be propagated via the post-seed
  // engine.setSuppressed(suppressed), and the skeletons must be retained (endpoints 403).
  it('loads directly into suppression when focus is already a hiding mode at startup', async () => {
    document.body.innerHTML += '<div id="cardHR" class="is-loading"></div>'
    fetchSpy.mockResolvedValueOnce({generatedAt: '2026-01-01T00:00:00Z', currentFocus: 'Do Not Disturb'})

    await bootLiveData()

    expect(engineSpies.setSuppressed).toHaveBeenCalledWith(true)
    expect(document.getElementById('dndOverlay')?.style.display).toBe('flex')
    // Skeletons stay while suppressed — the 403'd endpoints have no real data to reveal.
    expect(document.getElementById('cardHR')?.classList.contains('is-loading')).toBe(true)
  })

  it('ignores a stale focus poll that contradicts the latest push while the WS is connected', async () => {
    await bootLiveData()
    wsOpts?.onStateChange?.(true) // WS live → the focus poll is fallback-only

    wsOpts?.onFocusChange?.('Do Not Disturb')
    wsOpts?.onFocusChange?.('None') // restore via push clears the overlay
    expect(document.getElementById('dndOverlay')?.style.display).toBe('none')
    engineSpies.setSuppressed.mockClear()

    // The ~30s edge-cached focus.json still reports the OLD hiding value on the next poll.
    engineCapture.onUpdate?.('focus', {generatedAt: '2026-01-01T00:00:00Z', currentFocus: 'Do Not Disturb'})

    // Must NOT re-show the overlay or re-suppress — this was the restore-linger bug.
    expect(document.getElementById('dndOverlay')?.style.display).toBe('none')
    expect(engineSpies.setSuppressed).not.toHaveBeenCalled()
  })

  it('still applies a focus poll when the WS is down (poll is the fallback)', async () => {
    await bootLiveData()
    wsOpts?.onStateChange?.(false) // WS down → the poll drives focus

    engineCapture.onUpdate?.('focus', {generatedAt: '2026-01-01T00:00:00Z', currentFocus: 'Do Not Disturb'})

    expect(document.getElementById('dndOverlay')?.style.display).toBe('flex')
    expect(engineSpies.setSuppressed).toHaveBeenCalledWith(true)
  })

  it('trusts the focus poll again after the propagation window (dropped-push self-heal)', async () => {
    await bootLiveData()
    wsOpts?.onStateChange?.(true)
    wsOpts?.onFocusChange?.('Do Not Disturb') // enter hiding via push; the ignore-window opens
    expect(document.getElementById('dndOverlay')?.style.display).toBe('flex')
    engineSpies.setSuppressed.mockClear()

    // The user exits to None but the WS push is DROPPED — only the poll sees it. Within the
    // window the poll is ignored; once the window elapses it must be trusted so the overlay
    // does not stay stuck forever on the stale hiding value.
    engineCapture.onUpdate?.('focus', {generatedAt: '2026-01-01T00:00:01Z', currentFocus: 'None'})
    expect(document.getElementById('dndOverlay')?.style.display).toBe('flex') // still ignored (in window)

    vi.advanceTimersByTime(46_000) // past STALE_FOCUS_POLL_WINDOW_MS
    engineCapture.onUpdate?.('focus', {generatedAt: '2026-01-01T00:00:02Z', currentFocus: 'None'})

    expect(document.getElementById('dndOverlay')?.style.display).toBe('none') // self-healed
    expect(engineSpies.setSuppressed).toHaveBeenCalledWith(false)
  })
})
