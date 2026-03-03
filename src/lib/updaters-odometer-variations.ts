import { esc } from './updaters';
import type { LocationExport } from '../types/exports';

// ─── V3: Gradient Text with Home Icon ────────────────────────────────────────

const TRACKING_START = new Date('2026-03-02T00:00:00').getTime();

export function updateExplorationOdometerV3(data: LocationExport): void {
  const card = document.getElementById('cardExplorationOdometerV3');
  if (!card) return;

  const visits = card.querySelector<HTMLElement>('[data-loc="odo-v3-visits"]');
  const places = card.querySelector<HTMLElement>('[data-loc="odo-v3-places"]');
  const cities = card.querySelector<HTMLElement>('[data-loc="odo-v3-cities"]');
  const states = card.querySelector<HTMLElement>('[data-loc="odo-v3-states"]');
  const city = card.querySelector<HTMLElement>('[data-loc="odo-v3-city"]');
  const days = card.querySelector<HTMLElement>('[data-loc="odo-v3-days"]');

  if (visits) visits.textContent = data.totalVisits.toLocaleString();
  if (places) places.textContent = data.totalPlaces.toLocaleString();
  if (cities) cities.textContent = data.explorationStats.totalCities.toLocaleString();
  if (states) states.textContent = data.explorationStats.totalStates.toLocaleString();

  if (city) city.textContent = data.currentCity ? esc(data.currentCity) : '';

  if (days) {
    const daysSince = Math.floor((Date.now() - TRACKING_START) / 86_400_000);
    days.textContent = daysSince + (daysSince === 1 ? ' day' : ' days');
  }

  card.classList.remove('is-loading');
}
