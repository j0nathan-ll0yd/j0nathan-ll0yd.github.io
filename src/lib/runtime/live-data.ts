import { fetchAllEndpoints, fetchWithTimeout } from './api';
import { updateFocusOverlay } from '@lifegames/web/runtime/updaters-focus';
import { updateTheatreReviews } from '@lifegames/web/runtime/updaters-theatre';
import { updatePollStatus } from './updaters-status';
import { updateMovementRings, updateHeartRateFooter } from '@lifegames/web/runtime/updaters-movement';
import type {
  HealthExport,
  SleepExport,
  WorkoutsExport,
  BooksExport,
  GithubEventsExport,
  GithubStarredReposExport,
  ArticlesExport,
  LocationExport,
  FocusExport,
  TheatreReviewsExport,
} from '@lifegames/web/types/exports';
import { CLOUDFRONT_BASE, ENDPOINTS, WEBSOCKET_URL } from '@lifegames/portal-contract/constants';
import {
  adaptHealth,
  adaptSleep,
  adaptWorkouts,
  adaptBooks,
  adaptGithubEvents,
  adaptStarredRepos,
  adaptArticles,
} from '@lifegames/web/runtime/adapters';
import { WSClient } from './ws-client';
import {
  updateHeartRate,
  updateWorkouts,
  updateNightSummary,
  updateHydration,
  updateBookshelf,
  updateDevActivityLog,
  updateReadingFeed,
  updateStarredRepos,
  updateSystemStatus,
} from '@lifegames/web/runtime/updaters';
import { updatePlaceLeaderboardV3 } from '@lifegames/web/runtime/updaters-leaderboard-variations';
import { updateExplorationOdometerV3 } from '@lifegames/web/runtime/updaters-odometer-variations';
import { PollEngine } from './poll-engine';
import type { ResourceKey } from '@lifegames/portal-contract/constants';

const LIVE_CARDS = [
  'cardHR',
  'cardMovement',
  'cardSleep',
  'cardHydration',
  'cardBooks',
  'cardDevLog',
  'cardReading',
  'cardStarredRepos',
  'cardTheatreReviews',
  ...(import.meta.env.DEV ? ['cardPlaceLeaderboardV3', 'cardExplorationOdometerV3'] : []),
];

// ── Module-scoped state for cross-resource dependencies ──────────────
let lastHealth: HealthExport | undefined;
let lastSleep: SleepExport | undefined;
const timestamps: Record<string, string | null> = {};
let engine: PollEngine | null = null;
// ws is hoisted to module scope so pagehide/pageshow lifecycle handlers can
// reach it. It is null until startFetch() completes (null-guard before use).
let ws: WSClient | null = null;

// ── Resource type map for discriminated validation ───────────────────
type ResourceTypeMap = {
  health: HealthExport;
  sleep: SleepExport;
  workouts: WorkoutsExport;
  books: BooksExport;
  githubEvents: GithubEventsExport;
  articles: ArticlesExport;
  location: LocationExport;
  focus: FocusExport;
  theatreReviews: TheatreReviewsExport;
  starredRepos: GithubStarredReposExport;
};

const RESOURCE_DISCRIMINANTS: Record<ResourceKey, string> = {
  health: 'quantities',
  sleep: 'date',
  workouts: 'workouts',
  books: 'books',
  githubEvents: 'events',
  articles: 'articles',
  location: 'topPlaces',
  focus: 'currentFocus',
  theatreReviews: 'reviews',
  starredRepos: 'repos',
};

function validateResource<K extends ResourceKey>(
  key: K,
  rawData: unknown,
): ResourceTypeMap[K] | null {
  if (typeof rawData !== 'object' || rawData === null) return null;
  const obj = rawData as Record<string, unknown>;
  if (typeof obj.generatedAt !== 'string') return null;
  if (!(RESOURCE_DISCRIMINANTS[key] in obj)) return null;
  return rawData as ResourceTypeMap[K];
}

