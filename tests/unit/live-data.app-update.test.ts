// @vitest-environment jsdom
import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';

// Characterization test for the wiring this refactor relocated from the design
// system: live-data forwards a WebSocket 'app-update' push (and a reconnect) to
// the app-owned service-worker nudge `window.__checkForSwUpdate`. live-data.ts is
// a side-effecting module, so we mock its heavy collaborators and drive the
// captured WSClient callbacks.

interface CapturedWsOpts {
  onAppUpdate?: (build?: string) => void;
  onStateChange?: (connected: boolean) => void;
}
let wsOpts: CapturedWsOpts | null = null;

vi.mock('../../src/lib/runtime/ws-client', () => ({
  WSClient: class {
    constructor(opts: CapturedWsOpts) {
      wsOpts = opts;
    }
    connect(): void {}
    disconnect(): void {}
  },
}));

vi.mock('../../src/lib/runtime/poll-engine', () => ({
  PollEngine: class {
    seed(): void {}
    start(): void {}
    setMode(): void {}
    pollResource(): Promise<void> {
      return Promise.resolve();
    }
    pollNow(): Promise<void> {
      return Promise.resolve();
    }
  },
}));

vi.mock('../../src/lib/runtime/api', () => ({
  fetchWithTimeout: () => Promise.resolve(null),
  fetchAllEndpoints: () =>
    Promise.resolve({
      health: null,
      sleep: null,
      workouts: null,
      books: null,
      githubEvents: null,
      starredRepos: null,
      articles: null,
      location: null,
      focus: null,
      theatreReviews: null,
      timestamps: {},
    }),
}));

vi.mock('@lifegames/portal-contract/constants', () => ({
  CLOUDFRONT_BASE: 'https://mock.cloudfront.net',
  WEBSOCKET_URL: 'wss://mock.example.com/live',
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

type SwWindow = Window & { __checkForSwUpdate?: () => void };

async function bootLiveData(): Promise<void> {
  await import('../../src/lib/runtime/live-data');
  await vi.runAllTimersAsync(); // flush the deferred startFetch + awaited fetches
}

describe('live-data → service-worker nudge wiring', () => {
  beforeEach(() => {
    wsOpts = null;
    vi.resetModules();
    vi.useFakeTimers();
    document.body.innerHTML = '';
  });

  afterEach(() => {
    vi.useRealTimers();
    delete (window as SwWindow).__checkForSwUpdate;
  });

  it('invokes window.__checkForSwUpdate on an app-update push', async () => {
    const nudge = vi.fn();
    (window as SwWindow).__checkForSwUpdate = nudge;

    await bootLiveData();

    expect(wsOpts).not.toBeNull();
    expect(typeof wsOpts?.onAppUpdate).toBe('function');
    wsOpts?.onAppUpdate?.('deadbeef');
    expect(nudge).toHaveBeenCalledTimes(1);
  });

  it('re-checks on WebSocket (re)connect to catch a missed push', async () => {
    const nudge = vi.fn();
    (window as SwWindow).__checkForSwUpdate = nudge;

    await bootLiveData();

    wsOpts?.onStateChange?.(true);
    expect(nudge).toHaveBeenCalledTimes(1);
  });

  it('is a no-op when the service-worker hook is absent', async () => {
    await bootLiveData();
    expect(() => wsOpts?.onAppUpdate?.()).not.toThrow();
  });
});
