// Seeds the local PAGE namespace (atlas decision 0164) for profiling the published read: the
// `fragments:<build>` entry from a composed fixture artifact (compose-big.mjs output, or the
// committed tests/fixtures/composed/dashboard.json), restamped to now and to the local build, through
// the composer's own encoder, and a visible `focus` value. Local storage only (`--local`); never a
// remote namespace. Not live data.
// Usage: [FOCUS=<value>|-] node scripts/cpu-bench/seed-kv.mjs [artifact.json=tests/fixtures/composed/dashboard.json] [build=dev]
// FOCUS=<value> writes that focus value instead of the artifact's (a hiding value: the suppressed
// value-free path); FOCUS=- deletes the `focus` key (the unavailable value-free path).
import {execFileSync} from 'node:child_process'
import {mkdtempSync, readFileSync, writeFileSync} from 'node:fs'
import {tmpdir} from 'node:os'
import path from 'node:path'

const [, , artifactPath = 'tests/fixtures/composed/dashboard.json', build = 'dev'] = process.argv
const {publishedEntry, publishedFocusValue, PUBLISHED_FOCUS_KEY} = await import(new URL('../../dist-composer/composer.mjs', import.meta.url).href)
const artifact = JSON.parse(readFileSync(artifactPath, 'utf8'))
if (artifact.facts === undefined) {
  throw new Error(`${artifactPath} has no facts: recompose it with this composer`)
}
const now = new Date().toISOString()
const entry = publishedEntry(artifact, now)
const dir = mkdtempSync(path.join(tmpdir(), 'seed-kv-'))
const value = path.join(dir, 'fragments.json')
const focus = path.join(dir, 'focus.json')
writeFileSync(value, entry.value)
const currentFocus = process.env.FOCUS ?? artifact.currentFocus
writeFileSync(focus, publishedFocusValue({currentFocus, publishedAt: now}))
const key = `fragments:${build}`
const put = (k, file, extra = []) =>
  execFileSync('pnpm', ['exec', 'wrangler', 'kv', 'key', 'put', k, '--path', file, '--binding', 'PAGE', '--local', ...extra], {stdio: 'inherit'})
put(key, value, ['--metadata', JSON.stringify({...entry.metadata, build})])
if (process.env.FOCUS === '-') {
  execFileSync('pnpm', ['exec', 'wrangler', 'kv', 'key', 'delete', PUBLISHED_FOCUS_KEY, '--binding', 'PAGE', '--local'], {stdio: 'inherit'})
  console.log(`seeded ${key} (${Buffer.byteLength(entry.value)} bytes) at ${now}; deleted focus`)
} else {
  put(PUBLISHED_FOCUS_KEY, focus)
  console.log(`seeded ${key} (${Buffer.byteLength(entry.value)} bytes) and focus ${JSON.stringify(currentFocus)} at ${now}`)
}
