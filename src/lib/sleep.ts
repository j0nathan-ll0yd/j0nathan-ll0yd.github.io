export interface SleepPhases {
  rem: number;    // seconds
  deep: number;   // seconds
  core: number;   // seconds
  awake: number;  // seconds
}

export function computeTotalSleepSeconds(phases: SleepPhases): number {
  return phases.rem + phases.deep + phases.core;
}

export function formatDuration(seconds: number): string {
  const hours = Math.floor(seconds / 3600);
  const minutes = Math.floor((seconds % 3600) / 60);
  return `${hours}h ${minutes}m`;
}

export function formatPhase(seconds: number): string {
  if (seconds >= 3600) {
    const hours = Math.floor(seconds / 3600);
    const minutes = Math.floor((seconds % 3600) / 60);
    return `${hours}h ${minutes}m`;
  }
  const minutes = Math.floor(seconds / 60);
  return `${minutes}m`;
}

export function computeSleepPercentages(phases: SleepPhases): { deepPct: number; remPct: number; corePct: number } {
  const totalSleep = phases.rem + phases.deep + phases.core;
  if (totalSleep === 0) return { deepPct: 0, remPct: 0, corePct: 0 };
  return {
    deepPct: Math.round(phases.deep / totalSleep * 100),
    remPct: Math.round(phases.rem / totalSleep * 100),
    corePct: Math.round(phases.core / totalSleep * 100),
  };
}
