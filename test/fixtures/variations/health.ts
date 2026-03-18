import { createHealthFixture } from '../factories/health';
import type { HealthExport } from '../../../src/types/exports';

export const baseline: HealthExport = createHealthFixture();

export const bradycardia: HealthExport = createHealthFixture({
  quantities: { heartRate: { value: 42, unit: 'count/min' } },
});

export const resting: HealthExport = createHealthFixture({
  quantities: { heartRate: { value: 55, unit: 'count/min' } },
});

export const normal: HealthExport = createHealthFixture({
  quantities: { heartRate: { value: 72, unit: 'count/min' } },
});

export const fatBurn: HealthExport = createHealthFixture({
  quantities: { heartRate: { value: 125, unit: 'count/min' } },
});

export const peak: HealthExport = createHealthFixture({
  quantities: { heartRate: { value: 165, unit: 'count/min' } },
});

export const hrvGreen: HealthExport = createHealthFixture({
  quantities: { heartRateVariabilitySDNN: { value: 58, unit: 'ms' } },
});

export const hrvAmber: HealthExport = createHealthFixture({
  quantities: { heartRateVariabilitySDNN: { value: 25, unit: 'ms' } },
});

export const hrvRed: HealthExport = createHealthFixture({
  quantities: { heartRateVariabilitySDNN: { value: 12, unit: 'ms' } },
});

export const missingOptional: HealthExport = createHealthFixture(
  {},
  ['exerciseTime', 'dietaryWater', 'dietaryCaffeine'],
);

export const zeroHydration: HealthExport = createHealthFixture({
  quantities: {
    dietaryWater: { value: 0, unit: 'mL' },
    dietaryCaffeine: { value: 0, unit: 'g' },
  },
});

export const maxHydration: HealthExport = createHealthFixture({
  quantities: {
    dietaryWater: { value: 4140.3, unit: 'mL' },
    dietaryCaffeine: { value: 0.5, unit: 'g' },
  },
});

export const healthVariations = {
  baseline,
  bradycardia,
  resting,
  normal,
  fatBurn,
  peak,
  hrvGreen,
  hrvAmber,
  hrvRed,
  missingOptional,
  zeroHydration,
  maxHydration,
};
