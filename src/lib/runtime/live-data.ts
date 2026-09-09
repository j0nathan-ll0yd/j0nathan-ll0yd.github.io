import {fetchAllEndpoints, fetchArtifact, isResourceKey} from './api'
import type {EndpointResult, EndpointSuppressed} from './api'
import {updateFocusOverlay} from '@j0nathan-ll0yd/web/runtime/updaters-focus'
import {updateTheatreReviews} from '@j0nathan-ll0yd/web/runtime/updaters-theatre'
import {updatePollStatus} from './updaters-status'
import {updateHeartRateFooter, updateMovementRings} from '@j0nathan-ll0yd/web/runtime/updaters-movement'
// Only the two exports this module holds across resources still need naming here. The other seven
// arrive already typed through `ArtifactValues[K]`, so listing them again would be a second copy of
// the contract's own key-to-type mapping.
import type {HealthExport, SleepExport} from '@j0nathan-ll0yd/portal-contract/schemas'
import type {ArtifactValues} from '@j0nathan-ll0yd/portal-contract/decoders'
import {HIDING_FOCUS_MODES, WEBSOCKET_URL} from '@j0nathan-ll0yd/portal-contract/constants'
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
// client mirrors that: overlay immediately, pause suppressible polling, and expose the SSR
// shell instead of leaving the live cards behind permanent loading overlays.
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

  if (hiding) {
    LIVE_CARDS.forEach((id) => document.getElementById(id)?.classList.remove('is-loading'))
  }

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

function endpointData<T>(result: EndpointResult<T>): T | null {
  return result.status === 'ok' ? result.data : null
}

function applySuppression(result: EndpointSuppressed): void {
  if (result.currentFocus) {
    applyFocus(result.currentFocus)
    return
  }
  suppressed = true
  LIVE_CARDS.forEach((id) => document.getElementById(id)?.classList.remove('is-loading'))
  engine?.setSuppressed(true)
}

// ── Per-resource incremental update dispatch ─────────────────────────
//
// One entry per resource key, each receiving exactly that key's decoded export type. This
// replaced a hand-kept `ResourceTypeMap` (a duplicate of the contract's `ArtifactValues`), a
// `RESOURCE_DISCRIMINANTS` table, and a `validateResource` structural check. That layer was a
// second, weaker browser schema -- it tested `typeof generatedAt === 'string'` plus the presence
// of one field name -- and `fetchArtifact` now decodes against the real published contract before
// anything reaches here, so nothing that layer could reject can still arrive.
//
// The record shape is also what removes the nine `as ResourceTypeMap[...]` casts the old `switch`
// needed. Indexing it with the generic key yields `(data: ArtifactValues[K]) => void`, which
// accepts exactly the value that came back under that same key, so key and value stay correlated
// across the decoded boundary and the consumer asserts nothing. A resource added to ENDPOINTS
// without an entry here is still a compile error.
const RESOURCE_UPDATERS: { [K in ResourceKey]: (data: ArtifactValues[K]) => void } = {
  health: (data) => {
    lastHealth = data
    const health = adaptHealth(data, lastSleep ?? null)
    updateHeartRate(health)
    updateHeartRateFooter(health)
    updateMovementRings(health)
    updateHydration(health)
  },
  sleep: (data) => {
    lastSleep = data
    updateNightSummary(adaptSleep(data, lastHealth ?? null))
    if (lastHealth) {
      const health = adaptHealth(lastHealth, data)
      updateHeartRate(health)
      updateHeartRateFooter(health)
    }
  },
  workouts: (data) => updateWorkouts(adaptWorkouts(data)),
  books: (data) => updateBookshelf(adaptBooks(data)),
  githubEvents: (data) => updateDevActivityLog(adaptGithubEvents(data)),
  articles: (data) => updateReadingFeed(adaptArticles(data)),
  focus: (data) => {
    // Route through applyFocus so a focus change detected by polling (e.g. the WS is down)
    // also transitions client-side suppression, not just the overlay. But within the
    // edge-cache propagation window after a WS push, the poll is reading a lagging cached
    // focus.json — ignore it so a stale value can't re-apply over the fresh push (the
    // restore-linger bug). After the window the poll is trusted again, so a dropped push
    // self-heals (bounded lag) instead of leaving the overlay permanently stuck.
    if (wsConnected && lastFocusPushAtMs > 0 && Date.now() - lastFocusPushAtMs < STALE_FOCUS_POLL_WINDOW_MS) {
      return
    }
    applyFocus(data.currentFocus)
  },
  theatreReviews: (data) => updateTheatreReviews(data),
  starredRepos: (data) => updateStarredRepos(adaptStarredRepos(data))
}

