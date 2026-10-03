#!/usr/bin/env bash
# preflight-egress.sh — distinguish "runner has no external egress" from "site is down"
# BEFORE the report-only smoke/audit steps run, so a self-hosted egress outage reds the
# job with an unambiguous, actionable message instead of masking as a smoke no-op.
#
# Why this exists (2026-08-17 incident): the Web Audit Synthetics jobs run on self-hosted
# Linux runners behind a default-deny Colima egress allowlist (ci-runners-private). DR-0048
# retargeted them off ubuntu-latest, the allowlist then dropped every outbound call to
# jonathanlloyd.me, and because B1 smoke is `continue-on-error` only the Healthchecks.io
# ping reddened the job — an opaque signal a reviewer could not tell from a real site
# outage. This probe runs first and fails loudly with the correct diagnosis.
#
# Two distinct failure modes, two distinct messages:
#   1. CONTROL host unreachable  -> runner has NO external egress at all (infra).
#   2. CONTROL ok, SITE host unreachable at the transport layer -> the runner egress
#      allowlist is missing the site host (the exact 2026-08-17 failure), not a site
#      outage. (A site that is merely returning 5xx still answers at the transport layer,
#      so it is NOT flagged here — that is left to the app-level smoke.)
#
# TWO HOSTS, DELIBERATELY, AND THE LIST DOES NOT GROW. This probe is structurally blind to
# the hosts that actually hung the two 2026-09-28 jobs: `B2 -- external spec currency`
# dials raw.githubusercontent.com and api.github.com, and `B6 -- analytics beacons` dials
# simpleanalytics.com, none of which are named here. It PASSED in 0s in both runs that then
# died at 600s. That gap is real, and it is answered with per-check bounded budgets and
# progress output (audits/lib/progress.mjs), NOT by adding those hosts here. Four reasons,
# in order of weight:
#
#   1. WRONG BLAST RADIUS. This step is the only one in the tier that is NOT
#      `continue-on-error`, so it hard-fails the whole job by design. Dialing a third-party
#      host here would let one upstream blip red every sibling check -- converting a
#      localized advisory finding in one weekly report-only check into a tier-wide outage.
#      Strictly worse than the thing being fixed.
#   2. WRONG QUESTION. The probe answers a binary infrastructure question -- "does this
#      runner have egress, and does it reach the site under test" -- once, before any check.
#      "Did this check's upstream stall mid-run" is a different question, and it belongs to
#      the check that owns the host and knows what an unreachable one MEANS for its verdict.
#      spec_currency already has that answer: INDETERMINATE, never clean.
#   3. WRONG MOMENT. A probe is a point-in-time sample. Passing at T+0 says nothing about a
#      stall at T+60, which is exactly the shape of both failures.
#   4. A PROBE THAT DIALS EVERYTHING IS A SECOND FLAKINESS SOURCE. Every host added here is
#      another third party whose bad minute fails our lane for no finding.
#
# So: keep CONTROL and SITE. If a future check needs a NEW host proven reachable before the
# tier commits to expensive work, that is an argument for that check bounding its own
# fetches, not for widening this one.
set -uo pipefail

# The site under test.
SITE_URL="${SITE_URL:-https://jonathanlloyd.me/}"
# Independent, always-up, NON-GitHub host the runner egress allowlist already permits
# (registry.npmjs.org is in ci-runners-private ALLOWED_REGISTRIES and is needed for pnpm
# anyway). Reachable iff the runner has general external egress. Distinct from the site,
# so it separates "no egress at all" from "site host specifically blocked".
# (GitHub hosts are NOT usable as the control: they stay reachable even during an
# external-egress outage, which is precisely the blind spot this probe closes.)
CONTROL_URL="${CONTROL_URL:-https://registry.npmjs.org/}"

# Print the HTTP status code; return curl's transport exit code (0 = got any response).
probe() { curl -sS -o /dev/null -w '%{http_code}' --max-time 15 --retry 2 --retry-delay 2 "$1"; }

echo "Pre-flight egress probe: control=${CONTROL_URL} site=${SITE_URL}"

ctrl_code="$(probe "$CONTROL_URL")"; ctrl_rc=$?
if [ "$ctrl_rc" -ne 0 ]; then
  echo "::error title=Runner egress down::No external egress from the self-hosted runner — control host ${CONTROL_URL} is unreachable (curl rc=${ctrl_rc}). This is an INFRASTRUCTURE problem on the runner (host egress or the Colima egress allowlist), NOT a site outage. Escalate to ci-runners-private; do not read downstream smoke/audit failures as site regressions."
  exit 1
fi
echo "  control OK (HTTP ${ctrl_code}) — runner has external egress."

site_code="$(probe "$SITE_URL")"; site_rc=$?
if [ "$site_rc" -ne 0 ]; then
  echo "::error title=Site host unreachable from runner::External egress works (control reachable) but ${SITE_URL} is unreachable at the transport layer (curl rc=${site_rc}). Most likely the runner egress allowlist is missing the site host (ci-runners-private firewall/colima ALLOWED_REGISTRIES), not a site outage. Escalate to ci-runners-private."
  exit 1
fi
echo "  site OK (HTTP ${site_code}) — egress path to the site works; any smoke/audit failures below are site/app-level."
