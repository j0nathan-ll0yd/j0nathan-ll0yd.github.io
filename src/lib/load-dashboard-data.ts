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
