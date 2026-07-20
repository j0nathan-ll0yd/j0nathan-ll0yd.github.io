// Shared HTTP helpers for scripts/audit/*.mjs. Every audit check fetches the
// same live origins (jonathanlloyd.me + the staging CloudFront data plane,
// which IS the live-serving data plane per monorepo-LifegamesPortal/surfaces.yaml)
// and needs the same resilience: a transient 5xx in the seconds after a deploy
// is not an outage (see web's tests/smoke/home.smoke.ts getStable(), issue #106)
// but a steady-state 5xx still fails once the retry budget is spent.

const DEFAULT_BUDGET_MS = 20_000

/**
 * Fetch a URL, retrying transient upstream 5xx responses with capped
 * exponential backoff over `budgetMs`. Network errors (DNS, TLS, timeout)
 * are NOT retried here -- they indicate a real reachability problem, not a
 * one-off gateway blip, and should fail the check immediately.
 */
export async function fetchStable(url, init = {}, budgetMs = DEFAULT_BUDGET_MS) {
  const deadline = Date.now() + budgetMs
  let res = await fetch(url, init)
  for (let attempt = 0; res.status >= 500 && Date.now() < deadline; attempt++) {
    await new Promise((resolve) => setTimeout(resolve, Math.min(1_000 * 2 ** attempt, 5_000)))
    res = await fetch(url, init)
  }
  return res
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
