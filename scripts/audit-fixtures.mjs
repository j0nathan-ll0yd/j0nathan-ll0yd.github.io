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
 *   - any file under src/ or functions/, or astro.config, whose code names
 *     `@j0nathan-ll0yd/fixtures` in a quoted specifier (a direct import from code
 *     that ships)
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

// Code that ships: the Astro sources, the Pages Functions and the build config.
var SHIPPED_SOURCES = [
  'src/**/*.{ts,mts,cts,tsx,js,mjs,cjs,jsx,astro,md,mdx}',
  'functions/**/*.{ts,mts,cts,tsx,js,mjs,cjs,jsx}',
  'astro.config.{mjs,ts,js}'
]
// Any quoted specifier that names the package or a subpath, in code: a static or dynamic import,
// `require`, `createRequire(...)(...)`, `import.meta.resolve`, or a template literal. Comments are
// stripped first, so prose that names the package is not an import.
var FIXTURES_SPECIFIER = /['"`]@j0nathan-ll0yd\/fixtures(?:\/[^'"`]*)?['"`]/

/** The source with block comments and whole-line or trailing `//` comments removed. */
var stripComments = function(source) {
  return source.replace(/\/\*[\s\S]*?\*\//g, '').replace(/(^|[^:'"`\\])\/\/.*$/gm, '$1')
}

var importers = []
for (var s = 0; s < SHIPPED_SOURCES.length; s++) {
  var files = globSync(SHIPPED_SOURCES[s], {exclude: isIgnored})
  for (var f = 0; f < files.length; f++) {
    if (FIXTURES_SPECIFIER.test(stripComments(readFileSync(files[f], 'utf8')))) {
      importers.push(files[f])
    }
  }
}

// Report both failures before exiting, so one run names every offender.
if (importers.length > 0) {
  console.error('Shipped code must not import @j0nathan-ll0yd/fixtures (atlas decision 0160):')
  for (var n = 0; n < importers.length; n++) {
    console.error('  x ' + importers[n])
  }
  console.error('\nProduction pages carry no fixture data. Tests serve fixtures by route interception only.')
}

if (offenders.length > 0) {
  console.error('Consumer-side fixtures are forbidden (Invariant I2):')
  for (var o = 0; o < offenders.length; o++) {
    console.error('  x ' + offenders[o])
  }
  console.error('\nFixtures are DS-owned. Add/edit them in')
  console.error('design-system-Lifegames/packages/fixtures, then publish a new @j0nathan-ll0yd/fixtures version.')
  console.error('Tests consume `@j0nathan-ll0yd/fixtures/generated/<domain>/<variation>.json` (Playwright).')
}

if (importers.length > 0 || offenders.length > 0) {
  process.exit(1)
}

console.log('No consumer-side fixtures ✓ (Invariant I2: data/, test/fixtures/, src/**/fixtures/ clean; no src/, functions/ or astro.config import)')
