// Shared HTTP helpers for audits/*.mjs. Every audit check fetches the
// same live origins (jonathanlloyd.me + the staging CloudFront data plane,
// which IS the live-serving data plane per atlas/surfaces.yaml)
// and needs the same resilience: a transient 5xx in the seconds after a deploy
// is not an outage (see web's tests/smoke/home.smoke.ts getStable(), issue #106)
// but a steady-state 5xx still fails once the retry budget is spent.

/** Wall-clock budget for one stable fetch. Exported so every bounded fetch in audits/ shares one number. */
export const DEFAULT_BUDGET_MS = 20_000

/** Cap on any single attempt, so one hung attempt leaves budget for a retry. */
const PER_ATTEMPT_CAP_MS = 10_000

/** True when `err` is a per-attempt AbortSignal.timeout() firing. undici rejects with the signal reason, occasionally wrapped as `cause`. */
function isAttemptTimeout(err) {
  return err?.name === 'TimeoutError' || err?.cause?.name === 'TimeoutError'
}

/** Abort signal for one attempt: min(per-attempt cap, remaining budget), composed with the caller's own signal when present. */
function attemptSignal(callerSignal, deadline, perAttemptCapMs) {
  const timeoutSignal = AbortSignal.timeout(Math.min(perAttemptCapMs, Math.max(1, deadline - Date.now())))
  return callerSignal ? AbortSignal.any([callerSignal, timeoutSignal]) : timeoutSignal
}

/**
 * Fetch a URL under a hard wall-clock budget, retrying transient upstream 5xx
 * responses with capped exponential backoff. Every attempt (headers AND body)
 * is bounded by an AbortSignal sized to the remaining budget -- previously only
 * the retry-loop condition read the deadline, so one hung attempt hung the
 * check forever (301 s / 392 s measured; atlas decision 0106). A timed-out
 * attempt counts as a failed attempt and retries immediately while budget
 * remains (the timeout itself was the delay); once the budget is spent it
 * propagates as a TimeoutError. Other network errors (DNS, TLS) are NOT
 * retried -- they indicate a real reachability problem, not a one-off gateway
 * blip, and fail the check immediately. A caller-provided `init.signal` is
 * composed in via AbortSignal.any() and its abort always propagates unretried.
 * `perAttemptCapMs` is overridable so tests can exercise the timeout-retry
 * path with tiny real budgets; production callers use the default.
 */
export async function fetchStable(url, init = {}, budgetMs = DEFAULT_BUDGET_MS, perAttemptCapMs = PER_ATTEMPT_CAP_MS) {
  const deadline = Date.now() + budgetMs
  let backoffs = 0
  while (true) {
    let res
    try {
      res = await fetch(url, {...init, signal: attemptSignal(init.signal, deadline, perAttemptCapMs)})
    } catch (err) {
      if (init.signal?.aborted || !isAttemptTimeout(err) || Date.now() >= deadline) {
        throw err
      }
      continue
    }
    if (res.status < 500) {
      return res
    }
    const backoffMs = Math.min(1_000 * 2 ** backoffs, 5_000)
    if (Date.now() + backoffMs >= deadline) {
      return res
    }
    backoffs++
    await new Promise((resolve) => setTimeout(resolve, backoffMs))
  }
}

/**
 * HEAD a URL (following redirects), retrying transient 5xx. Returns a plain
 * summary object rather than the raw Response so callers don't need to
 * remember to drain/ignore the body.
 */
export async function headStable(url, budgetMs = DEFAULT_BUDGET_MS) {
  const res = await fetchStable(url, {method: 'HEAD', redirect: 'follow'}, budgetMs)
  return {ok: res.ok, status: res.status, finalUrl: res.url || url}
}

/**
 * Print a findings list (each `{ severity: 'fail'|'warn'|'info', id, message }`)
 * under a check header, then return the process exit code: 0 if there are no
 * `fail`-severity findings, 1 otherwise. `warn` is reported but does not fail
 * the check -- promotion to blocking is a Phase 1/6 catalog decision, not
 * something an individual script decides.
 */
export function report(checkId, findings) {
  const fails = findings.filter((f) => f.severity === 'fail')
  const warns = findings.filter((f) => f.severity === 'warn')
  console.log(`\n=== ${checkId} ===`)
  if (findings.length === 0) {
    console.log('  (no findings)')
  }
  for (const f of findings) {
    console.log(`  [${f.severity}] ${f.id}: ${f.message}`)
  }
  console.log(`  ${fails.length} fail, ${warns.length} warn, ${findings.length} total`)
  return fails.length > 0 ? 1 : 0
}

/** True when this module is being executed directly (`node script.mjs`), not imported by a test. */
export function isMain(importMetaUrl) {
  return importMetaUrl === `file://${process.argv[1]}`
}
