#!/usr/bin/env bash
# healthchecks-ping.sh -- D6 dead-man's-switch ping for the audit-web.yml jobs.
#
# The switch answers exactly one question: DID THE SCHEDULED LANE RUN TO
# MEASUREMENT? It deliberately does NOT report findings -- red checks are
# surfaced as managed GitHub issues by audits/lib/file-check-issues.mjs
# (D5), because every check step is `continue-on-error: true` (D4, report-only).
# That split is the WS-A1 convention, mirrored from mantle-LifegamesPortal's
# audit-backend.yml.
#
# WHY THE /fail BRANCH EXISTS. A job that CRASHES BEFORE MEASURING used to fall
# through both channels and alert nobody:
#   * every check step reported outcome "skipped", so bucketOutcome() returned
#     "indeterminate" and the reconciler logged "not wholly green or failing --
#     leaving its issue unchanged" for every bucket (file-check-issues.mjs:115,
#     :314) -- no issue opened, none closed;
#   * this step then ran under `if: always()` and pinged plain SUCCESS, so the
#     Healthchecks tile stayed green.
# Three consecutive weekly runs died that way (31999694781 on 2026-08-17,
# 32600311656 on 2026-08-22, 32695529989 on 2026-08-24) and B2's live-artifact
# validation went dark for 15 days with zero alerts.
#
# So: JOB_STATUS failure -> ping $HC_URL/fail. Because every CHECK step is
# continue-on-error, a failed job status can only mean an INFRASTRUCTURE step
# died (checkout, install, egress preflight, issue reconcile) -- i.e. the lane
# wedged. Findings never move the job status and still ping plain success, which
# keeps the switch answering "did it run", not "was it clean".
#
# The ping itself is BEST-EFFORT and never fails the job. Run 31999694781 also
# failed on this step (curl 28, six timeouts) during a total runner-egress
# outage; reddening an otherwise-fine lane because the collector is unreachable
# adds no signal, and a missed check-in is already exactly what Healthchecks.io
# alerts on.
set -uo pipefail

HC_URL="${HC_URL:-}"
# The repo secret that should have filled HC_URL. Each tier pings its OWN tile
# (atlas decision 0116, ruling R9a -- a shared tile let a dead weekly/monthly
# cron hide behind the daily ping), so the skip message must name the exact
# secret to create. Defaults to the daily name for callers that pass none.
HC_SECRET_NAME="${HC_SECRET_NAME:-HC_PING_AUDIT_WEB}"
# GitHub sets this from `job.status`: success | failure | cancelled.
JOB_STATUS="${JOB_STATUS:-success}"
# The MEASUREMENT CHANNEL (atlas decisions 0107, 0122). A count of the artifacts the lane's check
# held bytes for and judged; `0` means it executed and measured nothing.
#
# WHY JOB STATUS ALONE WAS NEVER ENOUGH, and why this repo needed it most. The header above is
# right that a failed job status can only mean an infrastructure step died, because every check
# step is `continue-on-error: true`. The inverse is the hole: a check that runs, reaches nothing,
# and is swallowed by `continue-on-error` leaves the job at `success` and pings a GREEN tile.
# Decision 0083 asked "did the lane run"; 0107 refined it to "did it run TO MEASUREMENT", and this
# script was never updated to the refinement. Measured receipt: weekly run 34086625518 concluded
# success while its Cloudflare arm recorded `status: unknown` with five 403s.
#
# EMPTY IS "NOT CLAIMED", NEVER A PASS. A lane that publishes no count is not asserting it
# measured something -- it is silent, and this script leaves it to the status rungs below. Only a
# literal `0` is a wedge. Atlas A19 arm 2 is what reds on a lane that should claim and does not.
MEASURED="${MEASURED:-}"

# An unset secret is a LOUD skip, never a red and never a ping: exit 0 keeps
# the report-only lane green, and skipping before any curl means an unarmed
# tier can never check in against another tier's tile.
if [ -z "$HC_URL" ]; then
  echo "::notice title=Dead-man's-switch ping skipped::${HC_SECRET_NAME} secret not set -- skipping dead-man's-switch ping. Create this tier's Healthchecks.io tile and set the secret to arm it."
  exit 0
fi

# ORDER IS LOAD-BEARING (atlas decision 0107, mirrored from mantle-LifegamesPortal's
# audits/healthchecks-ping.sh). This rung MUST precede the `case "$JOB_STATUS"` below. An
# unmeasured lane whose check exits nonzero has its failure swallowed by `continue-on-error`, so
# its job status reads `success` -- the exact shape of a healthy run. Test the status first and a
# transport-dark run matches the success arm, the switch pings a green tile, and the wedge is never
# reported. That is the 0104 bug class, and the reason the exit code alone was never allowed to
# carry this meaning.
if [ "$MEASURED" = '0' ]; then
  endpoint="${HC_URL%/}/fail"
  echo "Measured 0 artifacts -- the lane ran and measured nothing (job status: ${JOB_STATUS}). Pinging /fail."
  if curl -fsS -m 10 --retry 5 --retry-connrefused -o /dev/null "$endpoint"; then
    echo 'Pinged Healthchecks.io.'
    exit 0
  fi
  echo "::warning title=Healthchecks.io ping failed::Could not report the unmeasured lane. Not failing the job: a missed check-in is itself the alert this switch exists to raise."
  exit 0
fi

case "$JOB_STATUS" in
  success)
    endpoint="$HC_URL"
    ;;
  failure)
    # Trailing slash would produce //fail, which Healthchecks.io does not route.
    endpoint="${HC_URL%/}/fail"
    ;;
  *)
    # Cancelled (or anything new GitHub adds): the lane neither completed nor
    # crashed, so asserting either state would be a lie. Stay silent and let the
    # missed check-in speak if cancellations persist.
    echo "Job status is \"${JOB_STATUS}\" -- not pinging; the switch only reports completion or a wedged lane."
    exit 0
    ;;
esac

if curl -fsS -m 10 --retry 5 --retry-connrefused -o /dev/null "$endpoint"; then
  echo "Pinged Healthchecks.io (job status: ${JOB_STATUS})."
  exit 0
fi

echo "::warning title=Healthchecks.io ping failed::Could not reach the Healthchecks.io collector to report job status \"${JOB_STATUS}\". Not failing the job: a missed check-in is itself the alert this switch exists to raise. If this repeats, check runner egress before suspecting the audit checks."
exit 0
