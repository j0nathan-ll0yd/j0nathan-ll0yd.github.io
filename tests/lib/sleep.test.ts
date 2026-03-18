import { describe, it, expect } from 'vitest';
import {
  computeTotalSleepSeconds,
  formatDuration,
  formatPhase,
  computeSleepPercentages,
} from '../../src/lib/sleep';
import type { SleepPhases } from '../../src/lib/sleep';

describe('computeTotalSleepSeconds', () => {
  it('sums rem + deep + core, excludes awake', () => {
    const phases: SleepPhases = { rem: 3600, deep: 1800, core: 900, awake: 600 };
    expect(computeTotalSleepSeconds(phases)).toBe(6300);
  });

  it('returns 0 when all sleep phases are 0', () => {
    expect(computeTotalSleepSeconds({ rem: 0, deep: 0, core: 0, awake: 300 })).toBe(0);
  });

  it('excludes awake from total', () => {
    const phases: SleepPhases = { rem: 0, deep: 0, core: 0, awake: 9999 };
    expect(computeTotalSleepSeconds(phases)).toBe(0);
  });

  it('handles large values', () => {
    const phases: SleepPhases = { rem: 7200, deep: 3600, core: 10800, awake: 1800 };
    expect(computeTotalSleepSeconds(phases)).toBe(21600);
  });
});

describe('formatDuration', () => {
  it('formats 0 seconds as 0h 0m', () => {
    expect(formatDuration(0)).toBe('0h 0m');
  });

  it('formats exactly 1 hour', () => {
    expect(formatDuration(3600)).toBe('1h 0m');
  });

  it('formats 1h 30m', () => {
    expect(formatDuration(5400)).toBe('1h 30m');
  });

  it('formats 7h 22m for a typical night', () => {
    expect(formatDuration(7 * 3600 + 22 * 60)).toBe('7h 22m');
  });

  it('floors seconds, does not round up minutes', () => {
    // 59 seconds should still show 0m
    expect(formatDuration(59)).toBe('0h 0m');
    // 3659 seconds = 1h 0m (not 1h 1m)
    expect(formatDuration(3659)).toBe('1h 0m');
  });
});

describe('formatPhase', () => {
  it('returns "0m" for 0 seconds', () => {
    expect(formatPhase(0)).toBe('0m');
  });

  it('returns minutes-only for values under 1 hour', () => {
    expect(formatPhase(59 * 60)).toBe('59m');
    expect(formatPhase(30 * 60)).toBe('30m');
  });

  it('boundary: 3599 seconds (just under 1h) returns minutes', () => {
    expect(formatPhase(3599)).toBe('59m');
  });

  it('boundary: exactly 3600 seconds returns "1h 0m"', () => {
    expect(formatPhase(3600)).toBe('1h 0m');
  });

  it('returns hours + minutes for values >= 1 hour', () => {
    expect(formatPhase(3600 + 45 * 60)).toBe('1h 45m');
    expect(formatPhase(2 * 3600 + 10 * 60)).toBe('2h 10m');
  });

  it('floors seconds within minutes', () => {
    // 3660 seconds = 1h 1m (61 seconds past 1h)
    expect(formatPhase(3660)).toBe('1h 1m');
  });
});

describe('computeSleepPercentages', () => {
  it('returns all zeros when total sleep is 0', () => {
    const result = computeSleepPercentages({ rem: 0, deep: 0, core: 0, awake: 300 });
    expect(result).toEqual({ deepPct: 0, remPct: 0, corePct: 0 });
  });

  it('computes correct percentages for equal phases', () => {
    const phases: SleepPhases = { rem: 3600, deep: 3600, core: 3600, awake: 600 };
    const result = computeSleepPercentages(phases);
    expect(result.deepPct).toBe(33);
    expect(result.remPct).toBe(33);
    expect(result.corePct).toBe(33);
  });

  it('computes correct percentages for 100% deep', () => {
    const phases: SleepPhases = { rem: 0, deep: 3600, core: 0, awake: 0 };
    const result = computeSleepPercentages(phases);
    expect(result).toEqual({ deepPct: 100, remPct: 0, corePct: 0 });
  });

  it('rounds to nearest integer', () => {
    // 1/3 of each doesn't round to 34
    const phases: SleepPhases = { rem: 1, deep: 1, core: 1, awake: 0 };
    const result = computeSleepPercentages(phases);
    expect(result.deepPct).toBe(33);
    expect(result.remPct).toBe(33);
    expect(result.corePct).toBe(33);
  });

  it('does not include awake in percentage calculation', () => {
    // awake should not affect denominator
    const phases: SleepPhases = { rem: 1800, deep: 1800, core: 0, awake: 99999 };
    const result = computeSleepPercentages(phases);
    expect(result.remPct).toBe(50);
    expect(result.deepPct).toBe(50);
    expect(result.corePct).toBe(0);
  });

  it('typical night sleep proportions', () => {
    // REM ~25%, deep ~15%, core ~60%
    const phases: SleepPhases = {
      rem: 1800,   // 30m
      deep: 1200,  // 20m
      core: 4800,  // 80m
      awake: 600,
    };
    const total = 1800 + 1200 + 4800;
    const result = computeSleepPercentages(phases);
    expect(result.remPct).toBe(Math.round(1800 / total * 100));
    expect(result.deepPct).toBe(Math.round(1200 / total * 100));
    expect(result.corePct).toBe(Math.round(4800 / total * 100));
  });
});
