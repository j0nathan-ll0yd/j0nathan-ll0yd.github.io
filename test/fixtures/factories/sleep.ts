import type { SleepExport } from '../../../src/types/exports';
import { isoDate, isoTimestamp } from './helpers';

// SleepExport has an index signature: [k: string]: string | { seconds: number }
// so we must construct the object carefully and cast.

export function createSleepFixture(
  overrides?: Record<string, string | { seconds: number }>,
): SleepExport {
  const base: Record<string, string | { seconds: number }> = {
    date: isoDate(1),
    generatedAt: isoTimestamp(),
    core: { seconds: 17500 },
    deep: { seconds: 5500 },
    rem: { seconds: 5500 },
    awake: { seconds: 1950 },
  };

  return { ...base, ...overrides } as SleepExport;
}