function handleResourceUpdate<K extends ResourceKey>(key: K, data: ArtifactValues[K]): void {
  timestamps[key] = data.generatedAt

  // Still required after decoding: this guards adapter and updater throws, which are a different
  // failure from an invalid payload. A payload that fails its contract never reaches this
  // function at all -- it is reported one layer up, through the engine's onError.
  try {
    RESOURCE_UPDATERS[key](data)
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
  const focusResult = await fetchArtifact('focus')
  applyFocus(focusResult.status === 'ok' ? focusResult.data.currentFocus : null)

  const data = await fetchAllEndpoints()
  const health = endpointData(data.health)
  const sleep = endpointData(data.sleep)
  const workouts = endpointData(data.workouts)
  const books = endpointData(data.books)
  const githubEvents = endpointData(data.githubEvents)
  const starredRepos = endpointData(data.starredRepos)
  const articles = endpointData(data.articles)
  const theatreReviews = endpointData(data.theatreReviews)

  const initialSuppression = [
    data.health,
    data.sleep,
    data.workouts,
    data.books,
    data.githubEvents,
    data.starredRepos,
    data.articles,
    data.theatreReviews
  ].find((result): result is EndpointSuppressed => result.status === 'suppressed')
  if (initialSuppression) {
    applySuppression(initialSuppression)
  }

  // Cache raw data for cross-resource dependencies
  if (health) {
    lastHealth = health
  }
  if (sleep) {
    lastSleep = sleep
  }
  Object.assign(timestamps, data.timestamps)

  // ── Initial DOM updates (identical to previous one-shot behavior) ──
  if (health) {
    try {
      const adaptedHealth = adaptHealth(health, sleep)
      updateHeartRate(adaptedHealth)
      updateHeartRateFooter(adaptedHealth)
      updateMovementRings(adaptedHealth)
      updateHydration(adaptedHealth)
    } catch (e) {
      console.warn('[live-data] Health update failed:', e)
    }
  }

  if (sleep) {
    try {
      updateNightSummary(adaptSleep(sleep, health))
    } catch (e) {
      console.warn('[live-data] Sleep update failed:', e)
    }
  }

  if (workouts) {
    try {
      updateWorkouts(adaptWorkouts(workouts))
    } catch (e) {
      console.warn('[live-data] Workouts update failed:', e)
    }
  }

  if (books) {
    try {
      updateBookshelf(adaptBooks(books))
    } catch (e) {
      console.warn('[live-data] Books update failed:', e)
    }
  }

  if (githubEvents) {
    try {
      updateDevActivityLog(adaptGithubEvents(githubEvents))
    } catch (e) {
      console.warn('[live-data] GitHub events update failed:', e)
    }
  }

  if (articles) {
    try {
      updateReadingFeed(adaptArticles(articles))
    } catch (e) {
      console.warn('[live-data] Articles update failed:', e)
    }
  }

  if (starredRepos) {
    try {
      updateStarredRepos(adaptStarredRepos(starredRepos))
    } catch (e) {
      console.warn('[live-data] Starred repos update failed:', e)
    }
  }

  if (theatreReviews) {
    try {
      updateTheatreReviews(theatreReviews)
    } catch (e) {
      console.warn('[live-data] Theatre reviews update failed:', e)
    }
  }

  updateSystemStatus(data.timestamps)

  // Clean up every loading overlay, including during suppression: the SSR shell is the
  // honest fallback presentation and must not remain hidden behind permanent skeletons.
  LIVE_CARDS.forEach((id) => document.getElementById(id)?.classList.remove('is-loading'))
  if (fallbackTimer) {
    clearTimeout(fallbackTimer)
  }

  // ── Start continuous polling ───────────────────────────────────────
  engine = new PollEngine({
    onUpdate: handleResourceUpdate,
    onSuppressed: applySuppression,
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
    // `resource` is an untrusted string off the socket. The admission test is own-property only:
    // `resource in ENDPOINTS` was prototype-inclusive, so a frame naming `constructor` or
    // `toString` passed the check and refetched a key that has no endpoint path at all.
    onUpdate: (resource) => {
      if (isResourceKey(resource)) {
        engine!.pollResource(resource).catch(() => {})
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
