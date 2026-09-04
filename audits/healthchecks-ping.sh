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

# An unset secret is a LOUD skip, never a red and never a ping: exit 0 keeps
# the report-only lane green, and skipping before any curl means an unarmed
# tier can never check in against another tier's tile.
if [ -z "$HC_URL" ]; then
  echo "::notice title=Dead-man's-switch ping skipped::${HC_SECRET_NAME} secret not set -- skipping dead-man's-switch ping. Create this tier's Healthchecks.io tile and set the secret to arm it."
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
