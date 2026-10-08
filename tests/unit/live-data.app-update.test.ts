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
  onUpdate?: (resource: string) => void
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
  pollResource: vi.fn<() => Promise<void>>(() => Promise.resolve()),
  forgetFingerprints: vi.fn<(keys?: string[]) => void>(),
  seed: vi.fn<(timestamps: Record<string, string | null>) => void>()
}))

// Captures the engine's onUpdate (handleResourceUpdate) so a test can simulate a poll result.
const engineCapture = vi.hoisted(() => ({
  onUpdate: null as null | ((key: string, data: unknown) => void),
  onSuppressed: null as null | ((result: {status: 'suppressed'; reason: string; currentFocus?: string}) => void)
}))

vi.mock('../../src/lib/runtime/poll-engine', () => ({
  PollEngine: class {
    constructor(opts: {onUpdate: (key: string, data: unknown) => void; onSuppressed?: typeof engineCapture.onSuppressed}) {
      engineCapture.onUpdate = opts.onUpdate
      engineCapture.onSuppressed = opts.onSuppressed ?? null
    }
    seed = engineSpies.seed
    start(): void {}
    setMode(): void {}
    setSuppressed = engineSpies.setSuppressed
    pollNow = engineSpies.pollNow
    pollResource = engineSpies.pollResource
    forgetFingerprints = engineSpies.forgetFingerprints
  }
}))

// fetchArtifact is the focus-signal fetch at startup; a hoisted spy (default null)
// lets a test resolve a hiding focus to exercise the load-during-hiding path.
const fetchSpy = vi.hoisted(() => vi.fn<() => Promise<unknown>>(() => Promise.resolve({status: 'failed', reason: 'fixture unavailable'})))

// The aggregate startup read. Every artifact fails by default; a test overrides it to put gated
// data (or a gate suppression) on the page at load.
const failedResult = {status: 'failed', reason: 'fixture unavailable'}
const allFailed = () => ({
  health: failedResult,
  sleep: failedResult,
  workouts: failedResult,
  books: failedResult,
  githubEvents: failedResult,
  starredRepos: failedResult,
  articles: failedResult,
  focus: failedResult,
  theatreReviews: failedResult,
  timestamps: {} as Record<string, string | null>
})
const fetchAllSpy = vi.hoisted(() => vi.fn<() => Promise<unknown>>())

// The real module is spread in so `isResourceKey` stays the shipped implementation: the
// WebSocket admission test below must exercise the actual predicate, not a double of it.
vi.mock('../../src/lib/runtime/api',
  async (importActual) => ({...await importActual<typeof import('../../src/lib/runtime/api')>(), fetchArtifact: fetchSpy, fetchAllEndpoints: fetchAllSpy}))

