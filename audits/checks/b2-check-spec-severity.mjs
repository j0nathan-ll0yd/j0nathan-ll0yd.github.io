#!/usr/bin/env node
// Monotonic severity and pending-parameter ratchet.
// Compare the baseline with origin/main, compare live rules with the baseline, require every live
// id to be recorded, and allow a baseline id to disappear only when the live catalog also retired
// it. This prevents coordinated rule-plus-baseline downgrades from becoming self-consistent.
// params_pending_count may not grow.
//
// THE CHECK IS A PURE FUNCTION OVER A SNAPSHOT (atlas decision 0142 step 5.3).
// `checkSpecSeverity` takes `{baselineHead, baselineMain, live}` and returns violation strings;
// `loadSeveritySnapshot()` is the one impure seam that reads disk and git. That split is what
// `audits/__tests__/spec-severity.test.ts` needs: this is the last PR-BLOCKING watcher in the
// pilot and it had zero automated can-fail coverage, its only evidence being a one-time manual
// rehearsal through SEVERITY_BASELINE_SHOW_ARG. ADR 0010/0011's lesson is that a gate never
// observed to fail is indistinguishable from no gate, and the three sibling watchers all recite
// it; this one did not hold itself to it.

import {execFileSync} from 'node:child_process'
import {readFileSync} from 'node:fs'
import {dirname, join} from 'node:path'
import {fileURLToPath} from 'node:url'
import {artifacts, rules} from '../specs/load.mjs'

const __dirname = dirname(fileURLToPath(import.meta.url))
const REPO_ROOT = join(__dirname, '..', '..')
const BASELINE_PATH = join(__dirname, '..', 'specs', 'severity-baseline.json')
const BASELINE_GIT_PATH = 'audits/specs/severity-baseline.json'

const RANK = {warn: 1, fail: 2}

function readBaselineFile(path) {
  let raw
  try {
    raw = readFileSync(path, 'utf-8')
  } catch {
    return {severities: {}, params_pending_count: 0}
  }
  const parsed = JSON.parse(raw)
  return {severities: parsed.severities ?? {}, params_pending_count: parsed.params_pending_count ?? 0}
}

/**
 * One git invocation's outcome. Declared rather than inferred so the injectable seam has a
 * stated shape a test double can satisfy -- `stdout` is present on success, `error` on failure.
 * @typedef {{ok: boolean, stdout?: string, error?: string}} GitResult
 */
/** @typedef {(args: string[]) => GitResult} GitRunner */

/**
 * Run one git command, reporting failure rather than throwing. Injectable so the tests never shell out.
 * @type {GitRunner}
 */
function runGit(args) {
  try {
    return {ok: true, stdout: execFileSync('git', args, {cwd: REPO_ROOT, encoding: 'utf-8', stdio: ['ignore', 'pipe', 'ignore']})}
  } catch (err) {
    return {ok: false, error: err instanceof Error ? err.message : String(err)}
  }
}

/**
 * The baseline as origin/main records it -- and, when it cannot be read, WHY.
 *
 * THREE OUTCOMES, NOT TWO (atlas decision 0142 step 5.3). The previous catch-all folded every
 * failure into an empty baseline, which silently disables arms (a) and (c) and leaves only the
 * head-vs-live arm running. That is the "INDETERMINATE, never clean" convention the drift and
 * currency headers state, broken in the one watcher that blocks merges:
 *
 *   - the ref does not resolve (a fetchless clone, a shallow checkout, a renamed default branch)
 *     -> `unavailable`, which becomes a VIOLATION. The gate says it could not look.
 *   - the ref resolves and the path is absent at it -> `{}`. This is the genuine first-run case
 *     and it degrades honestly: there is no prior record to compare against.
 *   - the blob will not parse -> `unavailable`. A corrupt record is not an absent one.
 *
 * The deployed lane is already safe -- `.github/workflows/static-checks.yml` sets `fetch-depth: 0`
 * with an explanatory comment -- so this guards a local run and any future checkout regression.
 *
 * SEVERITY_BASELINE_SHOW_ARG lets a can-fail rehearsal point `git show` at a scratch blob instead
 * of origin/main. A bare blob argument carries no `<rev>:<path>` colon, so the ref pre-check is
 * skipped for it. Unset in every real run. (The comment here used to justify the escape hatch by
 * saying this file's baseline had no history on origin/main yet; it has had one since the pilot
 * merged, so that rationale is gone and only the rehearsal use survives.)
 */
export function readBaselineAtMain({git = runGit, showArg = process.env.SEVERITY_BASELINE_SHOW_ARG ?? `origin/main:${BASELINE_GIT_PATH}`} = {}) {
  const empty = {severities: {}, params_pending_count: 0}
  const colon = showArg.indexOf(':')
  if (colon > 0) {
    const rev = showArg.slice(0, colon)
    if (!git(['rev-parse', '--verify', '--quiet', `${rev}^{commit}`]).ok) {
      return {...empty, unavailable: `the ref "${rev}" does not resolve in this clone`}
    }
  }

  const shown = git(['show', showArg])
  if (!shown.ok) {
    // The ref exists and the path is absent at it: the genuine first-run case.
    return empty
  }

  let parsed
  try {
    parsed = JSON.parse(shown.stdout)
  } catch (err) {
    return {...empty, unavailable: `the blob at "${showArg}" is not valid JSON (${err instanceof Error ? err.message : String(err)})`}
  }
  return {severities: parsed.severities ?? {}, params_pending_count: parsed.params_pending_count ?? 0}
}

