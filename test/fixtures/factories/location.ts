import type { LocationExport } from '../../../src/types/exports';
import { isoTimestamp, isoDate, last90DaysEntries } from './helpers';

export function createLocationFixture(overrides: Partial<LocationExport> = {}): LocationExport {
  return {
    generatedAt: isoTimestamp(),
    totalVisits: 250,
    totalPlaces: 35,
    totalDurationHours: 180,
    citiesVisited: 1,
    currentCity: null,
    lastSeen: null,
    last90Days: last90DaysEntries('normal'),
    topPlaces: [
      {
        name: 'Colibri Mexican Bistro',
        category: 'Dining',
        visitCount: 3,
        totalDurationMinutes: 180,
        lastVisitAt: isoDate(-7),
      },
      {
        name: 'The Castro Room',
        category: 'Fitness & Outdoors',
        visitCount: 4,
        totalDurationMinutes: 90,
        lastVisitAt: isoDate(-3),
      },
      {
        name: 'Jeremy Waterman',
        category: 'Shopping',
        visitCount: 2,
        totalDurationMinutes: 42,
        lastVisitAt: isoDate(-14),
      },
      {
        name: 'Sightglass Coffee',
        category: 'Dining',
        visitCount: 5,
        totalDurationMinutes: 210,
        lastVisitAt: isoDate(-2),
      },
      {
        name: 'Dolores Park',
        category: 'Fitness & Outdoors',
        visitCount: 6,
        totalDurationMinutes: 240,
        lastVisitAt: isoDate(-1),
      },
      {
        name: 'City Lights Booksellers',
        category: 'Shopping',
        visitCount: 3,
        totalDurationMinutes: 75,
        lastVisitAt: isoDate(-10),
      },
      {
        name: 'SFMOMA',
        category: 'Education',
        visitCount: 2,
        totalDurationMinutes: 120,
        lastVisitAt: isoDate(-21),
      },
      {
        name: 'Foreign Cinema',
        category: 'Dining',
        visitCount: 3,
        totalDurationMinutes: 195,
        lastVisitAt: isoDate(-5),
      },
    ],
    cityBreakdown: [{ city: 'San Francisco', visitCount: 12 }],
    categoryBreakdown: [
      { category: 'Dining', visitCount: 5, totalMinutes: 308 },
      { category: 'Fitness & Outdoors', visitCount: 2, totalMinutes: 90 },
      { category: 'Shopping', visitCount: 2, totalMinutes: 42 },
      { category: 'Education', visitCount: 1, totalMinutes: 11 },
      { category: 'Other', visitCount: 192, totalMinutes: 14933 },
    ],
    streaks: {
      currentStreak: 13,
      longestStreak: 13,
      totalActiveDays: 13,
    },
    explorationStats: {
      totalNeighborhoods: 0,
      totalCities: 1,
      totalStates: 1,
    },
    ...overrides,
  };
}
