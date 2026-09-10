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
# The MEASUREMENT CHANNEL (atlas decisions 0107, 0122), as ONE RECORD PER CHECK STEP:
#
#   <step-id>|<step outcome>|<measured>[|<reason>]
#
# WHY JOB STATUS ALONE WAS NEVER ENOUGH, and why this repo needed it most. The header above is
# right that a failed job status can only mean an infrastructure step died, because every check
# step is `continue-on-error: true`. The inverse is the hole: a check that runs, reaches nothing,
# and is swallowed by `continue-on-error` leaves the job at `success` and pings a GREEN tile.
# Decision 0083 asked "did the lane run"; 0107 refined it to "did it run TO MEASUREMENT", and this
# script was never updated to the refinement. Measured receipt: weekly run 34086625518 concluded
# success while its Cloudflare arm recorded `status: unknown` with five 403s.
#
# WHY RECORDS AND NOT A SINGLE NUMBER. One tile covers a whole tier, and a tier is many steps. A
# SUM IS WRONG: 2 + 3 + 0 + 4 exceeds zero, so one dark check hides behind healthy siblings. The
# rule is ANY STEP THAT CLAIMS ZERO WEDGES THE TIER, which needs each step's claim kept apart. The
# record shape is mirrored from mantle-LifegamesPortal's audits/healthchecks-ping.sh, whose lanes
# are separate JOBS (`name|result|check|report|measured`); here they are steps of one job, so the
# per-step outcome replaces the per-job result.
#
# THE FIELDS.
#   outcome   `steps.<id>.outcome`, which is the result BEFORE `continue-on-error` masks it.
#             `steps.<id>.conclusion` is always `success` here and would carry no information.
#   measured  a non-negative integer count of the artifacts that step held bytes for and judged,
#             or one of two DECLARATIONS, each of which requires a reason (atlas decision 0107's
#             not-applicable versus indeterminate split):
#               n/a       the step cannot produce a count by construction -- a third-party tool
#                         run whose verdict is its own exit code, not a set of artifacts it held.
#               deferred  the step COULD claim, but the channel is blocked on an external action.
#             A declaration WITHOUT a reason is not a declaration: it wedges, so the opt-out
#             cannot become a quiet escape hatch. This mirrors atlas A19's
#             `lane-unmeasured-scope-unreasoned` rung.
#   until=    `until=YYYY-MM-DD`, one of the trailing fields. REQUIRED on `deferred`, refused
#             nowhere else. See "WHY A DEFERRAL EXPIRES" below.
#
# WHY A DEFERRAL EXPIRES, and why `n/a` does not. The two declarations are not the same kind of
# fact. `n/a` is STRUCTURAL: a third-party tool run holds no artifact set, and no owner action will
# ever change that, so a permanent exemption states the truth. `deferred` is TEMPORAL by its own
# definition -- the step COULD claim, and something outside this repo is in the way. Without a
# deadline the two behave identically, and the declaration written to make a gap VISIBLE becomes
# the mechanism that makes it INDEFINITE.
#
# That is not hypothetical. `llms_cache_rules` declared `deferred` for atlas 0120 D2 while all five
# Cloudflare API reads returned HTTP 403 (weekly run 34164468115, 2026-09-07). The check exits 1,
# `continue-on-error: true` swallows it, `job.status` reads success, the reconciler reads the
# check's own `indeterminate` and leaves its issue unchanged, and this arm accepted the deferral --
# green job, no issue, no wedge, byte-identical to run 34086625518, the receipt decision 0122
# opened with.
#
# So a deferral carries the date it stops being accepted, and past that date it wedges exactly like
# an unreasoned one. Moving the date is a reviewed edit to this workflow; letting it lapse is not.
#
# THE MARKER IS SELF-DESCRIBING AND POSITION-INDEPENDENT, on purpose. The reason is prose and may
# itself contain `|`, so "the last field is the date" would be a guess. `until=` cannot be
# mistaken for prose, and a record carrying no marker parses exactly as it did before the field
# existed. That backward compatibility is what lets the format ship here first: atlas A19 folds
# every trailing field into one `reason` string (`parseMeasuredStepRecords`), so it reads
# `until=...` as reason text, keeps seeing a REASONED declaration, and stays green while the hub
# adopts the same expiry rung on its own cadence.
#
# EMPTY IS "NOT CLAIMED", NEVER A PASS. A step that published no count is silent, not healthy. If
# its outcome is `failure` it died before writing one, which is the darkest case and wedges. If it
# succeeded or was skipped, this script leaves it to the status rungs and atlas A19 arm 2 is what
# reds on a step that should claim and does not -- a static gate in another repo, which is why the
# producer and the reconciler ship as one change.
#
# NO RECORDS AT ALL WEDGES, fail-safe and deliberately. An unwired tier is exactly the pre-0122
# state this channel exists to end, and it must not read as health. A false /fail costs one
# investigated alert; a false plain ping cost 15 dark days once already.
MEASURED_STEPS="${MEASURED_STEPS:-}"
# Today in UTC, as the expiry rung's clock. Overridable so the suite can drive both sides of a
# deadline without waiting for one; nothing in the workflow sets it.
TODAY_UTC="${TODAY_UTC:-$(date -u +%Y-%m-%d)}"

