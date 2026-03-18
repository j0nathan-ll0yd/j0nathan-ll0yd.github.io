// @vitest-environment jsdom
import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';
import { PollEngine } from '../../src/lib/poll-engine';

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

describe('PollEngine', () => {
  let onUpdate: ReturnType<typeof vi.fn>;
  let onError: ReturnType<typeof vi.fn>;
  let onStatusChange: ReturnType<typeof vi.fn>;
  let engine: PollEngine;

  beforeEach(() => {
    vi.useFakeTimers();
    onUpdate = vi.fn();
    onError = vi.fn();
    onStatusChange = vi.fn();
    vi.stubGlobal('fetch', vi.fn());
    Object.defineProperty(navigator, 'onLine', { value: true, configurable: true });
    engine = new PollEngine({ onUpdate, onError, onStatusChange });
  });

  afterEach(() => {
    engine.stop();
    vi.useRealTimers();
    vi.unstubAllGlobals();
  });

  describe('constructor', () => {
    it('creates engine without throwing', () => {
      expect(engine).toBeDefined();
    });

    it('getStatus() returns disconnected initially', () => {
      const status = engine.getStatus();
      expect(status.connected).toBe(false);
      expect(status.lastPollAt).toBeNull();
      expect(status.errorCounts).toEqual({});
      expect(status.wsConnected).toBe(false);
    });
  });

  describe('seed()', () => {
    it('seeds fingerprints so unchanged data is skipped', async () => {
      const fetchMock = vi.fn().mockResolvedValue(
        makeFetchResponse({ generatedAt: '2024-01-01T00:00:00Z', data: 'x' })
      );
      vi.stubGlobal('fetch', fetchMock);

      engine.seed({ health: '2024-01-01T00:00:00Z' });
      await engine.pollResource('health');

      // onUpdate should NOT be called because fingerprint matches
      expect(onUpdate).not.toHaveBeenCalled();
    });

    it('ignores null values in seed timestamps', () => {
      engine.seed({ health: null as unknown as string, sleep: '2024-01-01T00:00:00Z' });
      // No error thrown; null values are skipped
      expect(engine.getStatus().errorCounts).toEqual({});
    });
  });

  describe('start()', () => {
    it('sets connected=true after start when online', () => {
      engine.start();
      expect(engine.getStatus().connected).toBe(true);
    });

    it('is idempotent — calling start() twice does not double-register timers', () => {
      engine.start();
      engine.start();
      expect(onStatusChange).toHaveBeenCalledTimes(1);
    });

    it('emits status on start', () => {
      engine.start();
      expect(onStatusChange).toHaveBeenCalledOnce();
    });
  });

  describe('stop()', () => {
    it('sets connected=false after stop', () => {
      engine.start();
      engine.stop();
      expect(engine.getStatus().connected).toBe(false);
    });

    it('emits status on stop', () => {
      engine.start();
      onStatusChange.mockClear();
      engine.stop();
      expect(onStatusChange).toHaveBeenCalledOnce();
    });

    it('cleans up visibilitychange listener on stop', () => {
      const removeSpy = vi.spyOn(document, 'removeEventListener');
      engine.start();
      engine.stop();
      expect(removeSpy).toHaveBeenCalledWith('visibilitychange', expect.any(Function));
    });
  });

  describe('setMode()', () => {
    it('setMode("passive") sets wsConnected=true', () => {
      engine.setMode('passive');
      expect(engine.getStatus().wsConnected).toBe(true);
    });

    it('setMode("active") sets wsConnected=false', () => {
      engine.setMode('passive');
      engine.setMode('active');
      expect(engine.getStatus().wsConnected).toBe(false);
    });

    it('calling setMode with the same mode is a no-op', () => {
      engine.setMode('active'); // already active by default
      expect(onStatusChange).not.toHaveBeenCalled();
    });

    it('passive mode uses longer intervals (120s fast, 300s slow)', () => {
      const fetchMock = vi.fn().mockResolvedValue(
        makeFetchResponse({ generatedAt: '2024-01-01T00:00:00Z' })
      );
      vi.stubGlobal('fetch', fetchMock);

      engine.start();
      engine.setMode('passive');
      fetchMock.mockClear();

      // At 30s (active fast interval) — should NOT fire in passive mode
      vi.advanceTimersByTime(30_000);
      expect(fetchMock).not.toHaveBeenCalled();

      // At 120s — passive fast interval fires
      vi.advanceTimersByTime(90_000);
      expect(fetchMock).toHaveBeenCalled();
    });

    it('active mode uses shorter intervals (30s fast)', () => {
      const fetchMock = vi.fn().mockResolvedValue(
        makeFetchResponse({ generatedAt: '2024-01-01T00:00:00Z' })
      );
      vi.stubGlobal('fetch', fetchMock);

      engine.start();
      vi.advanceTimersByTime(30_000);
      expect(fetchMock).toHaveBeenCalled();
    });
  });

  describe('fetchResource()', () => {
    it('calls onUpdate with new data when fingerprint differs', async () => {
      const fetchMock = vi.fn().mockResolvedValue(
        makeFetchResponse({ generatedAt: '2024-01-02T00:00:00Z', value: 42 })
      );
      vi.stubGlobal('fetch', fetchMock);

      engine.seed({ health: '2024-01-01T00:00:00Z' });
      await engine.pollResource('health');

      expect(onUpdate).toHaveBeenCalledWith('health', { generatedAt: '2024-01-02T00:00:00Z', value: 42 });
    });

    it('skips onUpdate when fingerprint is unchanged', async () => {
      const ts = '2024-01-01T00:00:00Z';
      vi.stubGlobal('fetch', vi.fn().mockResolvedValue(
        makeFetchResponse({ generatedAt: ts })
      ));

      engine.seed({ health: ts });
      await engine.pollResource('health');

      expect(onUpdate).not.toHaveBeenCalled();
    });

    it('calls onError on HTTP error (non-ok response)', async () => {
      vi.stubGlobal('fetch', vi.fn().mockResolvedValue(
        makeFetchResponse(null, false, 500)
      ));

      await engine.pollResource('health');

      expect(onError).toHaveBeenCalledWith('health', expect.objectContaining({ message: 'HTTP 500' }));
    });

    it('calls onError on network error', async () => {
      vi.stubGlobal('fetch', vi.fn().mockRejectedValue(new Error('Network failure')));

      await engine.pollResource('health');

      expect(onError).toHaveBeenCalledWith('health', expect.objectContaining({ message: 'Network failure' }));
    });

    it('increments errorCounts on repeated errors', async () => {
      vi.stubGlobal('fetch', vi.fn().mockRejectedValue(new Error('fail')));

      await engine.pollResource('health');
      await engine.pollResource('health');

      expect(engine.getStatus().errorCounts.health).toBe(2);
    });

    it('clears errorCounts on successful fetch', async () => {
      vi.stubGlobal('fetch', vi.fn()
        .mockRejectedValueOnce(new Error('fail'))
        .mockResolvedValueOnce(makeFetchResponse({ generatedAt: '2024-01-02T00:00:00Z' }))
      );

      await engine.pollResource('health');
      expect(engine.getStatus().errorCounts.health).toBe(1);

      await engine.pollResource('health');
      expect(engine.getStatus().errorCounts.health).toBeUndefined();
    });

    it('updates lastPollAt after a poll', async () => {
      vi.stubGlobal('fetch', vi.fn().mockResolvedValue(
        makeFetchResponse({ generatedAt: '2024-01-01T00:00:00Z' })
      ));

      expect(engine.getStatus().lastPollAt).toBeNull();
      await engine.pollResource('health');
      expect(engine.getStatus().lastPollAt).not.toBeNull();
    });
  });

  describe('getStatus()', () => {
    it('returns correct shape', () => {
      const status = engine.getStatus();
      expect(status).toHaveProperty('connected');
      expect(status).toHaveProperty('lastPollAt');
      expect(status).toHaveProperty('errorCounts');
      expect(status).toHaveProperty('wsConnected');
    });

    it('connected reflects navigator.onLine', () => {
      engine.start();
      Object.defineProperty(navigator, 'onLine', { value: false, configurable: true });
      expect(engine.getStatus().connected).toBe(false);
    });
  });

  describe('visibility change', () => {
    it('pauses timers when document becomes hidden', () => {
      const fetchMock = vi.fn().mockResolvedValue(
        makeFetchResponse({ generatedAt: '2024-01-01T00:00:00Z' })
      );
      vi.stubGlobal('fetch', fetchMock);

      engine.start();

      // Simulate tab hidden
      Object.defineProperty(document, 'hidden', { value: true, configurable: true });
      document.dispatchEvent(new Event('visibilitychange'));

      fetchMock.mockClear();
      vi.advanceTimersByTime(60_000);
      expect(fetchMock).not.toHaveBeenCalled();
    });

    it('resumes and immediately polls when document becomes visible', async () => {
      const fetchMock = vi.fn().mockResolvedValue(
        makeFetchResponse({ generatedAt: '2024-01-01T00:00:00Z' })
      );
      vi.stubGlobal('fetch', fetchMock);

      engine.start();

      // Hide then show
      Object.defineProperty(document, 'hidden', { value: true, configurable: true });
      document.dispatchEvent(new Event('visibilitychange'));

      fetchMock.mockClear();

      Object.defineProperty(document, 'hidden', { value: false, configurable: true });
      document.dispatchEvent(new Event('visibilitychange'));

      // Flush microtasks so the async pollNow() call can initiate fetches
      await Promise.resolve();
      await Promise.resolve();

      expect(fetchMock).toHaveBeenCalled();
    });
  });
});
