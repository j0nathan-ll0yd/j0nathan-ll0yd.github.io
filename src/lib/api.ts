import { CLOUDFRONT_BASE, ENDPOINTS } from './constants';

// In dev mode, Vite proxies /api/live/* to CloudFront to avoid CORS issues.
// In production, fetch directly from CloudFront (CORS allows j0nathan-ll0yd.github.io).
const BASE = import.meta.env.DEV ? '/api/live' : CLOUDFRONT_BASE;

export interface FetchResult {
  health: any | null;
  sleep: any | null;
  workouts: any | null;
  books: any | null;
  githubEvents: any | null;
  timestamps: Record<string, string | null>;
}

async function fetchWithTimeout(url: string, timeoutMs: number = 5000): Promise<any | null> {
  const controller = new AbortController();
  const timer = setTimeout(() => controller.abort(), timeoutMs);
  try {
    const res = await fetch(url, { signal: controller.signal });
    if (!res.ok) return null;
    return await res.json();
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
    fetchWithTimeout(BASE + ENDPOINTS.health),
    fetchWithTimeout(BASE + ENDPOINTS.sleep),
    fetchWithTimeout(BASE + ENDPOINTS.workouts),
    fetchWithTimeout(BASE + ENDPOINTS.books),
    fetchWithTimeout(BASE + ENDPOINTS.githubEvents),
    fetchWithTimeout(BASE + ENDPOINTS.starredRepos),
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
