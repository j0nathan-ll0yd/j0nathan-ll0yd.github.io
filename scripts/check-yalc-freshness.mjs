#!/usr/bin/env node
// check-yalc-freshness.mjs -- the `file:.yalc/*` freshness gate (atlas decision 0013).
//
// Compares the committed `.yalc-lock.json` against the on-disk `.yalc` tree and FAILS LOUD on any
// drift, naming the stale package and the fix command. Exit 0 = fresh, exit 1 = stale/broken.
//
// WHAT THE BINDING IS depends on WHERE this runs (this is the load-bearing part):
//   - CI (static-checks.yml job `yalc-freshness`): runs AFTER `scripts/ci-setup.sh`, which
//     reconstructs `.yalc` from upstream `main`. So here the comparison is lock <-> UPSTREAM: an
//     upstream change reds the PR until the committed lock is regenerated. This is the gate that
//     blocks merge -- and merging to main IS the production deploy for this repo.
//   - pre-push / local: runs against the local `.yalc`. The comparison is lock <-> LOCAL DISK: it
//     catches a stale local tree, a local `.yalc` edited ahead of the lock, or a forgotten lock
//     regeneration. It does NOT bind upstream (local disk may itself be stale) -- CI does that.
//
// A lock <-> disk check ALONE (the local case) would be self-blessing if it were the only gate --
// exactly the defect mantle#291's first version shipped. It is not the only gate: CI's
// upstream-reconstruct is what makes the committed lock mean something. See lib/yalc-freshness.mjs.

import {dirname, join} from 'node:path'
import {fileURLToPath} from 'node:url'
import {assessYalcFreshness, REFRESH_GUIDANCE, YALC_FRESHNESS_SKIP_ENV, YALC_LOCK_FILENAME} from './lib/yalc-freshness.mjs'

const REPO_ROOT = join(dirname(fileURLToPath(import.meta.url)), '..')

// Human-readable, actionable message per finding kind. Every message says what is wrong AND names
// the fix (decision 0013: name the stale package and the command).
const KIND_MESSAGE = {
  drift: 'STALE: on-disk .yalc content does not match the committed lock. Either the local tree drifted ' +
    'from upstream, or an intended upstream bump was not captured in the lock.',
  'not-installed': 'NOT INSTALLED: declared file:.yalc/* dependency has no content on disk.',
  'missing-lock-entry': 'MISSING FROM LOCK: package is linked but has no entry in .yalc-lock.json.',
  'stale-lock-entry': 'STALE LOCK ENTRY: lock records a package no longer linked in package.json.',
  'no-lock': `NO LOCK: ${YALC_LOCK_FILENAME} is missing or unparseable -- the ungated state 0013 warns of.`
}

const result = assessYalcFreshness(REPO_ROOT, {lockFilename: YALC_LOCK_FILENAME})

if (result.skipped) {
  console.warn('')
  console.warn('==================================================================')
  console.warn(`  WARNING: ${YALC_FRESHNESS_SKIP_ENV} is set -- yalc freshness gate BYPASSED.`)
  console.warn('  A stale linked dependency can now ship. Use only for local iteration')
  console.warn('  against an unpublished DS branch; never in CI on main.')
  console.warn('==================================================================')
  console.warn('')
  process.exit(0)
}

if (!result.hasYalcDeps) {
  console.log('[yalc-freshness] No file:.yalc/* dependencies -- nothing to check.')
  process.exit(0)
}

const errors = result.findings.filter((f) => f.kind !== 'ok')

if (errors.length === 0) {
  const names = result.findings.map((f) => f.package).join(', ')
  console.log(`[yalc-freshness] OK: all ${result.findings.length} linked packages match the lock (${names}).`)
  process.exit(0)
}

console.error('')
console.error('==================================================================')
console.error('  ERROR: yalc freshness gate FAILED (atlas decision 0013).')
console.error('  Merging here deploys to production; a stale .yalc would ship old bytes.')
console.error('==================================================================')
for (const f of errors) {
  console.error('')
  console.error(`  * ${f.package}: ${KIND_MESSAGE[f.kind] ?? f.kind}`)
  if (f.kind === 'drift') {
    console.error(`      expected ${f.expectedAggregate}`)
    console.error(`      actual   ${f.actualAggregate}`)
    const shown = f.changedFiles.slice(0, 12)
    for (const file of shown) {
      console.error(`        changed: ${file}`)
    }
    if (f.changedFiles.length > shown.length) {
      console.error(`        ... and ${f.changedFiles.length - shown.length} more`)
    }
  }
}
console.error('')
for (const line of REFRESH_GUIDANCE) {
  console.error(`  ${line}`)
}
console.error('')
console.error(`  (Loud local escape hatch: ${YALC_FRESHNESS_SKIP_ENV}=1 -- never on main.)`)
console.error('')
process.exit(1)