// ── Per-resource incremental update dispatch ─────────────────────────
function handleResourceUpdate(key: ResourceKey, rawData: unknown): void {
  const validated = validateResource(key, rawData);
  if (!validated) {
    console.warn(`[live-data] ${key}: payload failed structural validation, preserving stale data`);
    return;
  }

  timestamps[key] = validated.generatedAt;

  try {
    switch (key) {
      case 'health': {
        const data = validated as ResourceTypeMap['health'];
        lastHealth = data;
        const health = adaptHealth(data, lastSleep ?? null);
        updateHeartRate(health);
        updateHeartRateFooter(health);
        updateMovementRings(health);
        updateHydration(health);
        break;
      }
      case 'sleep': {
        const data = validated as ResourceTypeMap['sleep'];
        lastSleep = data;
        updateNightSummary(adaptSleep(data, lastHealth ?? null));
        if (lastHealth) {
          const health = adaptHealth(lastHealth, data);
          updateHeartRate(health);
          updateHeartRateFooter(health);
        }
        break;
      }
      case 'workouts':
        updateWorkouts(adaptWorkouts(validated as ResourceTypeMap['workouts']));
        break;
      case 'books':
        updateBookshelf(adaptBooks(validated as ResourceTypeMap['books']));
        break;
      case 'githubEvents':
        updateDevActivityLog(adaptGithubEvents(validated as ResourceTypeMap['githubEvents']));
        break;
      case 'articles':
        updateReadingFeed(adaptArticles(validated as ResourceTypeMap['articles']));
        break;
      case 'location': {
        const data = validated as ResourceTypeMap['location'];
        updatePlaceLeaderboardV3(data);
        updateExplorationOdometerV3(data);
        break;
      }
      case 'focus':
        updateFocusOverlay(validated as ResourceTypeMap['focus']);
        break;
      case 'theatreReviews':
        updateTheatreReviews(validated as ResourceTypeMap['theatreReviews']);
        break;
      case 'starredRepos':
        updateStarredRepos(adaptStarredRepos(validated as ResourceTypeMap['starredRepos']));
        break;
    }

    updateSystemStatus(timestamps);
  } catch (e) {
    console.warn(`[live-data] ${key} incremental update failed, preserving stale data:`, e);
  }
}

// ── Skeleton loading ─────────────────────────────────────────────────
LIVE_CARDS.forEach((id) => document.getElementById(id)?.classList.add('is-loading'));

// Fallback: remove skeletons after 8s if data never arrives
let fallbackTimer: ReturnType<typeof setTimeout> | null = setTimeout(() => {
  LIVE_CARDS.forEach((id) => document.getElementById(id)?.classList.remove('is-loading'));
}, 8000);

