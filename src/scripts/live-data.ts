import { isDevMode, initDevMode } from '../lib/dev-mode';
import { fetchAllEndpoints } from '../lib/api';
import { adaptHealth, adaptSleep, adaptWorkouts, adaptBooks } from '../lib/adapters';
import {
  updateHeartRate,
  updateDailyActivity,
  updateWorkouts,
  updateNightSummary,
  updateHydration,
  updateBookshelf,
} from '../lib/updaters';

initDevMode();

// Wait for card reveal animation to complete (~1200ms)
setTimeout(async () => {
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
}, 1200);
