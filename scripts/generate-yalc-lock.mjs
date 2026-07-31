#!/usr/bin/env node
// generate-yalc-lock.mjs -- (re)generate the committed `.yalc-lock.json`.
//
// Records the content hash of every `file:.yalc/*` linked package (atlas decision 0013). Run this
// AFTER refreshing `.yalc` from upstream (`bash scripts/ci-setup.sh`, or a producer republish +
// `npx yalc update`) so the lock reflects upstream, not a stale local tree -- the lock is only
// meaningful if generated from a fresh tree. CI (static-checks.yml job `yalc-freshness`) then
// re-verifies the committed lock against an upstream-reconstructed `.yalc` on every PR.
//
// The generated lock is a REVIEWABLE git artifact: it turns an otherwise-invisible `.yalc` change
// into a diff a reviewer can see and a PR can gate on.

import {dirname, join} from 'node:path'
import {fileURLToPath} from 'node:url'
import {computeYalcLock, findYalcDependencies, serializeYalcLock, YALC_LOCK_FILENAME} from './lib/yalc-freshness.mjs'
import {writeFileSync} from 'node:fs'

const REPO_ROOT = join(dirname(fileURLToPath(import.meta.url)), '..')

const deps = findYalcDependencies(REPO_ROOT)
if (deps.length === 0) {
  console.error('[yalc-lock] ERROR: no file:.yalc/* dependencies found in package.json.')
  console.error('  Nothing to lock. Is this the right repo / is package.json intact?')
  process.exit(1)
}

const lock = computeYalcLock(REPO_ROOT)

// Fail loud if any declared dependency could not be hashed (absent / empty `.yalc`): a lock that
// silently omits a package would let that package drift unnoticed -- the placeholder antipattern
// this whole gate exists to reject.
const missing = deps.filter((d) => !lock.packages[d.name])
if (missing.length > 0) {
  console.error('[yalc-lock] ERROR: these linked packages are not installed under .yalc/ (cannot hash):')
  for (const d of missing) {
    console.error(`    - ${d.name}  (${d.specifier})`)
  }
  console.error('')
  console.error('  Refresh first:  bash scripts/ci-setup.sh   (or: npx yalc update)')
  process.exit(1)
}

// `generatedAt` is provenance only -- never read by the check (the assessment re-derives every
// hash), so a changing timestamp cannot cause a false drift.
lock.generatedAt = new Date().toISOString()

const outPath = join(REPO_ROOT, YALC_LOCK_FILENAME)
writeFileSync(outPath, serializeYalcLock(lock))

console.log(`[yalc-lock] Generated ${YALC_LOCK_FILENAME}`)
for (const name of Object.keys(lock.packages).sort()) {
  const entry = lock.packages[name]
  const fileCount = Object.keys(entry.files).length
  console.log(`  ${name}@${entry.version ?? '?'}  ${entry.aggregate.slice(0, 19)}...  (${fileCount} files)`)
}
console.log('')
console.log('  Commit .yalc-lock.json. CI (job `yalc-freshness`) re-verifies it against upstream main.')
