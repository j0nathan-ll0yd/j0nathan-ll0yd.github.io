import {fetchAllEndpoints, fetchWithTimeout} from './api'
import {updateFocusOverlay} from '@j0nathan-ll0yd/web/runtime/updaters-focus'
import {updateTheatreReviews} from '@j0nathan-ll0yd/web/runtime/updaters-theatre'
import {updatePollStatus} from './updaters-status'
import {updateHeartRateFooter, updateMovementRings} from '@j0nathan-ll0yd/web/runtime/updaters-movement'
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
} from '@j0nathan-ll0yd/web/types/exports'
import {CLOUDFRONT_BASE, ENDPOINTS, HIDING_FOCUS_MODES, WEBSOCKET_URL} from '@j0nathan-ll0yd/portal-contract/constants'
import {adaptArticles, adaptBooks, adaptGithubEvents, adaptHealth, adaptSleep, adaptStarredRepos, adaptWorkouts} from '@j0nathan-ll0yd/web/runtime/adapters'
import {WSClient} from './ws-client'
import {
  updateBookshelf,
  updateDevActivityLog,
  updateHeartRate,
  updateHydration,
  updateNightSummary,
  updateReadingFeed,
  updateStarredRepos,
  updateSystemStatus,
  updateWorkouts
} from '@j0nathan-ll0yd/web/runtime/updaters'
import {PollEngine} from './poll-engine'
import type {ResourceKey} from '@j0nathan-ll0yd/portal-contract/constants'

const LIVE_CARDS = [
  'cardHR',
  'cardMovement',
  'cardSleep',
  'cardHydration',
  'cardBooks',
  'cardDevLog',
  'cardReading',
  'cardStarredRepos',
  'cardTheatreReviews'
]

// ── Module-scoped state for cross-resource dependencies ──────────────
let lastHealth: HealthExport | undefined
let lastSleep: SleepExport | undefined
const timestamps: Record<string, string | null> = {}
let engine: PollEngine | null = null
// ws is hoisted to module scope so pagehide/pageshow lifecycle handlers can
// reach it. It is null until startFetch() completes (null-guard before use).
let ws: WSClient | null = null

// ── Focus-mode suppression (companion to the backend CloudFront edge gate) ──
// While focus is a hiding mode the gate denies every suppressible artifact (403). The
// client mirrors that: overlay immediately, pause suppressible polling, and hold the live
// cards in their skeleton state so no stale real data lingers in the DOM under the overlay.
// HIDING_FOCUS_MODES is the cross-platform single source of truth (@j0nathan-ll0yd/portal-contract),
// shared with the backend gate + the DS overlay so the three layers can never drift — the web
// layer is cosmetic + efficiency only; the edge gate is the real privacy boundary, so a
// mismatch degrades to redundant 403 polls, never a data leak.
const HIDING_FOCUS_MODE_SET = new Set<string>(HIDING_FOCUS_MODES)
let suppressed = false

// The WS push is the authoritative focus source. A focus poll (the fallback for when the WS is
// down) refetches the ~30s edge-cached focus.json, which lags a just-changed state. For a short
// window after each push we ignore focus polls (they're reading the lagging cached value); after
// the window the poll is trusted again, so a genuinely-dropped push self-heals (bounded lag)
// rather than leaving the overlay permanently stuck on a stale value.
const STALE_FOCUS_POLL_WINDOW_MS = 45_000
let wsConnected = false
let lastFocusPushAtMs = 0

function isHiding(currentFocus: string | null): boolean {
  return currentFocus !== null && HIDING_FOCUS_MODE_SET.has(currentFocus)
}

/**
 * Single entry point for a focus-state change (WebSocket push, focus poll, or startup).
 * Drives the overlay from the value directly — no refetch of the edge-cached focus signal —
 * and transitions client-side suppression on the visible↔hiding boundary.
 */
