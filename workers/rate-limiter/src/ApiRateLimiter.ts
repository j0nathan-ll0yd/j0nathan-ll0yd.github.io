// The developer API facade's rate-limit counter (owner decision 2026-10-24, option B). One object per
// client, named by the SHA-256 of the client's address partition (src/lib/edge/rate-limit.ts
// `clientKey`). It owns one fixed window: the count and the window end, in the SQLite-backed
// synchronous KV API (developers.cloudflare.com/durable-objects/api/sqlite-storage-api/,
// `ctx.storage.kv`). An alarm at the window end deletes the object's storage, so nothing about a
// client outlives its window.
//
// This Worker (human-datastream-rate-limiter, workers/rate-limiter/wrangler.jsonc) exports the class
// and creates it with a `new_sqlite_classes` migration. The site Worker binds it as API_RATE_LIMITER
// through `script_name` (wrangler.jsonc), because Cloudflare generates no Version URL for a Worker
// that implements a Durable Object, and the site's PR previews need one.

import {DurableObject} from 'cloudflare:workers'
import {consumeWindow, isWindowState, type RateLimitDecision} from '../../../src/lib/edge/rate-limit-window'

const STATE_KEY = 'window'

export class ApiRateLimiter extends DurableObject {
  /** Counts one request. The policy travels with the call, so the Worker's constant stays the one source. */
  async consume(limit: number, windowSeconds: number): Promise<RateLimitDecision> {
    const stored = this.storedWindow()
    const {state, decision} = consumeWindow(stored, Date.now(), {policy: 'default', limit, windowSeconds})
    const opened = stored === undefined || stored.windowEndMs !== state.windowEndMs
    // A refused request changes nothing, so it writes nothing.
    if (opened || decision.allowed) {
      this.ctx.storage.kv.put(STATE_KEY, state)
    }
    if (opened) {
      await this.ctx.storage.setAlarm(state.windowEndMs)
    }
    return decision
  }

  /**
   * The window ended: forget the client. An alarm can run late, after a request has already opened
   * the next window; that window keeps its count and gets its own alarm.
   */
  async alarm(): Promise<void> {
    const stored = this.storedWindow()
    if (stored !== undefined && stored.windowEndMs > Date.now()) {
      await this.ctx.storage.setAlarm(stored.windowEndMs)
      return
    }
    await this.ctx.storage.deleteAll()
  }

  /** The stored window, or undefined when there is none or it is not a window (treated as a fresh client). */
  private storedWindow() {
    const stored = this.ctx.storage.kv.get(STATE_KEY)
    return isWindowState(stored) ? stored : undefined
  }
}
