// Composes a larger artifact from the richest fixture variations, for size scaling. Not live data.
import {readFileSync, writeFileSync} from 'node:fs'
import {createRequire} from 'node:module'
import {ENDPOINTS} from '@j0nathan-ll0yd/portal-contract/constants'
import {mirroredBookCovers} from '../../src/lib/book-cover-mirror.ts'
const require = createRequire(import.meta.url)
const [, , variation = 'full', out = 'scripts/cpu-bench/dashboard-big.json'] = process.argv
function fixture(key, v) {
  const dir = ENDPOINTS[key].replace(/^\//, '').replace(/\.json$/, '')
  for (const name of [v, 'full', 'baseline', 'ssrKnownAnswer']) {
    let file
    try {
      file = require.resolve(`@j0nathan-ll0yd/fixtures/generated/${dir}/${name}.json`)
    } catch {
      continue
    }
    return JSON.parse(readFileSync(file, 'utf8'))
  }
  throw new Error(`no fixture for ${key}`)
}
const {compose} = await import(new URL('../../dist-composer/composer.mjs', import.meta.url).href)
const keys = Object.keys(ENDPOINTS).filter((key) => key !== 'focus')
const focus = JSON.parse(readFileSync('tests/fixtures/composed/focus.json', 'utf8'))
const result = await compose({
  exports: Object.fromEntries(keys.map((key) => [key, fixture(key, variation)])),
  focus,
  nowMs: Date.now(),
  localCovers: mirroredBookCovers()
})
if (!result.ok) {
  throw new Error(`refused ${result.refusal}`)
}
const text = JSON.stringify({...result.artifact, composer: {build: 'dev'}})
writeFileSync(out, text)
console.log(out, Buffer.byteLength(text), 'bytes, summary', result.artifact.summary, 'per fragment:',
  Object.entries(result.artifact.fragments).map(([k, v]) => `${k}=${v.length}`).join(' '))
