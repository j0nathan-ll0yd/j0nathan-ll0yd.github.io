import { CLOUDFRONT_BASE, ENDPOINTS } from './constants';
import type { HealthExport, SleepExport, WorkoutsExport, BooksExport, GithubEventsExport } from '../types/exports';

// In dev mode, Vite proxies /api/live/* to CloudFront to avoid CORS issues.
// In production, fetch directly from CloudFront (CORS allows j0nathan-ll0yd.github.io).
const BASE = import.meta.env.DEV ? '/api/live' : CLOUDFRONT_BASE;

export interface FetchResult {
  health: HealthExport | null;
  sleep: SleepExport | null;
  workouts: WorkoutsExport | null;
  books: BooksExport | null;
  githubEvents: GithubEventsExport | null;
  timestamps: Record<string, string | null>;
}

async function fetchWithTimeout<T>(url: string, timeoutMs: number = 5000): Promise<T | null> {
  const controller = new AbortController();
  const timer = setTimeout(() => controller.abort(), timeoutMs);
  try {
    const res = await fetch(url, { signal: controller.signal });
    if (!res.ok) return null;
    return await res.json() as T;
  } catch {
    return null;
  } finally {
    clearTimeout(timer);
  }
}

export async function fetchAllEndpoints(): Promise<FetchResult> {
  // starredRepos is fetched solely for its generatedAt timestamp (System Status widget).
  // Its payload is not used elsewhere — StarredRepoList is build-time only.
  const [health, sleep, workouts, books, githubEvents, starredRepos] = await Promise.all([
    fetchWithTimeout<HealthExport>(BASE + ENDPOINTS.health),
    fetchWithTimeout<SleepExport>(BASE + ENDPOINTS.sleep),
    fetchWithTimeout<WorkoutsExport>(BASE + ENDPOINTS.workouts),
    fetchWithTimeout<BooksExport>(BASE + ENDPOINTS.books),
    fetchWithTimeout<GithubEventsExport>(BASE + ENDPOINTS.githubEvents),
    fetchWithTimeout<{ generatedAt: string }>(BASE + ENDPOINTS.starredRepos),
  ]);

  return {
    health, sleep, workouts, books, githubEvents,
    timestamps: {
      health: health?.generatedAt ?? null,
      sleep: sleep?.generatedAt ?? null,
      books: books?.generatedAt ?? null,
      githubEvents: githubEvents?.generatedAt ?? null,
      starredRepos: starredRepos?.generatedAt ?? null,
    },
  };
}
