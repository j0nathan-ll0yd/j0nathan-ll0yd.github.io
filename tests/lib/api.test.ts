import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';
import { fetchWithTimeout, fetchAllEndpoints } from '../../src/lib/api';

// Mock constants module
vi.mock('../../src/lib/constants', () => ({
  CLOUDFRONT_BASE: 'https://mock.cloudfront.net',
  ENDPOINTS: {
    health: '/health.json',
    sleep: '/sleep.json',
    workouts: '/workouts.json',
    books: '/books.json',
    starredRepos: '/github-starred-repos.json',
    githubEvents: '/github-events.json',
    articles: '/articles.json',
    location: '/location.json',
    focus: '/focus.json',
    theatreReviews: '/theatre-reviews.json',
  },
}));

function makeFetchResponse(data: unknown, ok = true, status = 200) {
  return {
    ok,
    status,
    json: () => Promise.resolve(data),
  };
}

// Minimal fixture data with generatedAt for timestamps test
const healthFixture = { generatedAt: '2024-01-01T00:00:00Z', heartRate: 72 };
const sleepFixture = { generatedAt: '2024-01-01T00:00:00Z', duration: 7.5 };
const workoutsFixture = { generatedAt: '2024-01-01T00:00:00Z', workouts: [] };
const booksFixture = { generatedAt: '2024-01-01T00:00:00Z', books: [] };
const githubEventsFixture = { generatedAt: '2024-01-01T00:00:00Z', events: [] };
const starredReposFixture = { generatedAt: '2024-01-01T00:00:00Z' };
const articlesFixture = { generatedAt: '2024-01-01T00:00:00Z', articles: [] };
const locationFixture = { generatedAt: '2024-01-01T00:00:00Z', lat: 37.7, lng: -122.4 };
const focusFixture = { generatedAt: '2024-01-01T00:00:00Z', sessions: [] };
const theatreFixture = { generatedAt: '2024-01-01T00:00:00Z', reviews: [] };

describe('fetchWithTimeout', () => {
  beforeEach(() => {
    vi.useFakeTimers();
  });

  afterEach(() => {
    vi.useRealTimers();
    vi.unstubAllGlobals();
  });

  it('returns parsed JSON on success', async () => {
    vi.stubGlobal('fetch', vi.fn().mockResolvedValue(makeFetchResponse({ foo: 'bar' })));

    const promise = fetchWithTimeout<{ foo: string }>('https://example.com/data.json');
    await vi.runAllTimersAsync();
    const result = await promise;

    expect(result).toEqual({ foo: 'bar' });
  });

  it('returns null for 404 response', async () => {
    vi.stubGlobal('fetch', vi.fn().mockResolvedValue(makeFetchResponse(null, false, 404)));

    const promise = fetchWithTimeout('https://example.com/missing.json');
    await vi.runAllTimersAsync();
    const result = await promise;

    expect(result).toBeNull();
  });

  it('returns null for 500 response', async () => {
    vi.stubGlobal('fetch', vi.fn().mockResolvedValue(makeFetchResponse(null, false, 500)));

    const promise = fetchWithTimeout('https://example.com/error.json');
    await vi.runAllTimersAsync();
    const result = await promise;

    expect(result).toBeNull();
  });

  it('returns null on network error', async () => {
    vi.stubGlobal('fetch', vi.fn().mockRejectedValue(new Error('Network error')));

    const promise = fetchWithTimeout('https://example.com/data.json');
    await vi.runAllTimersAsync();
    const result = await promise;

    expect(result).toBeNull();
  });

  it('returns null on timeout (AbortError)', async () => {
    vi.stubGlobal('fetch', vi.fn().mockImplementation((_url: string, opts: { signal?: AbortSignal }) => {
      return new Promise((_resolve, reject) => {
        if (opts?.signal) {
          opts.signal.addEventListener('abort', () => {
            reject(new DOMException('The operation was aborted.', 'AbortError'));
          });
        }
      });
    }));

    const promise = fetchWithTimeout('https://example.com/slow.json', 1000);
    vi.advanceTimersByTime(1000);
    await vi.runAllTimersAsync();
    const result = await promise;

    expect(result).toBeNull();
  });
});

