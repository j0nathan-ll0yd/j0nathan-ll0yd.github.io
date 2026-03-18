import type { WorkoutsExport } from '../../../src/types/exports';
import { isoDate, isoTimestamp } from './helpers';

type Workout = WorkoutsExport['workouts'][number];

const DEFAULT_WORKOUT: Workout = {
  activityType: 'Walking',
  duration: 965,
  energyBurned: 72,
  distance: 1135,
  source: "Jonathan's Apple Watch",
};

export function createWorkout(overrides?: Partial<Workout>): Workout {
  return { ...DEFAULT_WORKOUT, ...overrides };
}

export function createWorkoutsFixture(overrides?: Partial<WorkoutsExport>): WorkoutsExport {
  return {
    date: isoDate(1),
    generatedAt: isoTimestamp(),
    workouts: [createWorkout()],
    ...overrides,
  };
}
