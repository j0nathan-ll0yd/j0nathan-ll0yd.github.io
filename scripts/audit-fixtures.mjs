#!/usr/bin/env node
/* audit-fixtures.mjs -- Invariant I2 gate (Plan #04, docs/onboarding-review/04-fixtures-as-ssr-shell.md)
 * and the source half of the no-fixtures-in-production rule (atlas decision 0160, PR 0a).
 *
 * Fixtures are DS-owned: the single source of truth is `@j0nathan-ll0yd/fixtures`, a
 * devDependency that only tests read (the Playwright layer serves
 * `@j0nathan-ll0yd/fixtures/generated/<domain>/<variation>.json` by route interception).
 * Production `/` renders no fixture data. This gate forbids:
 *
 *   - data/**\/*.json            (the retired hand-baked SSR data)
 *   - test/fixtures/**\/*.json   (the retired local fixture factory output)
 *   - src/**\/fixtures/**\/*.json (any in-source fixture snapshot)
 *   - any file under src/ or functions/ that names `@j0nathan-ll0yd/fixtures`
 *     (a direct import from code that ships)
 *
 * This check reads source files only. A TRANSITIVE import -- through another module
 * or package -- is invisible here; the forbid-fixtures Vite plugin
 * (scripts/vite-forbid-fixtures.mjs) watches the production module graph for that.
 *
 * Runs in `prebuild`; CI gates on it. Regenerate/extend fixtures in
 * design-system-Lifegames/packages/fixtures, then publish a new
 * @j0nathan-ll0yd/fixtures version. */
// Node's built-in glob (Node >= 22) -- avoids depending on an ambient transitive
// `glob` version, whose hoisted major floats with the dependency tree.
import {globSync, readFileSync} from 'node:fs'

var PATTERNS = [
  'data/**/*.json',
  'test/fixtures/**/*.json',
  'src/**/fixtures/**/*.json'
]

// Defensive: the search roots (data/, test/fixtures/, src/) should never contain
// node_modules, but keep the guard so a stray nested install can't trip the gate.
var isIgnored = function(p) {
  return /(^|[\\/])node_modules[\\/]/.test(p)
}

var offenders = []
for (var i = 0; i < PATTERNS.length; i++) {
  var matches = globSync(PATTERNS[i], {exclude: isIgnored})
  for (var m = 0; m < matches.length; m++) {
    offenders.push(matches[m])
  }
}

// Code that ships: the Astro sources and the Pages Functions.
var SHIPPED_SOURCES = ['src/**/*.{ts,mts,js,mjs,astro}', 'functions/**/*.{ts,mts,js,mjs}']
// Static `import`/`export ... from`, side-effect `import '...'`, dynamic `import()` and `require()`.
var FIXTURES_SPECIFIER = /(?:\bfrom|\bimport|\brequire)\s*\(?\s*['"]@j0nathan-ll0yd\/fixtures(?:\/[^'"]*)?['"]/

var importers = []
for (var s = 0; s < SHIPPED_SOURCES.length; s++) {
  var files = globSync(SHIPPED_SOURCES[s], {exclude: isIgnored})
  for (var f = 0; f < files.length; f++) {
    if (FIXTURES_SPECIFIER.test(readFileSync(files[f], 'utf8'))) {
      importers.push(files[f])
    }
  }
}

if (importers.length > 0) {
  console.error('Shipped code must not import @j0nathan-ll0yd/fixtures (atlas decision 0160):')
  for (var n = 0; n < importers.length; n++) {
    console.error('  x ' + importers[n])
  }
  console.error('\nProduction pages carry no fixture data. Tests serve fixtures by route interception only.')
  process.exit(1)
}

if (offenders.length > 0) {
  console.error('Consumer-side fixtures are forbidden (Invariant I2):')
  for (var o = 0; o < offenders.length; o++) {
    console.error('  x ' + offenders[o])
  }
  console.error('\nFixtures are DS-owned. Add/edit them in')
  console.error('design-system-Lifegames/packages/fixtures, then publish a new @j0nathan-ll0yd/fixtures version.')
  console.error('Tests consume `@j0nathan-ll0yd/fixtures/generated/<domain>/<variation>.json` (Playwright).')
  process.exit(1)
}

console.log('No consumer-side fixtures ✓ (Invariant I2: data/, test/fixtures/, src/**/fixtures/ clean; no src/ or functions/ import)')
