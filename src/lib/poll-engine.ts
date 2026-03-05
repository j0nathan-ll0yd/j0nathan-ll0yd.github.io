import { CLOUDFRONT_BASE, ENDPOINTS } from './constants';
import { isDevMode } from './dev-mode';

export type ResourceKey = keyof typeof ENDPOINTS;
type ResourceCallback = (key: ResourceKey, data: unknown) => void;
type ErrorCallback = (key: ResourceKey, error: Error) => void;
type StatusCallback = (status: PollStatus) => void;

export interface PollStatus {
  connected: boolean;
  lastPollAt: string | null;
  errorCounts: Partial<Record<ResourceKey, number>>;
}

interface PollEngineOptions {
  onUpdate: ResourceCallback;
  onError?: ErrorCallback;
  onStatusChange?: StatusCallback;
}

// Fast tier: resources that change frequently (iOS syncs multiple times per hour)
const FAST_KEYS: ResourceKey[] = ['health', 'sleep', 'workouts', 'focus'];
// Slow tier: resources that change infrequently
const SLOW_KEYS: ResourceKey[] = ['books', 'articles', 'githubEvents', 'starredRepos'];
// DEV-only: location polling (tree-shaken in production)
const DEV_KEYS: ResourceKey[] = import.meta.env.DEV ? ['location'] : [];

const FAST_INTERVAL_MS = 30_000;
const SLOW_INTERVAL_MS = 120_000;

const BASE = import.meta.env.DEV ? '/api/live' : CLOUDFRONT_BASE;

export class PollEngine {
  private fingerprints = new Map<ResourceKey, string>();
  private errorCounts = new Map<ResourceKey, number>();
  private fastTimer: ReturnType<typeof setInterval> | null = null;
  private slowTimer: ReturnType<typeof setInterval> | null = null;
  private running = false;
  private lastPollAt: string | null = null;
  private opts: PollEngineOptions;
  private visibilityHandler: (() => void) | null = null;

  constructor(opts: PollEngineOptions) {
    this.opts = opts;
  }

  /** Seed with initial generatedAt fingerprints from fetchAllEndpoints */
  seed(timestamps: Record<string, string | null>): void {
    for (const [key, val] of Object.entries(timestamps)) {
      if (val) this.fingerprints.set(key as ResourceKey, val);
    }
  }

  start(): void {
    if (this.running || isDevMode()) return;
    this.running = true;

    this.fastTimer = setInterval(() => this.pollTier([...FAST_KEYS, ...DEV_KEYS]), FAST_INTERVAL_MS);
    this.slowTimer = setInterval(() => this.pollTier(SLOW_KEYS), SLOW_INTERVAL_MS);

    this.visibilityHandler = () => {
      if (document.hidden) {
        this.pause();
      } else {
        this.resume();
      }
    };
    document.addEventListener('visibilitychange', this.visibilityHandler);

    this.emitStatus();
  }

  stop(): void {
    this.running = false;
    this.clearTimers();
    if (this.visibilityHandler) {
      document.removeEventListener('visibilitychange', this.visibilityHandler);
      this.visibilityHandler = null;
    }
    this.emitStatus();
  }

  /** Immediately poll a specific resource */
  async pollResource(key: ResourceKey): Promise<void> {
    await this.fetchResource(key);
    this.lastPollAt = new Date().toISOString();
    this.emitStatus();
  }

  /** Immediately poll all resources */
  async pollNow(): Promise<void> {
    await this.pollTier([...FAST_KEYS, ...DEV_KEYS, ...SLOW_KEYS]);
  }

  getStatus(): PollStatus {
    return {
      connected: this.running && navigator.onLine,
      lastPollAt: this.lastPollAt,
      errorCounts: Object.fromEntries(this.errorCounts),
    };
  }

  private pause(): void {
    this.clearTimers();
  }

  private resume(): void {
    if (!this.running) return;
    // Immediate poll on tab return, then restart timers
    this.pollNow();
    this.fastTimer = setInterval(() => this.pollTier([...FAST_KEYS, ...DEV_KEYS]), FAST_INTERVAL_MS);
    this.slowTimer = setInterval(() => this.pollTier(SLOW_KEYS), SLOW_INTERVAL_MS);
  }

  private clearTimers(): void {
    if (this.fastTimer) { clearInterval(this.fastTimer); this.fastTimer = null; }
    if (this.slowTimer) { clearInterval(this.slowTimer); this.slowTimer = null; }
  }

  private async pollTier(keys: ResourceKey[]): Promise<void> {
    await Promise.all(keys.map(k => this.fetchResource(k)));
    this.lastPollAt = new Date().toISOString();
    this.emitStatus();
  }

  private async fetchResource(key: ResourceKey): Promise<void> {
    // Append ?_poll=1 to bypass Workbox service worker
    const url = BASE + ENDPOINTS[key] + '?_poll=1';
    const controller = new AbortController();
    const timer = setTimeout(() => controller.abort(), 5000);

    try {
      const res = await fetch(url, { signal: controller.signal });
      clearTimeout(timer);

      if (!res.ok) {
        this.recordError(key, new Error(`HTTP ${res.status}`));
        return;
      }

      const data = await res.json();

      // Compare generatedAt fingerprint — skip update if unchanged
      const generatedAt = (data as { generatedAt?: string }).generatedAt;
      const prev = this.fingerprints.get(key);

      if (generatedAt && generatedAt === prev) {
        this.errorCounts.delete(key);
        return;
      }

      if (generatedAt) this.fingerprints.set(key, generatedAt);
      this.errorCounts.delete(key);
      this.opts.onUpdate(key, data);
    } catch (err) {
      clearTimeout(timer);
      this.recordError(key, err instanceof Error ? err : new Error(String(err)));
    }
  }

  private recordError(key: ResourceKey, error: Error): void {
    const count = (this.errorCounts.get(key) ?? 0) + 1;
    this.errorCounts.set(key, count);
    this.opts.onError?.(key, error);
  }

  private emitStatus(): void {
    this.opts.onStatusChange?.(this.getStatus());
  }
}