// ── Initial fetch + start continuous polling ─────────────────────────
const startFetch = async () => {
  // Focus overlay (page-level concern)
  const focusBase = import.meta.env.DEV ? '/api/live' : CLOUDFRONT_BASE;
  try {
    const focusData = await fetchWithTimeout<FocusExport>(focusBase + ENDPOINTS.focus);
    updateFocusOverlay(focusData);
  } catch {
    /* graceful fallback — no overlay on failure */
  }

  const data = await fetchAllEndpoints();

  // Cache raw data for cross-resource dependencies
  if (data.health) lastHealth = data.health;
  if (data.sleep) lastSleep = data.sleep;
  Object.assign(timestamps, data.timestamps);

  // ── Initial DOM updates (identical to previous one-shot behavior) ──
  if (data.health) {
    try {
      const health = adaptHealth(data.health, data.sleep);
      updateHeartRate(health);
      updateHeartRateFooter(health);
      updateMovementRings(health);
      updateHydration(health);
    } catch (e) {
      console.warn('[live-data] Health update failed:', e);
    }
  }

  if (data.sleep) {
    try {
      updateNightSummary(adaptSleep(data.sleep, data.health));
    } catch (e) {
      console.warn('[live-data] Sleep update failed:', e);
    }
  }

  if (data.workouts !== undefined) {
    try {
      updateWorkouts(adaptWorkouts(data.workouts));
    } catch (e) {
      console.warn('[live-data] Workouts update failed:', e);
    }
  }

  if (data.books) {
    try {
      updateBookshelf(adaptBooks(data.books));
    } catch (e) {
      console.warn('[live-data] Books update failed:', e);
    }
  }

  if (data.githubEvents) {
    try {
      updateDevActivityLog(adaptGithubEvents(data.githubEvents));
    } catch (e) {
      console.warn('[live-data] GitHub events update failed:', e);
    }
  }

  if (data.articles) {
    try {
      updateReadingFeed(adaptArticles(data.articles));
    } catch (e) {
      console.warn('[live-data] Articles update failed:', e);
    }
  }

  if (data.location) {
    try {
      updatePlaceLeaderboardV3(data.location);
      updateExplorationOdometerV3(data.location);
    } catch (e) {
      console.warn('[live-data] Location update failed:', e);
    }
  }

  if (data.starredRepos) {
    try {
      updateStarredRepos(adaptStarredRepos(data.starredRepos));
    } catch (e) {
      console.warn('[live-data] Starred repos update failed:', e);
    }
  }

  if (data.theatreReviews) {
    try {
      updateTheatreReviews(data.theatreReviews);
    } catch (e) {
      console.warn('[live-data] Theatre reviews update failed:', e);
    }
  }

  updateSystemStatus(data.timestamps);

  // Clean up any remaining skeletons (handles partial endpoint failures)
  LIVE_CARDS.forEach((id) => document.getElementById(id)?.classList.remove('is-loading'));
  if (fallbackTimer) clearTimeout(fallbackTimer);

  // ── Start continuous polling ───────────────────────────────────────
  engine = new PollEngine({
    onUpdate: handleResourceUpdate,
    onError: (key, err) => console.warn(`[poll] ${key} error:`, err.message),
    onStatusChange: updatePollStatus,
  });
  engine.seed(data.timestamps);
  engine.start();

  // Nudge the service worker to check for a new build now. The graceful,
  // state-preserving reload is owned entirely by the web app's sw-register.js
  // (window.__checkForSwUpdate); this runtime never reloads the page itself.
  // No-op if the global is absent (e.g. SW unsupported or registration failed).
  const nudgeServiceWorkerUpdate = (): void => {
    const w = window as Window & { __checkForSwUpdate?: () => void; };
    if (typeof w.__checkForSwUpdate === 'function') w.__checkForSwUpdate();
  };

  // ── WebSocket push notifications (additive — polling continues if WS fails) ──
  ws = new WSClient({
    url: WEBSOCKET_URL,
    onUpdate: (resource) => {
      const key = resource as ResourceKey;
      if (key in ENDPOINTS) {
        engine!.pollResource(key).catch(() => {});
      }
    },
    // A new web build is live (deploy push): nudge the SW to fetch the new sw.js.
    onAppUpdate: () => nudgeServiceWorkerUpdate(),
    onStateChange: (connected) => {
      engine!.setMode(connected ? 'passive' : 'active');
      // On (re)connect — e.g. tab refocus after the WS dropped while hidden —
      // also re-check, in case an app-update push was missed while disconnected.
      if (connected) nudgeServiceWorkerUpdate();
    },
  });
  ws.connect();
};

if ('requestIdleCallback' in window) {
  requestIdleCallback(() => startFetch(), { timeout: 500 });
} else {
  setTimeout(startFetch, 200);
}

// ── BFCache lifecycle handlers ────────────────────────────────────────
// pagehide(persisted=true): browser is freezing the page into BFCache.
// Close the WebSocket and stop polling so the page is BFCache-eligible
// (an open WebSocket is a hard Chromium BFCache blocker).
window.addEventListener('pagehide', (event) => {
  if ((event as PageTransitionEvent).persisted) {
    if (engine) engine.stop();
    if (ws) ws.disconnect();
  }
});

// pageshow(persisted=true): browser is restoring the page from BFCache.
// Restart poll timers + reconnect the WebSocket, then trigger an immediate
// refresh. engine.start() is idempotent (no-op if already running); after a
// pagehide teardown it restarts the interval timers and visibilitychange
// listener. engine.pollNow() fetches fresh data without waiting for the next
// tick. The WS was silently lost on restore before this fix.
window.addEventListener('pageshow', (event) => {
  if ((event as PageTransitionEvent).persisted) {
    if (engine) {
      engine.start();
      engine.pollNow();
    }
    if (ws) ws.connect();
  }
});
