// audits/lib/progress.mjs -- keep a long-running check AUDIBLE, and bound the
// aggregate it spends.
//
// THE FAULT THIS CLOSES. GitHub terminates a self-hosted job at a server-side
// INACTIVITY deadline of ~600 seconds, and the trigger is SILENCE, not duration.
// Measured on this repo's own lanes: green daily run 33099282274 executed 620s and
// PASSED, its largest silent gap being 110.4s across 802 log lines. Four jobs died at
// 600 +/- 1s, and each contained exactly one silent interval immediately before
// termination:
//
//   run 36385626855  569.1s  B2 -- external spec currency   (step reported success)
//   run 36387113309  926.4s  B6 -- analytics beacons        (never concluded)
//   run 36530802342 1015.5s  Install dependencies           (never concluded)
//   run 36823973866  947.9s  Setup Node.js                  (nodejs.org fallback)
//
// So `timeout-minutes` is IRRELEVANT to this failure mode: the daily ceiling is 20
// minutes and the weekly 15, both above 600s, so neither can ever fire first. A step
// that runs nine minutes while printing every thirty seconds survives; a step that
// runs nine minutes silently does not. Making a step faster is only half a fix --
// emitting progress is the durable half, which is what this module is for.
//
// WHY A SHARED MODULE RATHER THAN A console.log PER CHECK. The silence is a property
// of the LANE, not of any one runner, and three of the four receipts above are in
// different steps. A per-check fix leaves the next silent check to be discovered the
// same way. One seam means a check becomes audible by wrapping its awaits, and the
// interval is stated in one place against one deadline.

/**
 * How often a heartbeat speaks while an operation is in flight.
 *
 * 30s against a ~600s deadline is a 20x margin, and it is deliberately far below the
 * deadline rather than just under it: the receipts above show the gap that kills is an
 * order of magnitude over this, so the useful property is "cannot plausibly be missed",
 * not "fits with room to spare". It is also above the 110.4s largest gap of the green
 * 620s run, so a healthy slow lane was never close to this bound either way.
 */
export const HEARTBEAT_INTERVAL_MS = 30_000

/**
 * Print `message` as a progress line.
 *
 * Progress lines are prefixed with two spaces to sit under the same check header
 * `report()` prints, so a reader sees one indented block per check rather than two
 * competing output shapes.
 */
export function progress(message, {log = console.log} = {}) {
  log(`  ${message}`)
}

/**
 * Begin announcing that `label` is still in flight, every `intervalMs`.
 *
 * The timer is `unref`'d so it can never hold the process open past its work -- a
 * heartbeat that outlived its operation would turn a fast check into a hanging one,
 * which is the fault this module exists to prevent rather than cause.
 *
 * @returns {() => void} idempotent stop function
 */
export function startHeartbeat(label, {
  intervalMs = HEARTBEAT_INTERVAL_MS,
  log = console.log,
  now = Date.now,
  timers = {setInterval, clearInterval}
} = {}) {
  const schedule = timers.setInterval
  const cancel = timers.clearInterval
  const startedAt = now()
  const handle = schedule(() => {
    progress(`... still waiting on ${label} after ${Math.round((now() - startedAt) / 1000)}s`, {log})
  }, intervalMs)
  handle?.unref?.()
  let stopped = false
  return () => {
    if (!stopped) {
      stopped = true
      cancel(handle)
    }
  }
}

/**
 * Run `fn` with a heartbeat announcing `label` until it settles.
 *
 * The stop is in a `finally`, so a throwing operation stops its own heartbeat -- a
 * rejected await that kept beating would report progress on work that had already
 * failed.
 */
export async function withHeartbeat(label, fn, opts = {}) {
  const stop = startHeartbeat(label, opts)
  try {
    return await fn()
  } finally {
    stop()
  }
}

/**
 * A wall-clock budget for a WHOLE phase, not for one request.
 *
 * WHY THE AGGREGATE NEEDS ITS OWN BOUND. Every fetch in `audits/` is already bounded
 * per call -- `DEFAULT_BUDGET_MS` is 20s and `AbortSignal.timeout` was verified to hold
 * on node v24.16.0 for a stalled header, a trickled body AND a DROPped connect (2004ms,
 * 2003ms and 2002ms against a 2000ms signal). Yet run 36385626855's spec-currency step
 * spent 569s making SIX calls that every one of them SUCCEEDED, against a per-call
 * ceiling of 6 x 20s = 120s. Whatever leaked, a per-call cap demonstrably did not bound
 * the total, so the total is bounded here as well. Defence in depth for a mechanism not
 * yet identified, which is the honest reason to add it.
 *
 * `remaining()` is floored at 1ms rather than 0: a zero-length `AbortSignal.timeout`
 * aborts before the request is even attempted, which would report a reachable source as
 * unreachable.
 */
export function createDeadline(budgetMs, {now = Date.now} = {}) {
  const startedAt = now()
  const endsAt = startedAt + budgetMs
  return {budgetMs, elapsedMs: () => now() - startedAt, remainingMs: () => Math.max(1, endsAt - now()), expired: () => now() >= endsAt}
}
