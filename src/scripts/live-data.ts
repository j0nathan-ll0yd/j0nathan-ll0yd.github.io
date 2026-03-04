import { isDevMode, initDevMode } from '../lib/dev-mode';
import { fetchAllEndpoints, fetchWithTimeout } from '../lib/api';
import { updateFocusOverlay } from '../lib/updaters-focus';
import type { FocusExport } from '../types/exports';
import { CLOUDFRONT_BASE, ENDPOINTS } from '../lib/constants';
import { adaptHealth, adaptSleep, adaptWorkouts, adaptBooks, adaptGithubEvents, adaptArticles } from '../lib/adapters';
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

const LIVE_CARDS = [
  'cardHR', 'cardSteps', 'cardSleep', 'cardHydration', 'cardBooks', 'cardDevLog', 'cardReading',
  ...(import.meta.env.DEV ? ['cardPlaceLeaderboardV3', 'cardExplorationOdometerV3'] : []),
];

initDevMode();

// Add skeleton loading state to live-data cards (skip in dev mode)
let fallbackTimer: ReturnType<typeof setTimeout> | null = null;
if (!isDevMode()) {
  LIVE_CARDS.forEach(id => document.getElementById(id)?.classList.add('is-loading'));

  // Fallback: remove skeletons after 8s if data never arrives
  fallbackTimer = setTimeout(() => {
    LIVE_CARDS.forEach(id => document.getElementById(id)?.classList.remove('is-loading'));
  }, 8000);
}

// Wait for card reveal animation to complete (~1200ms)
setTimeout(async () => {
  // Focus overlay — runs regardless of data mode (page-level concern)
  const focusBase = import.meta.env.DEV ? '/api/live' : CLOUDFRONT_BASE;
  try {
    const focusData = await fetchWithTimeout<FocusExport>(focusBase + ENDPOINTS.focus);
    updateFocusOverlay(focusData);
  } catch { /* graceful fallback — no overlay on failure */ }

  if (isDevMode()) return;

  const data = await fetchAllEndpoints();

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

  updateSystemStatus(data.timestamps);

  // Clean up any remaining skeletons (handles partial endpoint failures)
  LIVE_CARDS.forEach(id => document.getElementById(id)?.classList.remove('is-loading'));
  if (fallbackTimer) clearTimeout(fallbackTimer);
}, 1200);
