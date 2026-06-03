import fs from 'node:fs';
import path from 'node:path';
import type { Profile, DashboardHealth, DashboardGithub, DashboardReading, DashboardBooks, System } from '@lifegames/schemas';
import { CLOUDFRONT_BASE, ENDPOINTS } from '@lifegames/web/runtime/constants';
import { adaptStarredRepos, type AdaptedStarredRepo } from '@lifegames/web/runtime/adapters';

/**
 * Dashboard-scoped health view that augments `DashboardHealth` with Phase 1 fields
 * the new `MovementRings` + expanded `HeartRate` widgets read:
 *  - additional quantity metrics (timeInDaylight, flightsClimbed, wristTemperatureDelta)
 *  - per-day activity goals (moveKcal / exerciseMin / standHr / daylightMin)
 *  - solar arc inputs (sunrise / sunset / current progress)
 *
 * These fields are mocked here until Phase 3 ships them from the backend. The base
 * `DashboardHealth` JSON schema stays strict (additionalProperties: false), so we
 * keep `data/health.json` schema-compliant and inject extras only at load time.
 */
export type DashboardHealthEx = DashboardHealth & {
  quantities: DashboardHealth['quantities'] & {
    restingHeartRate?: { value: number; unit: string };
    respiratoryRate?: { value: number; unit: string };
    wristTemperatureDelta?: { value: number; unit: string };
    timeInDaylight?: { value: number; unit: string };
    flightsClimbed?: { value: number; unit: string };
  };
  goals?: {
    moveKcal: number;
    exerciseMin: number;
    standHr: number;
    daylightMin: number;
  };
  solar?: {
    sunriseHHmm: string;
    sunsetHHmm: string;
    currentProgressPct: number;
  };
};

export type DashboardData = {
  profile: Profile;
  health: DashboardHealthEx;
  github: DashboardGithub;
  reading: DashboardReading;
  books: DashboardBooks;
  system: System;
  starredRepos: AdaptedStarredRepo[];
};

export async function loadDashboardData(): Promise<DashboardData> {
  const useFixtures = process.env.USE_FIXTURES === 'true';
  console.log('[loadDashboardData] using fixtures: ' + useFixtures);

  const dataDir = useFixtures
    ? path.join(process.cwd(), 'test', 'fixtures', 'build-data')
    : path.join(process.cwd(), 'data');

  const readJson = (name: string) =>
    JSON.parse(fs.readFileSync(path.join(dataDir, name), 'utf-8'));

  const profile: Profile = readJson('profile.json');
  const healthRaw: DashboardHealth = readJson('health.json');
  const health: DashboardHealthEx = enrichHealthForPhase1(healthRaw);
  const github: DashboardGithub = readJson('github.json');
  const reading: DashboardReading = readJson('reading.json');
  const books: DashboardBooks = readJson('books.json');
  const system: System = readJson('system.json');

  let starredRepos: AdaptedStarredRepo[] = [];
  if (useFixtures) {
    const fixturePath = path.join(
      process.cwd(),
      'test', 'fixtures', 'generated', 'github-starred-repos', 'baseline.json'
    );
    try {
      const json = JSON.parse(fs.readFileSync(fixturePath, 'utf-8'));
      const fixtureNow = json.generatedAt ? new Date(json.generatedAt).getTime() : undefined;
      starredRepos = adaptStarredRepos(json, fixtureNow);
    } catch (err) {
      console.warn('[loadDashboardData] Failed to read starred repos fixture:', (err as Error).message);
    }
  } else {
    try {
      const res = await fetch(`${CLOUDFRONT_BASE}${ENDPOINTS.starredRepos}`);
      const json = await res.json();
      starredRepos = adaptStarredRepos(json);
    } catch (err) {
      console.warn('[loadDashboardData] Failed to fetch starred repos:', (err as Error).message);
    }
  }

  return { profile, health, github, reading, books, system, starredRepos };
}

/**
 * Inject Phase 1 mock fields into `DashboardHealth` until the backend supplies them.
 * Preserves any existing values from the JSON fixture; only fills gaps.
 *
 * Mocked fields:
 *  - quantities.restingHeartRate, respiratoryRate, wristTemperatureDelta, timeInDaylight,
 *    flightsClimbed — for HeartRate footer (RHR / RR / Wrist Temp Δ) and MovementRings
 *    daylight + steps trio.
 *  - goals — default ring targets matching the Apple Watch defaults (Move 500 kcal,
 *    Exercise 30 min, Stand 12 hr) plus daylight 20 min.
 *  - solar — sunrise / sunset / current progress along arc. Hardcoded until the
 *    backend lands a solar computation (Phase 3).
 */
function enrichHealthForPhase1(h: DashboardHealth): DashboardHealthEx {
  const q = h.quantities as DashboardHealthEx['quantities'];
  return {
    ...h,
    quantities: {
      ...q,
      restingHeartRate: q.restingHeartRate ?? { value: 54, unit: 'bpm' },
      respiratoryRate: q.respiratoryRate ?? { value: 14, unit: 'br/min' },
      wristTemperatureDelta: q.wristTemperatureDelta ?? { value: 0.2, unit: '°C' },
      timeInDaylight: q.timeInDaylight ?? { value: 48, unit: 'min' },
      flightsClimbed: q.flightsClimbed ?? { value: 4, unit: 'count' },
    },
    goals: { moveKcal: 500, exerciseMin: 30, standHr: 12, daylightMin: 20 },
    solar: { sunriseHHmm: '06:30', sunsetHHmm: '20:15', currentProgressPct: 60 },
  };
}