describe('fetchAllEndpoints', () => {
  afterEach(() => {
    vi.unstubAllGlobals();
  });

  it('returns all data when all endpoints succeed', async () => {
    // Order matches Promise.all in fetchAllEndpoints.
    // In the vitest environment import.meta.env.DEV=true, so location IS fetched:
    // health, sleep, workouts, books, githubEvents, starredRepos, articles, location, focus, theatreReviews
    const fetchMock = vi.fn()
      .mockResolvedValueOnce(makeFetchResponse(healthFixture))      // health
      .mockResolvedValueOnce(makeFetchResponse(sleepFixture))       // sleep
      .mockResolvedValueOnce(makeFetchResponse(workoutsFixture))    // workouts
      .mockResolvedValueOnce(makeFetchResponse(booksFixture))       // books
      .mockResolvedValueOnce(makeFetchResponse(githubEventsFixture))// githubEvents
      .mockResolvedValueOnce(makeFetchResponse(starredReposFixture))// starredRepos
      .mockResolvedValueOnce(makeFetchResponse(articlesFixture))    // articles
      .mockResolvedValueOnce(makeFetchResponse(locationFixture))    // location (DEV=true)
      .mockResolvedValueOnce(makeFetchResponse(focusFixture))       // focus
      .mockResolvedValueOnce(makeFetchResponse(theatreFixture));    // theatreReviews
    vi.stubGlobal('fetch', fetchMock);

    const result = await fetchAllEndpoints();

    expect(result.health).toEqual(healthFixture);
    expect(result.sleep).toEqual(sleepFixture);
    expect(result.books).toEqual(booksFixture);
    expect(result.githubEvents).toEqual(githubEventsFixture);
    expect(result.articles).toEqual(articlesFixture);
    expect(result.focus).toEqual(focusFixture);
    expect(result.theatreReviews).toEqual(theatreFixture);
  });

  it('returns null for failing endpoints without rejecting', async () => {
    const fetchMock = vi.fn()
      .mockRejectedValueOnce(new Error('fail')) // health fails
      .mockResolvedValueOnce(makeFetchResponse(sleepFixture))
      .mockResolvedValueOnce(makeFetchResponse(workoutsFixture))
      .mockResolvedValueOnce(makeFetchResponse(booksFixture))
      .mockResolvedValueOnce(makeFetchResponse(githubEventsFixture))
      .mockResolvedValueOnce(makeFetchResponse(starredReposFixture))
      .mockResolvedValueOnce(makeFetchResponse(articlesFixture))
      .mockResolvedValueOnce(makeFetchResponse(locationFixture))    // location (DEV=true)
      .mockResolvedValueOnce(makeFetchResponse(focusFixture))
      .mockResolvedValueOnce(makeFetchResponse(theatreFixture));
    vi.stubGlobal('fetch', fetchMock);

    const result = await fetchAllEndpoints();

    expect(result.health).toBeNull();
    expect(result.sleep).toEqual(sleepFixture);
  });

  it('returns all nulls when all endpoints fail', async () => {
    vi.stubGlobal('fetch', vi.fn().mockRejectedValue(new Error('all fail')));

    const result = await fetchAllEndpoints();

    expect(result.health).toBeNull();
    expect(result.sleep).toBeNull();
    expect(result.workouts).toBeNull();
    expect(result.books).toBeNull();
    expect(result.githubEvents).toBeNull();
    expect(result.articles).toBeNull();
    expect(result.focus).toBeNull();
    expect(result.theatreReviews).toBeNull();
  });

  it('populates timestamps from generatedAt fields', async () => {
    const fetchMock = vi.fn()
      .mockResolvedValueOnce(makeFetchResponse(healthFixture))
      .mockResolvedValueOnce(makeFetchResponse(sleepFixture))
      .mockResolvedValueOnce(makeFetchResponse(workoutsFixture))
      .mockResolvedValueOnce(makeFetchResponse(booksFixture))
      .mockResolvedValueOnce(makeFetchResponse(githubEventsFixture))
      .mockResolvedValueOnce(makeFetchResponse(starredReposFixture))
      .mockResolvedValueOnce(makeFetchResponse(articlesFixture))
      .mockResolvedValueOnce(makeFetchResponse(locationFixture))    // location (DEV=true)
      .mockResolvedValueOnce(makeFetchResponse(focusFixture))
      .mockResolvedValueOnce(makeFetchResponse(theatreFixture));
    vi.stubGlobal('fetch', fetchMock);

    const result = await fetchAllEndpoints();

    expect(result.timestamps.health).toBe('2024-01-01T00:00:00Z');
    expect(result.timestamps.sleep).toBe('2024-01-01T00:00:00Z');
    expect(result.timestamps.books).toBe('2024-01-01T00:00:00Z');
  });

  it('sets timestamps to null for failed endpoints', async () => {
    vi.stubGlobal('fetch', vi.fn().mockRejectedValue(new Error('fail')));

    const result = await fetchAllEndpoints();

    expect(result.timestamps.health).toBeNull();
    expect(result.timestamps.sleep).toBeNull();
  });
});
