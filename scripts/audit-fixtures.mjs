#!/usr/bin/env node
/* audit-fixtures.mjs -- Invariant I2 gate (Plan #04, docs/onboarding-review/04-fixtures-as-ssr-shell.md).
 *
 * Fixtures are DS-owned: the single source of truth is `@lifegames/fixtures`.
 * This consumer repo must NEVER hand-bake local fixture/snapshot JSON again --
 * the SSR shell comes from `getDashboardFixture()` and the Playwright layer reads
 * `@lifegames/fixtures/generated/<domain>/<variation>.json`. This gate forbids the
 * old hand-baked locations from reappearing.
 *
 * FORBIDDEN (any match fails the build):
 *   - data/**\/*.json            (the retired hand-baked SSR data)
 *   - test/fixtures/**\/*.json   (the retired local fixture factory output)
 *   - src/**\/fixtures/**\/*.json (any in-source fixture snapshot)
 *
 * Runs in `prebuild`; CI gates on it. Regenerate/extend fixtures in
 * design-system-Lifegames/packages/fixtures, then `pnpm yalc:publish`. */
import {globSync} from 'glob'

var PATTERNS = [
  'data/**/*.json',
  'test/fixtures/**/*.json',
  'src/**/fixtures/**/*.json'
]

var offenders = []
for (var i = 0; i < PATTERNS.length; i++) {
  var matches = globSync(PATTERNS[i], {ignore: ['node_modules/**', '**/node_modules/**', '.yalc/**']})
  for (var m = 0; m < matches.length; m++) {
    offenders.push(matches[m])
  }
}

if (offenders.length > 0) {
  console.error('Consumer-side fixtures are forbidden (Invariant I2):')
  for (var o = 0; o < offenders.length; o++) {
    console.error('  x ' + offenders[o])
  }
  console.error('\nFixtures are DS-owned. Add/edit them in')
  console.error('design-system-Lifegames/packages/fixtures, then `pnpm yalc:publish`.')
  console.error('Consume via `@lifegames/fixtures` (SSR shell) and')
  console.error('`@lifegames/fixtures/generated/<domain>/<variation>.json` (Playwright).')
  process.exit(1)
}

console.log('No consumer-side fixtures ✓ (Invariant I2: data/, test/fixtures/, src/**/fixtures/ clean)')
