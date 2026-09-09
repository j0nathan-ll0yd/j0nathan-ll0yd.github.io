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
 * Append `measured=<n>` to `$GITHUB_OUTPUT`.
 *
 * SYNCHRONOUS on purpose: every caller reaches this through `report()` inside a
 * `process.exit(report(...))` expression, and an async append would be torn down
 * with the write still queued.
 *
 * Outside Actions there is no `$GITHUB_OUTPUT`, so this is a no-op -- running a
 * check on a workstation must not need a fake output file.
 *
 * @param {number} measured non-negative integer count of artifacts held and judged
 * @returns {number} `measured`, so callers can pass it straight through
 */
export function publishMeasured(measured, {outputPath = process.env.GITHUB_OUTPUT, append = appendFileSync} = {}) {
  if (!Number.isInteger(measured) || measured < 0) {
    throw new TypeError(`measured must be a non-negative integer, got ${JSON.stringify(measured)}`)
  }
  if (!outputPath) {
    return measured
  }
  append(outputPath, `measured=${measured}\n`, 'utf8')
  return measured
}
