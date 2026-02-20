import { CLOUDFRONT_BASE, ENDPOINTS } from './constants';

// In dev mode, Vite proxies /api/live/* to CloudFront to avoid CORS issues.
// In production, fetch directly from CloudFront (CORS allows j0nathan-ll0yd.github.io).
const BASE = import.meta.env.DEV ? '/api/live' : CLOUDFRONT_BASE;

export interface FetchResult {
  health: any | null;
  sleep: any | null;
  workouts: any | null;
  books: any | null;
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
  const [health, sleep, workouts, books] = await Promise.all([
    fetchWithTimeout(BASE + ENDPOINTS.health),
    fetchWithTimeout(BASE + ENDPOINTS.sleep),
    fetchWithTimeout(BASE + ENDPOINTS.workouts),
    fetchWithTimeout(BASE + ENDPOINTS.books),
  ]);

  return { health, sleep, workouts, books };
}
