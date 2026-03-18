import { createWorkoutsFixture, createWorkout } from '../factories/workouts';
import type { WorkoutsExport } from '../../../src/types/exports';

export const baseline: WorkoutsExport = createWorkoutsFixture();

export const empty: WorkoutsExport = createWorkoutsFixture({ workouts: [] });

export const barrysBootcamp: WorkoutsExport = createWorkoutsFixture({
  workouts: [
    createWorkout({
      activityType: 'Other',
      duration: 3600,
      energyBurned: 450,
      distance: null,
    }),
  ],
});

export const multiWorkout: WorkoutsExport = createWorkoutsFixture({
  workouts: [
    createWorkout({ activityType: 'Walking', duration: 965, energyBurned: 72, distance: 1135 }),
    createWorkout({ activityType: 'Cycling', duration: 2700, energyBurned: 320, distance: 12000 }),
    createWorkout({ activityType: 'Running', duration: 1800, energyBurned: 280, distance: 4500 }),
  ],
});

export const noDistance: WorkoutsExport = createWorkoutsFixture({
  workouts: [
    createWorkout({ distance: null }),
  ],
});

export const workoutsVariations = {
  baseline,
  empty,
  barrysBootcamp,
  multiWorkout,
  noDistance,
};
