// audits/lib/measurement.mjs -- the ONE place a web audit check publishes its
// measurement channel (atlas decisions 0083, 0107, 0122).
//
// WHAT THE COUNT MEANS. `measured` is the number of artifacts this run HELD BYTES
// FOR AND JUDGED. It is not a finding count and it is not a pass/fail: a check that
// fetched three artifacts and failed all three measured 3, and a check that reached
// none of them measured 0. Only the second is darkness. `audits/healthchecks-ping.sh`
// reads it and pings `/fail` on a literal `0`, ahead of every status rung.
//
// WHY IT IS A SEPARATE SIGNAL FROM THE EXIT CODE. Every check step in
// audit-web.yml is `continue-on-error: true`, so a check that runs, reaches nothing,
// and exits nonzero leaves `job.status` at `success` -- byte-identical to a healthy
// run. Weekly run 34086625518 is the measured receipt: it concluded success while its
// Cloudflare arm recorded `status: unknown` with five 403s.
//
// SUPPRESSED COUNTS AS MEASURED. When a focus-privacy probe answers and the lane
// stands down deliberately, the transport worked -- publishing 0 there would ping
// `/fail` through every privacy window and turn intentional suppression into a wedge
// alert. An OVERDUE suppression is a finding, and a finding is measured too. Only
// genuine darkness publishes 0.

import {appendFileSync} from 'node:fs'

/**
 * The one DECLARATION a runner may publish in place of a count (atlas decisions 0107,
 * 0120 D2, 0142 step 5.4). It says: this step COULD claim, and an action outside this
 * repo is in the way. `audits/healthchecks-ping.sh` accepts it only with a stated reason
 * and a live `until=` deadline, both of which live on the workflow record -- so the
 * runner declares the STATE and the workflow states the WAIVER, and neither alone
 * exempts a step.
 *
 * `n/a` is deliberately NOT publishable here. It is structural -- a third-party tool run
 * holds no artifact set -- and such a run never executes this repo's code at all, so a
 * runner claiming it would be asserting something it cannot observe.
 */
export const MEASURED_DEFERRED = 'deferred'

/**
 * Append `measured=<n>` to `$GITHUB_OUTPUT`.
 *
 * SYNCHRONOUS on purpose: every caller reaches this through `report()` inside a
 * `process.exit(report(...))` expression, and an async append would be torn down
 * with the write still queued.
 *
 * Outside Actions there is no `$GITHUB_OUTPUT`, so this is a no-op -- running a
 * check on a workstation must not need a fake output file.
 *
 * @param {number|'deferred'} measured non-negative integer count of artifacts held and
 *   judged, or `MEASURED_DEFERRED`
 * @returns {number|'deferred'} `measured`, so callers can pass it straight through
 */
export function publishMeasured(measured, deps = {}) {
  if (measured !== MEASURED_DEFERRED && (!Number.isInteger(measured) || measured < 0)) {
    throw new TypeError(`measured must be a non-negative integer or ${JSON.stringify(MEASURED_DEFERRED)}, got ${JSON.stringify(measured)}`)
  }
  const append = deps.append ?? appendFileSync
  // The environment is read ONLY when the caller did not speak. A destructuring default
  // (`{outputPath = process.env.GITHUB_OUTPUT}`) cannot tell "I passed nothing" from "I passed
  // undefined deliberately", so an explicit `outputPath: undefined` fell through to the env — a
  // no-op on a workstation and a real write under Actions, where GITHUB_OUTPUT is always set.
  // Caught by CI on a test that passed locally for the wrong reason.
  const outputPath = Object.hasOwn(deps, 'outputPath') ? deps.outputPath : process.env.GITHUB_OUTPUT
  if (!outputPath) {
    return measured
  }
  append(outputPath, `measured=${measured}\n`, 'utf8')
  return measured
}

/** The closed set the managed-issue reconciler accepts for one bucket (audits/lib/file-check-issues.mjs). */
export const ISSUE_OUTCOMES = Object.freeze(['success', 'failure', 'indeterminate'])

/**
 * Append `issue_outcome=<outcome>` to `$GITHUB_OUTPUT` -- the ONE writer for the tri-state the
 * reconciler reads in place of a report-only step's process outcome (atlas decision 0142).
 *
 * A step outcome cannot separate "measured and healthy" from "could not measure": every check
 * step is `continue-on-error`, and an unmeasured arm exits 0. `indeterminate` leaves the managed
 * issue unchanged, so a run that judged nothing can neither file nor close one (atlas 0104).
 *
 * Same contract as `publishMeasured`: synchronous, validated, a no-op without an output path, and
 * an explicit `outputPath` (even `undefined`) is never replaced by the environment.
 *
 * @param {'success'|'failure'|'indeterminate'} outcome
 * @returns {'success'|'failure'|'indeterminate'} `outcome`, so callers can pass it through
 */
export function publishIssueOutcome(outcome, deps = {}) {
  if (!ISSUE_OUTCOMES.includes(outcome)) {
    throw new TypeError(`issue_outcome must be one of ${ISSUE_OUTCOMES.join('|')}, got ${JSON.stringify(outcome)}`)
  }
  const append = deps.append ?? appendFileSync
  const outputPath = Object.hasOwn(deps, 'outputPath') ? deps.outputPath : process.env.GITHUB_OUTPUT
  if (!outputPath) {
    return outcome
  }
  append(outputPath, `issue_outcome=${outcome}\n`, 'utf8')
  return outcome
}
