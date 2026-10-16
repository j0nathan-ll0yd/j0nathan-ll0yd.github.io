#!/usr/bin/env node
/* Regenerates the composed-dashboard measurement fixture (./README.md): the design system's
 * `ssrKnownAnswer` exports, composed by this website's composer at COMPOSED_AT. Run it after any change
 * to the composer or its fragment ids, then commit both files:
 *
 *   node scripts/build-composer.mjs && node tests/fixtures/composed/generate.mjs */
import {readFileSync, writeFileSync} from 'node:fs'
import {createRequire} from 'node:module'
import {ENDPOINTS} from '@j0nathan-ll0yd/portal-contract/constants'
import {mirroredBookCovers} from '../../../src/lib/book-cover-mirror.ts'

const require = createRequire(import.meta.url)
const HERE = new URL('./', import.meta.url)
const COMPOSER = new URL('../../../dist-composer/composer.mjs', import.meta.url)
const COMPOSED_AT = Date.parse('2026-03-18T12:01:00.000Z')
const VARIATION = 'ssrKnownAnswer'

/** The fixtures package directory of each export key: the endpoint's file name without `.json`. */
function fixture(key) {
  const dir = ENDPOINTS[key].replace(/^\//, '').replace(/\.json$/, '')
  return JSON.parse(readFileSync(require.resolve(`@j0nathan-ll0yd/fixtures/generated/${dir}/${VARIATION}.json`), 'utf8'))
}

const {compose} = await import(COMPOSER.href)
const keys = Object.keys(ENDPOINTS).filter((key) => key !== 'focus')
const focus = fixture('focus')
const result = await compose({
  exports: Object.fromEntries(keys.map((key) => [key, fixture(key)])),
  focus,
  nowMs: COMPOSED_AT,
  localCovers: mirroredBookCovers()
})
if (!result.ok) {
  throw new Error(`the composer refused the fixture: ${result.refusal}`)
}
writeFileSync(new URL('focus.json', HERE), JSON.stringify(focus))
// The preview's build id is unknowable here; the Worker accepts FIXTURE_BUILD only through the fixture
// data plane (src/lib/data-plane/faults.ts).
writeFileSync(new URL('dashboard.json', HERE), JSON.stringify({...result.artifact, composer: {build: 'fixture'}}))
console.log(`[composed-fixture] wrote tests/fixtures/composed/dashboard.json, summary ${result.artifact.summary}`)
