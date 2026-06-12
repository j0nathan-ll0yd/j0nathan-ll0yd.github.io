import fs from 'node:fs';
import path from 'node:path';
import type { Profile, DashboardHealth, DashboardGithub, DashboardReading, DashboardBooks, System } from '@lifegames/schemas';
import { CLOUDFRONT_BASE, ENDPOINTS } from '@lifegames/web/runtime/constants';
import { adaptStarredRepos, type AdaptedStarredRepo } from '@lifegames/web/runtime/adapters';

export type DashboardData = {
  profile: Profile;
  health: DashboardHealth;
  github: DashboardGithub;
  reading: DashboardReading;
  books: DashboardBooks;
  system: System;
  starredRepos: AdaptedStarredRepo[];
};

/**
 * Loads the dashboard payload that backs SSR build output.
 *
 * @buildtime This function only runs at Astro build time (`pnpm build`),
 * never in deployed SSR or in the browser. The `console.log` below is
 * intentionally a plain stdout write — build logs surface in CI/terminal
 * output, and routing it through a structured logger would add a runtime
 * dependency for zero observability benefit. If this ever moves to an
 * SSR/edge code path, swap to a structured logger before doing so.
 */
export async function loadDashboardData(): Promise<DashboardData> {
  const useFixtures = process.env.USE_FIXTURES === 'true';
  console.log('[build] [loadDashboardData] using fixtures: ' + useFixtures);

  const dataDir = useFixtures
    ? path.join(process.cwd(), 'test', 'fixtures', 'build-data')
    : path.join(process.cwd(), 'data');

  const readJson = (name: string) =>
    JSON.parse(fs.readFileSync(path.join(dataDir, name), 'utf-8'));

  const profile: Profile = readJson('profile.json');
  const health: DashboardHealth = readJson('health.json');
  const github: DashboardGithub = readJson('github.json');
  const reading: DashboardReading = readJson('reading.json');
  const books: DashboardBooks = readJson('books.json');
  const system: System = readJson('system.json');

  let starredRepos: AdaptedStarredRepo[] = [];
  try {
    let rawJson: unknown;
    let adaptNow: number | undefined;
    if (useFixtures) {
      const fixturePath = path.join(
        process.cwd(),
        'test', 'fixtures', 'generated', 'github-starred-repos', 'baseline.json'
      );
      rawJson = JSON.parse(fs.readFileSync(fixturePath, 'utf-8'));
      // Pin relative-time strings to the fixture's generation timestamp so
      // test output is deterministic regardless of when the build runs.
      const generatedAt = (rawJson as { generatedAt?: string }).generatedAt;
      adaptNow = generatedAt ? new Date(generatedAt).getTime() : undefined;
    } else {
      const res = await fetch(`${CLOUDFRONT_BASE}${ENDPOINTS.starredRepos}`);
      rawJson = await res.json();
      // Live path: let adaptStarredRepos use real Date.now() so relative times
      // reflect when the user visits, not when the export was generated.
    }
    starredRepos = adaptStarredRepos(rawJson as Parameters<typeof adaptStarredRepos>[0], adaptNow);
  } catch (err) {
    console.warn('[loadDashboardData] Failed to load starred repos:', (err as Error).message);
  }

  return { profile, health, github, reading, books, system, starredRepos };
}