function applyFocus(currentFocus: string | null): void {
  // The overlay reflects the exact value every time (Work and Do Not Disturb are distinct
  // overlays), so this runs even when the hiding class is unchanged.
  updateFocusOverlay(currentFocus ? {generatedAt: new Date().toISOString(), currentFocus} : null)

  const hiding = isHiding(currentFocus)
  if (hiding === suppressed) {
    return
  }
  suppressed = hiding

  // The overlay is opaque and full-screen, so it is the sole visual treatment — deliberately
  // DON'T re-skeleton the cards. `is-loading` only adds an opaque overlay (Card.astro) without
  // removing the retained data, so it buys no DOM hygiene; worse, a card whose data is
  // unchanged during hiding would be skipped by pollNow()'s fingerprint check on restore and
  // stay stuck showing a skeleton. On restore the overlay simply lifts to reveal the retained
  // (still-current) data; pollNow refreshes whatever actually changed.
  engine?.setSuppressed(hiding)
  if (!hiding) {
    void engine?.pollNow()
  }
}

// ── Resource type map for discriminated validation ───────────────────
type ResourceTypeMap = {
  health: HealthExport
  sleep: SleepExport
  workouts: WorkoutsExport
  books: BooksExport
  githubEvents: GithubEventsExport
  articles: ArticlesExport
  focus: FocusExport
  theatreReviews: TheatreReviewsExport
  starredRepos: GithubStarredReposExport
}

// Structural discriminant per resource: a field whose presence (alongside a string
// `generatedAt`) marks a payload as the expected export shape. A full Record over
// ResourceKey so that adding a resource to ENDPOINTS without a discriminant here is a
// compile error, not a silently-unvalidated payload at runtime.
const RESOURCE_DISCRIMINANTS: Record<ResourceKey, string> = {
  health: 'quantities',
  sleep: 'date',
  workouts: 'workouts',
  books: 'books',
  githubEvents: 'events',
  articles: 'articles',
  focus: 'currentFocus',
  theatreReviews: 'reviews',
  starredRepos: 'repos'
}

function validateResource<K extends ResourceKey>(key: K, rawData: unknown): ResourceTypeMap[K] | null {
  if (typeof rawData !== 'object' || rawData === null) {
    return null
  }
  const obj = rawData as Record<string, unknown>
  if (typeof obj.generatedAt !== 'string') {
    return null
  }
  if (!(RESOURCE_DISCRIMINANTS[key] in obj)) {
    return null
  }
  return rawData as ResourceTypeMap[K]
}

// ── Per-resource incremental update dispatch ─────────────────────────
function handleResourceUpdate(key: ResourceKey, rawData: unknown): void {
  const validated = validateResource(key, rawData)
  if (!validated) {
    console.warn(`[live-data] ${key}: payload failed structural validation, preserving stale data`)
    return
  }

  timestamps[key] = validated.generatedAt

  try {
    switch (key) {
      case 'health': {
        const data = validated as ResourceTypeMap['health']
        lastHealth = data
        const health = adaptHealth(data, lastSleep ?? null)
        updateHeartRate(health)
        updateHeartRateFooter(health)
        updateMovementRings(health)
        updateHydration(health)
        break
      }
      case 'sleep': {
        const data = validated as ResourceTypeMap['sleep']
        lastSleep = data
        updateNightSummary(adaptSleep(data, lastHealth ?? null))
        if (lastHealth) {
          const health = adaptHealth(lastHealth, data)
          updateHeartRate(health)
          updateHeartRateFooter(health)
        }
        break
      }
      case 'workouts':
        updateWorkouts(adaptWorkouts(validated as ResourceTypeMap['workouts']))
        break
      case 'books':
        updateBookshelf(adaptBooks(validated as ResourceTypeMap['books']))
        break
      case 'githubEvents':
        updateDevActivityLog(adaptGithubEvents(validated as ResourceTypeMap['githubEvents']))
        break
      case 'articles':
        updateReadingFeed(adaptArticles(validated as ResourceTypeMap['articles']))
        break
      case 'focus': {
        // Route through applyFocus so a focus change detected by polling (e.g. the WS is down)
        // also transitions client-side suppression, not just the overlay. But within the
        // edge-cache propagation window after a WS push, the poll is reading a lagging cached
        // focus.json — ignore it so a stale value can't re-apply over the fresh push (the
        // restore-linger bug). After the window the poll is trusted again, so a dropped push
        // self-heals (bounded lag) instead of leaving the overlay permanently stuck.
        if (wsConnected && lastFocusPushAtMs > 0 && Date.now() - lastFocusPushAtMs < STALE_FOCUS_POLL_WINDOW_MS) {
          break
        }
        applyFocus((validated as ResourceTypeMap['focus']).currentFocus)
        break
      }
      case 'theatreReviews':
        updateTheatreReviews(validated as ResourceTypeMap['theatreReviews'])
        break
      case 'starredRepos':
        updateStarredRepos(adaptStarredRepos(validated as ResourceTypeMap['starredRepos']))
        break
    }

    updateSystemStatus(timestamps)
  } catch (e) {
    console.warn(`[live-data] ${key} incremental update failed, preserving stale data:`, e)
  }
}

