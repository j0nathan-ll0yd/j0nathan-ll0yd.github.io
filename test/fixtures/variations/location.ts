import type { LocationExport } from '../../../src/types/exports';
import { createLocationFixture } from '../factories/location';
import { last90DaysEntries } from '../factories/helpers';

/** baseline: default production-like fixture */
export const baseline: LocationExport = createLocationFixture();

/** emptyTopPlaces: no top places */
export const emptyTopPlaces: LocationExport = createLocationFixture({ topPlaces: [] });

/** singleCity: one city, minimal data */
export const singleCity: LocationExport = createLocationFixture({
  citiesVisited: 1,
  cityBreakdown: [{ city: 'San Francisco', visitCount: 12 }],
  explorationStats: { totalNeighborhoods: 3, totalCities: 1, totalStates: 1 },
});

/** manyCities: 12 cities visited */
export const manyCities: LocationExport = createLocationFixture({
  citiesVisited: 12,
  cityBreakdown: [
    { city: 'San Francisco', visitCount: 80 },
    { city: 'Oakland', visitCount: 30 },
    { city: 'Berkeley', visitCount: 25 },
    { city: 'San Jose', visitCount: 18 },
    { city: 'Palo Alto', visitCount: 15 },
    { city: 'Marin City', visitCount: 12 },
    { city: 'Santa Cruz', visitCount: 10 },
    { city: 'Sacramento', visitCount: 8 },
    { city: 'Napa', visitCount: 6 },
    { city: 'Sonoma', visitCount: 5 },
    { city: 'Monterey', visitCount: 4 },
    { city: 'Carmel', visitCount: 3 },
  ],
  explorationStats: { totalNeighborhoods: 18, totalCities: 12, totalStates: 1 },
});

/** highStreak: current streak of 45 days */
export const highStreak: LocationExport = createLocationFixture({
  streaks: { currentStreak: 45, longestStreak: 60, totalActiveDays: 80 },
});

/** zeroStreak: no active streak */
export const zeroStreak: LocationExport = createLocationFixture({
  streaks: { currentStreak: 0, longestStreak: 7, totalActiveDays: 14 },
});

/** sparse90Days: sparse activity in last 90 days (roughly 1 in 3 days) */
export const sparse90Days: LocationExport = createLocationFixture({
  last90Days: last90DaysEntries('sparse'),
});

/** full90Days: every day has activity in last 90 days */
export const full90Days: LocationExport = createLocationFixture({
  last90Days: last90DaysEntries('full'),
});

/** allCategories: all 9 recognized categories in categoryBreakdown */
export const allCategories: LocationExport = createLocationFixture({
  categoryBreakdown: [
    { category: 'Dining', visitCount: 40, totalMinutes: 2400 },
    { category: 'Fitness & Outdoors', visitCount: 20, totalMinutes: 1200 },
    { category: 'Shopping', visitCount: 15, totalMinutes: 450 },
    { category: 'Entertainment', visitCount: 10, totalMinutes: 600 },
    { category: 'Education', visitCount: 8, totalMinutes: 480 },
    { category: 'Travel', visitCount: 6, totalMinutes: 360 },
    { category: 'Auto', visitCount: 5, totalMinutes: 150 },
    { category: 'Services', visitCount: 4, totalMinutes: 120 },
    { category: 'Other', visitCount: 142, totalMinutes: 8520 },
  ],
});

export const locationVariations = {
  baseline,
  emptyTopPlaces,
  singleCity,
  manyCities,
  highStreak,
  zeroStreak,
  sparse90Days,
  full90Days,
  allCategories,
};
