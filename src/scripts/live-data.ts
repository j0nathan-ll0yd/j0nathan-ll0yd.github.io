import { fetchAllEndpoints, fetchWithTimeout } from '../lib/api';
import { updateFocusOverlay } from '../lib/updaters-focus';
import { updateTheatreReviews } from '../lib/updaters-theatre';
import { updatePollStatus } from '../lib/updaters-status';
import type { HealthExport, SleepExport, WorkoutsExport, BooksExport, GithubEventsExport, ArticlesExport, LocationExport, FocusExport, TheatreReviewsExport } from '../types/exports';
import { CLOUDFRONT_BASE, ENDPOINTS, WEBSOCKET_URL } from '../lib/constants';
import { adaptHealth, adaptSleep, adaptWorkouts, adaptBooks, adaptGithubEvents, adaptArticles } from '../lib/adapters';
import { WSClient } from '../lib/ws-client';
import {
  updateHeartRate,
  updateDailyActivity,
  updateWorkouts,
  updateNightSummary,
  updateHydration,
  updateBookshelf,
  updateDevActivityLog,
  updateReadingFeed,
  updateSystemStatus,
} from '../lib/updaters';
import { updatePlaceLeaderboardV3 } from '../lib/updaters-leaderboard-variations';
import { updateExplorationOdometerV3 } from '../lib/updaters-odometer-variations';
import { PollEngine, type ResourceKey } from '../lib/poll-engine';

const LIVE_CARDS = [
  'cardHR', 'cardSteps', 'cardSleep', 'cardHydration', 'cardBooks', 'cardDevLog', 'cardReading',
  'cardTheatreReviews',
  ...(import.meta.env.DEV ? ['cardPlaceLeaderboardV3', 'cardExplorationOdometerV3'] : []),
];

// ── Module-scoped state for cross-resource dependencies ──────────────
let lastHealth: HealthExport | undefined;
let lastSleep: SleepExport | undefined;
const timestamps: Record<string, string | null> = {};

// ── Per-resource incremental update dispatch ─────────────────────────
function handleResourceUpdate(key: ResourceKey, rawData: unknown): void {
  try {
    timestamps[key] = (rawData as { generatedAt?: string }).generatedAt ?? null;

    switch (key) {
      case 'health': {
        lastHealth = rawData as HealthExport;
        const health = adaptHealth(lastHealth, lastSleep ?? null);
        updateHeartRate(health);
        updateDailyActivity(health);
        updateHydration(health);
        break;
      }
      case 'sleep': {
        lastSleep = rawData as SleepExport;
        updateNightSummary(adaptSleep(lastSleep, lastHealth ?? null));
        if (lastHealth) {
          const health = adaptHealth(lastHealth, lastSleep);
          updateHeartRate(health);
        }
        break;
      }
      case 'workouts':
        updateWorkouts(adaptWorkouts(rawData as WorkoutsExport));
        break;
      case 'books':
        updateBookshelf(adaptBooks(rawData as BooksExport));
        break;
      case 'githubEvents':
        updateDevActivityLog(adaptGithubEvents(rawData as GithubEventsExport));
        break;
      case 'articles':
        updateReadingFeed(adaptArticles(rawData as ArticlesExport));
        break;
      case 'location':
        updatePlaceLeaderboardV3(rawData as LocationExport);
        updateExplorationOdometerV3(rawData as LocationExport);
        break;
      case 'focus':
        updateFocusOverlay(rawData as FocusExport);
        break;
      case 'theatreReviews':
        updateTheatreReviews(rawData as TheatreReviewsExport);
        break;
      case 'starredRepos':
        // Only used for its generatedAt timestamp (already extracted above)
        break;
    }

    updateSystemStatus(timestamps);
  } catch (e) {
    console.warn(`[live-data] ${key} incremental update failed:`, e);
  }
}

// ── Skeleton loading ─────────────────────────────────────────────────
LIVE_CARDS.forEach(id => document.getElementById(id)?.classList.add('is-loading'));

// Fallback: remove skeletons after 8s if data never arrives
let fallbackTimer: ReturnType<typeof setTimeout> | null = setTimeout(() => {
  LIVE_CARDS.forEach(id => document.getElementById(id)?.classList.remove('is-loading'));
}, 8000);

// ── Initial fetch + start continuous polling ─────────────────────────
const startFetch = async () => {
  // Focus overlay (page-level concern)
  const focusBase = import.meta.env.DEV ? '/api/live' : CLOUDFRONT_BASE;
  try {
    const focusData = await fetchWithTimeout<FocusExport>(focusBase + ENDPOINTS.focus);
    updateFocusOverlay(focusData);
  } catch { /* graceful fallback — no overlay on failure */ }

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
      updateDailyActivity(health);
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

  if (data.theatreReviews) {
    try {
      updateTheatreReviews(data.theatreReviews);
    } catch (e) {
      console.warn('[live-data] Theatre reviews update failed:', e);
    }
  }

  updateSystemStatus(data.timestamps);

  // Clean up any remaining skeletons (handles partial endpoint failures)
  LIVE_CARDS.forEach(id => document.getElementById(id)?.classList.remove('is-loading'));
  if (fallbackTimer) clearTimeout(fallbackTimer);

  // ── Start continuous polling ───────────────────────────────────────
  const engine = new PollEngine({
    onUpdate: handleResourceUpdate,
    onError: (key, err) => console.warn(`[poll] ${key} error:`, err.message),
    onStatusChange: updatePollStatus,
  });
  engine.seed(data.timestamps);
  engine.start();

  // ── WebSocket push notifications (additive — polling continues if WS fails) ──
  const ws = new WSClient({
    url: WEBSOCKET_URL,
    onUpdate: (resource) => {
      const key = resource as ResourceKey;
      if (key in ENDPOINTS) {
        engine.pollResource(key).catch(() => {});
      }
    },
    onStateChange: (connected) => {
      engine.setMode(connected ? 'passive' : 'active');
    },
  });
  ws.connect();
};

if ('requestIdleCallback' in window) {
  requestIdleCallback(() => startFetch(), { timeout: 500 });
} else {
  setTimeout(startFetch, 200);
}
