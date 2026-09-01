#!/usr/bin/env node
// Regenerates tests/behavioral/a11y-baseline.json from an observation run.
//
// Usage: pnpm run a11y:update-baseline
//
// The behavioral suite is run with A11Y_UPDATE_BASELINE=1, which makes the per-widget scan in
// tests/behavioral/a11y.ts record what it saw to test-results/a11y-observed.jsonl instead of
// asserting. This script merges those observations into the committed baseline.
//
// WHY A SEPARATE PROCESS. Playwright workers cannot safely co-write one JSON file, and a
// globalTeardown runs in a different process from the workers that hold the results. An
// append-only JSONL scratch file plus a deterministic merge is the only shape that is correct
// under any worker count.
//
// THE MERGE IS A REPLACE, NOT A UNION. The new baseline is exactly what this run observed, so a
// violation that was fixed drops out (the ratchet tightens) rather than lingering as a stale
// grandfathering. That means the observation run must cover EVERY scan key -- the script refuses
// to write if it did not, because a partial run would silently un-grandfather real debt and red
// the next CI run for states it never looked at.

import {existsSync, readFileSync, rmSync, writeFileSync} from 'node:fs'
import {dirname, join} from 'node:path'
import {fileURLToPath} from 'node:url'

const ROOT = join(dirname(fileURLToPath(import.meta.url)), '..')
const BASELINE_PATH = join(ROOT, 'tests', 'behavioral', 'a11y-baseline.json')
const OBSERVED_PATH = join(ROOT, 'test-results', 'a11y-observed.jsonl')

function abortRed(message) {
  console.error(`a11y baseline update FAILED: ${message}`)
  process.exit(1)
}

if (!existsSync(OBSERVED_PATH)) {
  abortRed(`no observations at ${OBSERVED_PATH}. Run the suite with A11Y_UPDATE_BASELINE=1 first ` + '(that is what `pnpm run a11y:update-baseline` does).')
}

const observations = readFileSync(OBSERVED_PATH, 'utf8').split('\n').filter((line) => line.trim() !== '').map((line) => JSON.parse(line))

for (const observation of observations) {
  if (
    typeof observation !== 'object' || observation === null || typeof observation.key !== 'string' ||
    !Array.isArray(observation.ruleIds) || observation.ruleIds.some((id) => typeof id !== 'string')
  ) {
    abortRed(`malformed observation record: ${JSON.stringify(observation)}`)
  }
}

// Every declared scan key must have been observed, or the merge is unsafe. The declarations are
// JSON precisely so this script and tests/behavioral/a11y-scan-targets.ts read the SAME list: an
// earlier version regex-parsed the .ts source and broke on the first inline comment added to it.
const targetsPath = join(ROOT, 'tests', 'behavioral', 'a11y-scan-targets.json')
const targets = JSON.parse(readFileSync(targetsPath, 'utf8')).targets
if (!Array.isArray(targets) || targets.length === 0 || targets.some((t) => typeof t?.key !== 'string')) {
  abortRed(`could not read targets[].key out of ${targetsPath}`)
}
const declared = targets.map((target) => target.key)

const observedKeys = new Set(observations.map((observation) => observation.key))
const missing = declared.filter((key) => !observedKeys.has(key)).sort()
if (missing.length > 0) {
  abortRed(
    `the observation run did not cover every declared scan key. Missing: ${missing.join(', ')}. ` +
      'Re-run the FULL behavioral suite; a partial run would drop real debt out of the baseline.'
  )
}

const undeclared = [...observedKeys].filter((key) => !declared.includes(key)).sort()
if (undeclared.length > 0) {
  abortRed(`observed scan keys that are not declared in A11Y_SCAN_TARGETS: ${undeclared.join(', ')}`)
}

const grandfathered = {}
for (const key of [...declared].sort()) {
  const ruleIds = [
    ...new Set(observations.filter((observation) => observation.key === key).flatMap((o) => o.ruleIds))
  ].sort()
  if (ruleIds.length > 0) {
    grandfathered[key] = ruleIds
  }
}

const previous = JSON.parse(readFileSync(BASELINE_PATH, 'utf8'))
const next = {...previous, grandfathered}
writeFileSync(BASELINE_PATH, `${JSON.stringify(next, null, 2)}\n`)
rmSync(OBSERVED_PATH)

const total = Object.values(grandfathered).reduce((sum, ids) => sum + ids.length, 0)
console.log(
  `a11y baseline written: ${Object.keys(grandfathered).length} of ${declared.length} scan keys carry debt, ` +
    `${total} grandfathered (scan key, rule) pairs.`
)
for (const [key, ids] of Object.entries(grandfathered)) {
  console.log(`  ${key}: ${ids.join(', ')}`)
}