# An unset secret is a LOUD skip, never a red and never a ping: exit 0 keeps
# the report-only lane green, and skipping before any curl means an unarmed
# tier can never check in against another tier's tile.
if [ -z "$HC_URL" ]; then
  echo "::notice title=Dead-man's-switch ping skipped::${HC_SECRET_NAME} secret not set -- skipping dead-man's-switch ping. Create this tier's Healthchecks.io tile and set the secret to arm it."
  exit 0
fi

# ORDER IS LOAD-BEARING (atlas decision 0107, mirrored from mantle-LifegamesPortal's
# audits/healthchecks-ping.sh). This whole block MUST precede the `case "$JOB_STATUS"` below. An
# unmeasured lane whose check exits nonzero has its failure swallowed by `continue-on-error`, so
# its job status reads `success` -- the exact shape of a healthy run. Test the status first and a
# transport-dark run matches the success arm, the switch pings a green tile, and the wedge is never
# reported. That is the 0104 bug class, and the reason the exit code alone was never allowed to
# carry this meaning. Both orders are pinned in audits/__tests__/healthchecks-ping.test.ts.
seen=0
wedged=''
summary=''

# Is `$1` a real calendar day in `YYYY-MM-DD` form?
#
# SHAPE IS NOT ENOUGH, and the difference is silent. `2026-13-08` matches the pattern and, under
# the YYYYMMDD integer comparison below, sorts between 2026-12-31 and 2027-01-01 -- so an
# impossible month still expires, just a month later than the reader who wrote it believes. A
# deadline nobody can resolve to a day is not a deadline. Rejecting it here makes the slip loud.
#
# Arithmetic rather than `date`: GNU `date -d` and BSD `date -j -f` disagree, and this script runs
# on the self-hosted Linux runners and on macOS under the suite. `10#` forces decimal, because
# `08` and `09` are invalid OCTAL and would otherwise abort the whole script.
valid_date() {
  local text="$1" year month day last
  year=$((10#${text:0:4}))
  month=$((10#${text:5:2}))
  day=$((10#${text:8:2}))
  [ "$month" -ge 1 ] && [ "$month" -le 12 ] || return 1
  case "$month" in
    1 | 3 | 5 | 7 | 8 | 10 | 12) last=31 ;;
    4 | 6 | 9 | 11) last=30 ;;
    *)
      if [ $((year % 4)) -eq 0 ] && { [ $((year % 100)) -ne 0 ] || [ $((year % 400)) -eq 0 ]; }; then
        last=29
      else
        last=28
      fi
      ;;
  esac
  [ "$day" -ge 1 ] && [ "$day" -le "$last" ]
}

# `trailing` deliberately absorbs every field past `measured`, delimiters included, because the
# reason is prose and may contain `|`. Splitting it is the loop below, not `read`.
while IFS='|' read -r step outcome measured trailing; do
  [ -n "${step:-}" ] || continue
  seen=$((seen + 1))
  summary="${summary}${step}=${measured:-none} "

  # Pull the `until=YYYY-MM-DD` marker out of the trailing fields wherever it sits; everything
  # else is the prose reason, rejoined in order. Pure parameter expansion: a nested `read` here
  # would consume the here-doc feeding the outer loop.
  expiry=''
  reason=''
  remainder="${trailing:-}"
  while [ -n "$remainder" ]; do
    field="${remainder%%|*}"
    case "$field" in
      until=*) expiry="${field#until=}" ;;
      ?*) reason="${reason}${reason:+|}${field}" ;;
    esac
    case "$remainder" in
      *'|'*) remainder="${remainder#*|}" ;;
      *) remainder='' ;;
    esac
  done

  case "${measured:-}" in
    '')
      # Nothing claimed. A step that CONCLUDED failure without writing a count died before it
      # could -- the crashed-before-measuring shape. A step that succeeded or stood itself down
      # (a focus-mode `if:`) is merely silent, and atlas A19 arm 2 is the gate for that.
      if [ "${outcome:-}" = 'failure' ]; then
        wedged="${wedged}${step}(crashed-before-measuring) "
      fi
      ;;
    0)
      wedged="${wedged}${step}(measured-nothing) "
      ;;
    n/a)
      # Structural and therefore permanent: no deadline, because no owner action changes it.
      if [ -z "$reason" ]; then
        wedged="${wedged}${step}(unreasoned-n/a) "
      fi
      ;;
    deferred)
      # Temporal, and therefore dated. Every rung below is fail-safe: an unreadable deferral is a
      # wedge, never a claim.
      if [ -z "$reason" ]; then
        wedged="${wedged}${step}(unreasoned-deferred) "
      elif [ -z "$expiry" ]; then
        wedged="${wedged}${step}(undated-deferred) "
      elif ! [[ "$expiry" =~ ^[0-9]{4}-[0-9]{2}-[0-9]{2}$ ]] || ! valid_date "$expiry"; then
        wedged="${wedged}${step}(malformed-deferral-date:${expiry}) "
      elif [ "${expiry//-/}" -lt "${TODAY_UTC//-/}" ]; then
        # PAST the date, not ON it: the deadline day is still a working deferral.
        wedged="${wedged}${step}(expired-deferral:${expiry}) "
      fi
      ;;
    *[!0-9]*)
      # Fail-safe: a value this script cannot classify is treated as a wedge, never as a claim.
      wedged="${wedged}${step}(unrecognized-measured:${measured}) "
      ;;
    *)
      : # A positive integer. The step measured; whether it FOUND anything is the reconciler's job.
      ;;
  esac
done <<EOF
${MEASURED_STEPS}
EOF

if [ "$seen" -eq 0 ]; then
  wedged='no-step-measurements-reported '
fi

if [ -n "$wedged" ]; then
  endpoint="${HC_URL%/}/fail"
  echo "${summary}-- the lane measured nothing on: ${wedged}(job status: ${JOB_STATUS}). Pinging /fail."
  if curl -fsS -m 10 --retry 5 --retry-connrefused -o /dev/null "$endpoint"; then
    echo 'Pinged Healthchecks.io.'
    exit 0
  fi
  echo "::warning title=Healthchecks.io ping failed::Could not report the unmeasured lane. Not failing the job: a missed check-in is itself the alert this switch exists to raise."
  exit 0
fi

echo "${summary}-- every step that claims a count measured something."

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