// ── Skeleton loading ─────────────────────────────────────────────────
LIVE_CARDS.forEach((id) => document.getElementById(id)?.classList.add('is-loading'))

// Fallback: remove skeletons after 8s if data never arrives
const fallbackTimer: ReturnType<typeof setTimeout> | null = setTimeout(() => {
  LIVE_CARDS.forEach((id) => document.getElementById(id)?.classList.remove('is-loading'))
}, 8000)

// ── Initial fetch + start continuous polling ─────────────────────────
const startFetch = async () => {
  // Focus overlay (page-level concern). applyFocus drives the overlay immediately and, if
  // focus is already a hiding mode at load, sets suppression intent (engine is still null;
  // it is propagated via engine.setSuppressed(suppressed) below once created).
  const focusBase = import.meta.env.DEV ? '/api/live' : CLOUDFRONT_BASE
  const focusData = await fetchWithTimeout<FocusExport>(focusBase + ENDPOINTS.focus)
  applyFocus(focusData?.currentFocus ?? null)

  const data = await fetchAllEndpoints()

  // Cache raw data for cross-resource dependencies
  if (data.health) {
    lastHealth = data.health
  }
  if (data.sleep) {
    lastSleep = data.sleep
  }
  Object.assign(timestamps, data.timestamps)

  // ── Initial DOM updates (identical to previous one-shot behavior) ──
  if (data.health) {
    try {
      const health = adaptHealth(data.health, data.sleep)
      updateHeartRate(health)
      updateHeartRateFooter(health)
      updateMovementRings(health)
      updateHydration(health)
    } catch (e) {
      console.warn('[live-data] Health update failed:', e)
    }
  }

  if (data.sleep) {
    try {
      updateNightSummary(adaptSleep(data.sleep, data.health))
    } catch (e) {
      console.warn('[live-data] Sleep update failed:', e)
    }
  }

  if (data.workouts !== undefined) {
    try {
      updateWorkouts(adaptWorkouts(data.workouts))
    } catch (e) {
      console.warn('[live-data] Workouts update failed:', e)
    }
  }

  if (data.books) {
    try {
      updateBookshelf(adaptBooks(data.books))
    } catch (e) {
      console.warn('[live-data] Books update failed:', e)
    }
  }

  if (data.githubEvents) {
    try {
      updateDevActivityLog(adaptGithubEvents(data.githubEvents))
    } catch (e) {
      console.warn('[live-data] GitHub events update failed:', e)
    }
  }

  if (data.articles) {
    try {
      updateReadingFeed(adaptArticles(data.articles))
    } catch (e) {
      console.warn('[live-data] Articles update failed:', e)
    }
  }

  if (data.starredRepos) {
    try {
      updateStarredRepos(adaptStarredRepos(data.starredRepos))
    } catch (e) {
      console.warn('[live-data] Starred repos update failed:', e)
    }
  }

  if (data.theatreReviews) {
    try {
      updateTheatreReviews(data.theatreReviews)
    } catch (e) {
      console.warn('[live-data] Theatre reviews update failed:', e)
    }
  }

  updateSystemStatus(data.timestamps)

  // Clean up any remaining skeletons (handles partial endpoint failures) — but while
  // suppressed (loaded during a hiding mode), keep the cards skeletonised: the endpoints
  // 403 so there is no real data to show, and skeletons are the suppressed presentation.
  if (!suppressed) {
    LIVE_CARDS.forEach((id) => document.getElementById(id)?.classList.remove('is-loading'))
  }
  if (fallbackTimer) {
    clearTimeout(fallbackTimer)
  }

  // ── Start continuous polling ───────────────────────────────────────
  engine = new PollEngine({
    onUpdate: handleResourceUpdate,
    onError: (key, err) => console.warn(`[poll] ${key} error:`, err.message),
    onStatusChange: updatePollStatus
  })
  engine.seed(data.timestamps)
  // Propagate the load-time suppression intent set by applyFocus() (engine was null then).
  engine.setSuppressed(suppressed)
  engine.start()

  // Nudge the service worker to check for a new build now. The graceful,
  // state-preserving reload is owned entirely by the web app's sw-register.js
  // (window.__checkForSwUpdate); this runtime never reloads the page itself.
  // No-op if the global is absent (e.g. SW unsupported or registration failed).
  const nudgeServiceWorkerUpdate = (): void => {
    const w = window as Window & {__checkForSwUpdate?: () => void}
    if (typeof w.__checkForSwUpdate === 'function') {
      w.__checkForSwUpdate()
    }
  }

  // ── WebSocket push notifications (additive — polling continues if WS fails) ──
  ws = new WSClient({
    url: WEBSOCKET_URL,
    onUpdate: (resource) => {
      const key = resource as ResourceKey
      if (key in ENDPOINTS) {
        engine!.pollResource(key).catch(() => {})
      }
    },
    // Focus push carries the new value → drive the overlay + suppression immediately,
    // without waiting on a refetch of the ~30s-edge-cached focus signal.
    onFocusChange: (currentFocus) => {
      lastFocusPushAtMs = Date.now()
      applyFocus(currentFocus)
    },
    // A new web build is live (deploy push): nudge the SW to fetch the new sw.js.
    onAppUpdate: () => nudgeServiceWorkerUpdate(),
    onStateChange: (connected) => {
      wsConnected = connected
      engine!.setMode(connected ? 'passive' : 'active')
      // On (re)connect — e.g. tab refocus after the WS dropped while hidden —
      // also re-check, in case an app-update push was missed while disconnected.
      if (connected) {
        nudgeServiceWorkerUpdate()
      }
    }
  })
  ws.connect()
}

