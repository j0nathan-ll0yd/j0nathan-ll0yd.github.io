#!/usr/bin/env node
// Monotonic severity and pending-parameter ratchet.
// Compare the baseline with origin/main, compare live rules with the baseline, and allow a baseline
// id to disappear only when the live catalog also retired it. This prevents coordinated
// rule-plus-baseline downgrades from becoming self-consistent. params_pending_count may not grow.

import {execFileSync} from 'node:child_process'
import {readFileSync} from 'node:fs'
import {dirname, join} from 'node:path'
import {fileURLToPath} from 'node:url'
import {artifacts, rules} from './specs/load.mjs'

const __dirname = dirname(fileURLToPath(import.meta.url))
const REPO_ROOT = join(__dirname, '..', '..')
const BASELINE_PATH = join(__dirname, 'specs', 'severity-baseline.json')
const BASELINE_GIT_PATH = 'scripts/audit/specs/severity-baseline.json'

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

function readBaselineAtMain() {
  // SEVERITY_BASELINE_SHOW_ARG lets `pnpm run audit:test`-adjacent can-fail
  // rehearsals point `git show` at a scratch blob instead of origin/main --
  // needed because THIS pilot's own baseline file has no history on
  // origin/main yet (it is introduced by this PR), so probe G leg 2 (a
  // symmetric downgrade across both files) cannot be demonstrated against
  // the real remote until after the first merge. Unset in every real run.
  const showArg = process.env.SEVERITY_BASELINE_SHOW_ARG ?? `origin/main:${BASELINE_GIT_PATH}`
  try {
    const raw = execFileSync('git', ['show', showArg], {cwd: REPO_ROOT, encoding: 'utf-8', stdio: ['ignore', 'pipe', 'ignore']})
    const parsed = JSON.parse(raw)
    return {severities: parsed.severities ?? {}, params_pending_count: parsed.params_pending_count ?? 0}
  } catch {
    // No baseline on origin/main yet (first run) -- ENOENT-equivalent -> {}.
    return {severities: {}, params_pending_count: 0}
  }
}

function loadLiveCatalog() {
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

export function checkSpecSeverity() {
  const violations = []

  const baselineHead = readBaselineFile(BASELINE_PATH)
  const baselineMain = readBaselineAtMain()
  const live = loadLiveCatalog()

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
  const violations = checkSpecSeverity()
  console.log('\n=== check-spec-severity ===')
  if (violations.length === 0) {
    console.log('  (no violations)')
    console.log(`  ${Object.keys(loadLiveCatalog().severities).length} rule severit(y/ies) checked against severity-baseline.json, 0 violation(s)`)
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