export function loadLiveCatalog() {
  const severities = {}
  let paramsPendingCount = 0
  for (const artifact of artifacts()) {
    const R = rules(artifact)
    for (const [id, rule] of Object.entries(R)) {
      severities[id] = rule.severity
      if (rule.params_pending) {
        paramsPendingCount++
      }
    }
  }
  return {severities, paramsPendingCount}
}

/** The one impure seam: disk plus git. Split out so `checkSpecSeverity` can be handed a synthetic. */
export function loadSeveritySnapshot() {
  return {baselineHead: readBaselineFile(BASELINE_PATH), baselineMain: readBaselineAtMain(), live: loadLiveCatalog()}
}

export function checkSpecSeverity(snapshot = loadSeveritySnapshot()) {
  const violations = []
  const {baselineHead, baselineMain, live} = snapshot

  // (0) The baseline on origin/main could not be read at all. Arms (a) and (c) compare against
  // it, so they are UNMEASURED rather than satisfied, and saying so is the whole point.
  if (baselineMain.unavailable) {
    violations.push(
      `INDETERMINATE: could not read severity-baseline.json on origin/main -- ${baselineMain.unavailable}. ` +
        'Arms (a) (the baseline may not weaken against origin/main) and (c) (delete-then-downgrade) compare against that record, ' +
        'so they did not run. An unreadable prior record is not an empty one; in CI this means the checkout lost its history ' +
        '(static-checks.yml sets fetch-depth: 0 for exactly this reason), and locally it means the clone has no origin/main'
    )
  }

  // (a) The baseline file itself may never record a weaker severity than it
  // did on origin/main.
  for (const [id, mainSeverity] of Object.entries(baselineMain.severities)) {
    const headSeverity = baselineHead.severities[id]
    if (headSeverity !== undefined && RANK[headSeverity] < RANK[mainSeverity]) {
      violations.push(`severity-baseline.json weakened for "${id}": origin/main recorded "${mainSeverity}", this branch records "${headSeverity}"`)
    }
  }

  // (b) No rule file may currently emit weaker than the baseline records.
  for (const [id, baselineSeverity] of Object.entries(baselineHead.severities)) {
    const liveSeverity = live.severities[id]
    if (liveSeverity !== undefined && RANK[liveSeverity] < RANK[baselineSeverity]) {
      violations.push(
        `rule "${id}" emits severity "${liveSeverity}", weaker than the baseline's recorded "${baselineSeverity}" -- ` +
          'downgrading requires DELETING the id from severity-baseline.json, not editing it in place'
      )
    }
  }

  // (c) Deletion assertion (REVERSAL 1): an id may only leave the baseline if
  // it also left the live, pilot-scoped catalog.
  for (const id of Object.keys(baselineMain.severities)) {
    if (!(id in baselineHead.severities) && id in live.severities) {
      violations.push(
        `"${id}" was removed from severity-baseline.json but is still emitted by the live catalog (severity: "${live.severities[id]}") -- ` +
          'this is delete-then-downgrade; a legitimate retirement removes the id from BOTH the baseline and its rule file'
      )
    }
  }

  // (d) COMPLETENESS, the symmetric half of (c) (atlas decision 0142 step 5.3). Every live id
  // must be RECORDED. Arms (a)-(c) all iterate ids a baseline already holds, so an id that never
  // entered the baseline was outside the ratchet forever: PR1 adds a rule at `fail` with no
  // baseline entry and every gate is green; PR2 downgrades it to `warn` and every gate is still
  // green, because (b) has nothing to compare against and (c) sees no deletion.
  // Delete-then-downgrade was closed by REVERSAL 1; never-add-then-downgrade was open, and
  // membership was manual discipline rather than a gate. Without this arm the check also cannot
  // tell "no regression" from "the id is not being watched".
  for (const [id, severity] of Object.entries(live.severities)) {
    if (!(id in baselineHead.severities)) {
      violations.push(
        `rule "${id}" is emitted by the live catalog at severity "${severity}" but has no entry in severity-baseline.json -- ` +
          'record it at birth. An unrecorded id is outside the ratchet: nothing would stop a later commit weakening it, ' +
          'because every other arm compares against a baseline entry that does not exist'
      )
    }
  }

  // params_pending ratchet (N6): the count of declared-but-undeferred
  // thresholds may not increase.
  if (live.paramsPendingCount > baselineHead.params_pending_count) {
    violations.push(
      `params_pending count rose from ${baselineHead.params_pending_count} (committed) to ${live.paramsPendingCount} (live) -- ` +
        'a new parameterised threshold was declared params_pending without deriving it; bump params_pending_count in severity-baseline.json ' +
        'only if this is a deliberate, reviewed addition'
    )
  }

  return violations
}

function main() {
  const snapshot = loadSeveritySnapshot()
  const violations = checkSpecSeverity(snapshot)
  console.log('\n=== check-spec-severity ===')
  if (violations.length === 0) {
    console.log('  (no violations)')
    console.log(`  ${Object.keys(snapshot.live.severities).length} rule severit(y/ies) checked against severity-baseline.json, 0 violation(s)`)
    process.exit(0)
  }
  for (const v of violations) {
    console.log(`  [fail] ${v}`)
  }
  console.log(`  ${violations.length} violation(s)`)
  process.exit(1)
}

function isMain(importMetaUrl) {
  return importMetaUrl === `file://${process.argv[1]}`
}

if (isMain(import.meta.url)) {
  main()
}
