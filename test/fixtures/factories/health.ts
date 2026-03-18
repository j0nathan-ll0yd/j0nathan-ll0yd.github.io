import type { HealthExport } from '../../../src/types/exports';
import { isoDate, isoTimestamp } from './helpers';

const DEFAULT_QUANTITIES: HealthExport['quantities'] = {
  heartRate: { value: 63, unit: 'count/min' },
  heartRateVariabilitySDNN: { value: 45, unit: 'ms' },
  stepCount: { value: 6800, unit: 'count' },
  distanceWalkingRunning: { value: 5200, unit: 'm' },
  appleExerciseTime: { value: 52, unit: 'min' },
  activeEnergyBurned: { value: 486, unit: 'kcal' },
  basalEnergyBurned: { value: 1878, unit: 'kcal' },
  dietaryWater: { value: 2202, unit: 'mL' },
  dietaryCaffeine: { value: 0.36, unit: 'g' },
  appleSleepingWristTemperature: { value: 0, unit: 'degC' },
};

export function createHealthFixture(
  overrides?: Partial<HealthExport> & { quantities?: Partial<HealthExport['quantities']> },
  removeKeys?: string[],
): HealthExport {
  const quantities = { ...DEFAULT_QUANTITIES, ...(overrides?.quantities ?? {}) };

  if (removeKeys) {
    for (const key of removeKeys) {
      delete quantities[key];
    }
  }

  return {
    date: isoDate(1),
    generatedAt: isoTimestamp(),
    ...overrides,
    quantities,
  };
}