vi.mock('@j0nathan-ll0yd/portal-contract/constants', async (importActual) => {
  // Pull the REAL cross-platform constants (HIDING_FOCUS_MODES, FOCUS_MODES) from the
  // contract so this test enforces the single source of truth instead of duplicating it —
  // a hardcoded copy here would pass even if the contract's hiding modes changed. Only the
  // network URLs + endpoint paths are overridden with test doubles.
  const actual = await importActual<typeof import('@j0nathan-ll0yd/portal-contract/constants')>()
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
  engineSpies.forgetFingerprints.mockClear()
  engineSpies.seed.mockClear()
  fetchSpy.mockClear()
  fetchAllSpy.mockReset()
  fetchAllSpy.mockImplementation(() => Promise.resolve(allFailed()))
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

describe('live-data → WebSocket resource-update admission', () => {
  beforeEach(() => {
    wsOpts = null
    vi.resetModules()
    vi.useFakeTimers()
    document.body.innerHTML = ''
    clearSpies()
  })

  afterEach(() => {
    vi.useRealTimers()
  })

  it('refetches the resource named by a published-key push', async () => {
    await bootLiveData()

    wsOpts?.onUpdate?.('books')

    expect(engineSpies.pollResource).toHaveBeenCalledWith('books')
  })

  // The socket is an untrusted input. `resource in ENDPOINTS` was prototype-inclusive, so a frame
  // naming an inherited property passed the admission check and reached the fetch path with a key
  // that has no endpoint. Own-property narrowing must drop these frames silently and completely.
  it.each(['constructor', 'toString', 'valueOf', '__proto__', 'hasOwnProperty'])('ignores a push naming the inherited property %s', async (resource) => {
    await bootLiveData()

    wsOpts?.onUpdate?.(resource)

    expect(engineSpies.pollResource).not.toHaveBeenCalled()
  })

  it('ignores a push naming a resource that does not exist', async () => {
    await bootLiveData()

    wsOpts?.onUpdate?.('not-a-resource')

    expect(engineSpies.pollResource).not.toHaveBeenCalled()
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
  // engine.setSuppressed(suppressed), while the SSR shell is exposed under the opaque overlay.
  it('loads directly into suppression when focus is already a hiding mode at startup', async () => {
    document.body.innerHTML += '<div id="cardHR" class="is-loading"></div>'
    fetchSpy.mockResolvedValueOnce({status: 'ok', data: {generatedAt: '2026-01-01T00:00:00Z', currentFocus: 'Do Not Disturb'}})

    await bootLiveData()

    expect(engineSpies.setSuppressed).toHaveBeenCalledWith(true)
    expect(document.getElementById('dndOverlay')?.style.display).toBe('flex')
    expect(document.getElementById('cardHR')?.classList.contains('is-loading')).toBe(false)
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

// Atlas decision 0160, PR 0b: entering a hiding mode must REMOVE gated values, not cover them. The
// mechanism is a page reload, guarded so it fires only when gated data reached this document.
describe('live-data → clearing gated values on suppression', () => {
  const booksExport = {generatedAt: '2026-01-01T00:00:00Z', books: []}
  const originalLocation = window.location
  const reload = vi.fn()

  beforeEach(() => {
    wsOpts = null
    vi.resetModules()
    vi.useFakeTimers()
    clearSpies()
    reload.mockClear()
    document.body.innerHTML = '<div id="focusOverlay" style="display:none"></div>' + '<div id="dndOverlay" style="display:none"></div>'
    Object.defineProperty(window, 'location', {configurable: true, value: {...originalLocation, reload}})
  })

  afterEach(() => {
    vi.useRealTimers()
    Object.defineProperty(window, 'location', {configurable: true, value: originalLocation})
  })

  it('reloads when a hiding push arrives after gated data was applied by a poll', async () => {
    await bootLiveData()
    engineCapture.onUpdate?.('books', booksExport)

    wsOpts?.onFocusChange?.('Do Not Disturb')

    expect(reload).toHaveBeenCalledOnce()
  })

  it('reloads when a hiding push arrives after gated data was applied at startup', async () => {
    fetchAllSpy.mockResolvedValueOnce({...allFailed(), books: {status: 'ok', data: booksExport}, timestamps: {books: booksExport.generatedAt}})
    await bootLiveData()

    wsOpts?.onFocusChange?.('Work')

    expect(reload).toHaveBeenCalledOnce()
  })

  it('never reloads a document that holds no gated value (the loop guard)', async () => {
    await bootLiveData()

    wsOpts?.onFocusChange?.('Do Not Disturb')
    wsOpts?.onFocusChange?.('None')
    wsOpts?.onFocusChange?.('Work')

    expect(reload).not.toHaveBeenCalled()
  })

  it('does not reload a page that loaded during hiding, and restores every resource on exit', async () => {
    fetchSpy.mockResolvedValueOnce({
      status: 'ok',
      data: {generatedAt: '2026-01-01T00:00:00Z', currentFocus: 'Do Not Disturb', hidingSince: '2026-01-01T00:00:00Z'}
    })
    await bootLiveData()
    expect(reload).not.toHaveBeenCalled()

    wsOpts?.onFocusChange?.('None')

    // Every fingerprint is forgotten BEFORE the refetch, so unchanged exports are applied again.
    expect(engineSpies.forgetFingerprints).toHaveBeenCalledWith()
    expect(engineSpies.pollNow).toHaveBeenCalledOnce()
    expect(engineSpies.forgetFingerprints.mock.invocationCallOrder[0]).toBeLessThan(engineSpies.pollNow.mock.invocationCallOrder[0])
    expect(reload).not.toHaveBeenCalled()
  })

  it('drops a gated poll result that lands while suppressed', async () => {
    await bootLiveData()
    wsOpts?.onFocusChange?.('Do Not Disturb')

    // A read that was in flight when hiding began resolves now. It must not reach the page.
    engineCapture.onUpdate?.('books', booksExport)
    wsOpts?.onFocusChange?.('None')
    wsOpts?.onFocusChange?.('Do Not Disturb')

    expect(reload).not.toHaveBeenCalled()
  })

  it('withholds every gated value at startup when any gated path answers with a suppression body', async () => {
    fetchSpy.mockResolvedValueOnce({status: 'ok', data: {generatedAt: '2026-01-01T00:00:00Z', currentFocus: 'None'}})
    fetchAllSpy.mockResolvedValueOnce({
      ...allFailed(),
      books: {status: 'ok', data: booksExport},
      health: {status: 'suppressed', reason: 'focus mode active'},
      timestamps: {books: booksExport.generatedAt}
    })
    await bootLiveData()

    expect(engineSpies.setSuppressed).toHaveBeenLastCalledWith(true)

    // The 200 sibling was never applied, so a later hiding transition has nothing to clear.
    wsOpts?.onFocusChange?.('None')
    wsOpts?.onFocusChange?.('Work')
    expect(reload).not.toHaveBeenCalled()
  })

  it('reloads when a poll meets the gate after gated data was applied', async () => {
    await bootLiveData()
    engineCapture.onUpdate?.('books', booksExport)

    // The engine reports a gate suppression body with no focus value: gate shut over a visible signal.
    engineCapture.onSuppressed?.({status: 'suppressed', reason: 'focus mode active'})

    expect(reload).toHaveBeenCalledOnce()
  })
})

// Recovery from a gate denial under a VISIBLE focus signal (gate shut over a visible signal, or an
// edge that has not converged after unhide). The engine keeps dispatching focus answers while
// suppressed; live-data lifts gate suppression at most once per re-check interval.
describe('live-data → recovery from gate suppression', () => {
  const visible = (generatedAt = '2026-01-01T00:00:00Z') => ({generatedAt, currentFocus: 'None'})

  beforeEach(() => {
    wsOpts = null
    vi.resetModules()
    vi.useFakeTimers()
    clearSpies()
    document.body.innerHTML = '<div id="focusOverlay" style="display:none"></div>' + '<div id="dndOverlay" style="display:none"></div>'
  })

  afterEach(() => {
    vi.useRealTimers()
  })

  it('ignores a visible focus answer that races a fresh gate denial, then re-asks the gate on a later poll', async () => {
    await bootLiveData()
    engineCapture.onSuppressed?.({status: 'suppressed', reason: 'focus mode active'})
    engineSpies.setSuppressed.mockClear()
    engineSpies.pollNow.mockClear()

    engineCapture.onUpdate?.('focus', visible())
    expect(engineSpies.setSuppressed).not.toHaveBeenCalled()
    expect(engineSpies.pollNow).not.toHaveBeenCalled()

    vi.advanceTimersByTime(30_000) // the next fast poll tick
    engineCapture.onUpdate?.('focus', visible())
    expect(engineSpies.setSuppressed).toHaveBeenCalledWith(false)
    expect(engineSpies.forgetFingerprints).toHaveBeenCalledWith()
    expect(engineSpies.pollNow).toHaveBeenCalledOnce()
  })

  // This suite mocks the engine, so it guards only the live-data half of H1 (the window and the
  // re-check interval). The engine half -- dispatching an unchanged focus answer while suppressed --
  // is guarded by 'dispatches an unchanged focus answer while suppressed' in poll-engine.test.ts.
  it('recovers after a visible push whose own refetch met a lagging gate (adversarial review H1)', async () => {
    await bootLiveData()
    wsOpts?.onStateChange?.(true)
    wsOpts?.onFocusChange?.('Do Not Disturb')
    wsOpts?.onFocusChange?.('None') // restore push: lift, forget, pollNow
    engineCapture.onSuppressed?.({status: 'suppressed', reason: 'focus mode active'}) // a lagging edge 403s
    engineCapture.onUpdate?.('focus', visible()) // inside the post-push window: ignored
    engineSpies.setSuppressed.mockClear()

    vi.advanceTimersByTime(30_000)
    engineCapture.onUpdate?.('focus', visible()) // still inside the 45 s window
    expect(engineSpies.setSuppressed).not.toHaveBeenCalled()

    vi.advanceTimersByTime(30_000)
    engineCapture.onUpdate?.('focus', visible()) // window over, re-check interval over
    expect(engineSpies.setSuppressed).toHaveBeenCalledWith(false)
  })

  it('lifts at once when a gate suppression became a focus suppression before focus turned visible', async () => {
    await bootLiveData()
    engineCapture.onSuppressed?.({status: 'suppressed', reason: 'focus mode active'}) // gate 403 under a visible signal
    wsOpts?.onFocusChange?.('Do Not Disturb') // the hiding signal is published
    engineSpies.setSuppressed.mockClear()

    wsOpts?.onFocusChange?.('None') // within 25 s of the 403, but the suppression is now the focus's

    expect(engineSpies.setSuppressed).toHaveBeenCalledWith(false)
  })

  it('lifts focus-driven suppression at once, without the gate re-check interval', async () => {
    await bootLiveData()
    wsOpts?.onFocusChange?.('Work')
    engineSpies.setSuppressed.mockClear()

    wsOpts?.onFocusChange?.('None')

    expect(engineSpies.setSuppressed).toHaveBeenCalledWith(false)
  })
})
