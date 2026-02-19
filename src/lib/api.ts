import { CLOUDFRONT_BASE, ENDPOINTS } from './constants';

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
    fetchWithTimeout(CLOUDFRONT_BASE + ENDPOINTS.health),
    fetchWithTimeout(CLOUDFRONT_BASE + ENDPOINTS.sleep),
    fetchWithTimeout(CLOUDFRONT_BASE + ENDPOINTS.workouts),
    fetchWithTimeout(CLOUDFRONT_BASE + ENDPOINTS.books),
  ]);

  return { health, sleep, workouts, books };
}