if ('requestIdleCallback' in window) {
  requestIdleCallback(() => void startFetch(), {timeout: 500})
} else {
  setTimeout(() => void startFetch(), 200)
}

// ── BFCache lifecycle handlers ────────────────────────────────────────
// pagehide(persisted=true): browser is freezing the page into BFCache.
// Close the WebSocket and stop polling so the page is BFCache-eligible
// (an open WebSocket is a hard Chromium BFCache blocker).
window.addEventListener('pagehide', (event) => {
  if ((event as PageTransitionEvent).persisted) {
    if (engine) {
      engine.stop()
    }
    if (ws) {
      ws.disconnect()
    }
  }
})

// pageshow(persisted=true): browser is restoring the page from BFCache.
// Restart poll timers + reconnect the WebSocket, then trigger an immediate
// refresh. engine.start() is idempotent (no-op if already running); after a
// pagehide teardown it restarts the interval timers and visibilitychange
// listener. engine.pollNow() fetches fresh data without waiting for the next
// tick. The WS was silently lost on restore before this fix.
window.addEventListener('pageshow', (event) => {
  if ((event as PageTransitionEvent).persisted) {
    if (engine) {
      engine.start()
      void engine.pollNow()
    }
    if (ws) {
      ws.connect()
    }
  }
})
