// Writes the fixture exports and focus as one JSON payload, the body a publish-time composition prototype
// receives. No live data. Usage: pnpm exec tsx scripts/cpu-bench/dump-payload.mjs [out=/tmp/payload.json]
import {readFileSync, writeFileSync} from 'node:fs'
import {createRequire} from 'node:module'
import {ENDPOINTS} from '@j0nathan-ll0yd/portal-contract/constants'
const require = createRequire(import.meta.url)
function fixture(key) {
  const dir = ENDPOINTS[key].replace(/^\//, '').replace(/\.json$/, '')
  for (const name of ['sixBooks', 'full', 'baseline', 'ssrKnownAnswer']) {
    let file
    try {
      file = require.resolve(`@j0nathan-ll0yd/fixtures/generated/${dir}/${name}.json`)
    } catch {
      continue
    }
    return JSON.parse(readFileSync(file, 'utf8'))
  }
  throw new Error(key)
}
const keys = Object.keys(ENDPOINTS).filter((k) => k !== 'focus')
const payload = {
  exports: Object.fromEntries(keys.map((k) => [k, fixture(k)])),
  focus: JSON.parse(readFileSync('tests/fixtures/composed/focus.json', 'utf8'))
}
const out = process.argv[2] ?? '/tmp/payload.json'
writeFileSync(out, JSON.stringify(payload))
console.log('payload bytes', Buffer.byteLength(JSON.stringify(payload)), 'per export:',
  keys.map((k) => `${k}=${Buffer.byteLength(JSON.stringify(payload.exports[k]))}`).join(' '))
