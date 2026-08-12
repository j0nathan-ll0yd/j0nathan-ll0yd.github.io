#!/usr/bin/env node
// check-contract-lock.mjs -- Detect hand-edits / staleness in .contract-lock.json.
//
// Tier 1/2/3 enforcement (Plan #11). The committed .contract-lock.json must
// match what `scripts/generate-contract-lock.mjs` would produce for the current
// node_modules/@j0nathan-ll0yd/schemas tree. This guards every field except the two that
// the generator writes non-deterministically:
//   - `generatedAt`          -- wall-clock timestamp, changes every run.
//   - `generatedFrom.sha`    -- live DS repo HEAD when a sibling checkout exists.
// Every other field (checksums, aggregate, generatorVersion, repo) is stable for
// a given schema tree and a hand-edit to any of them is drift worth catching.
//
// Why not `generate-contract-lock.mjs && git diff --exit-code` (the plan's
// literal mechanism)? The two volatile fields above would make a raw diff fire
// on every run regardless of drift. This check normalizes those fields away, so
// it is deterministic and fires ONLY on a genuine hand-edit or a stale lock.
//
// The generator (generate-contract-lock.mjs) is intentionally left unchanged
// (Plan #11 Constraint #3 / Out-of-Scope).
import {createHash} from 'node:crypto'
import {existsSync, readdirSync, readFileSync} from 'node:fs'
import {dirname, join} from 'node:path'
import {fileURLToPath} from 'node:url'

const __dirname = dirname(fileURLToPath(import.meta.url))
const REPO_ROOT = join(__dirname, '..')
const LOCK_FILE = join(REPO_ROOT, '.contract-lock.json')
const SCHEMAS_PKG = join(REPO_ROOT, 'node_modules', '@j0nathan-ll0yd', 'schemas')
// Raw export schemas moved to the backend-owned @j0nathan-ll0yd/portal-contract package.
const PORTAL_CONTRACT_PKG = join(REPO_ROOT, 'node_modules', '@j0nathan-ll0yd', 'portal-contract')

// Fields the generator writes non-deterministically -- excluded from the diff.
const VOLATILE = new Set(['generatedAt', 'generatedFrom.sha'])

function sha256(content) {
  return createHash('sha256').update(content, 'utf-8').digest('hex')
}

function fail(lines) {
  console.error('')
  console.error('ERROR: .contract-lock.json drift detected.')
  for (const l of lines) {
    console.error('  ' + l)
  }
  console.error('')
  console.error('  Hand-edits to this file are forbidden.')
  console.error('  To fix: node scripts/generate-contract-lock.mjs && git add .contract-lock.json')
  console.error('')
  process.exit(1)
}

if (!existsSync(LOCK_FILE)) {
  fail(['.contract-lock.json is missing.'])
}
if (!existsSync(SCHEMAS_PKG)) {
  // Cannot recompute -- environment problem, not a hand-edit. Surface clearly.
  console.error('[check-contract-lock] ERROR: node_modules/@j0nathan-ll0yd/schemas not found.')
  console.error('  Run `pnpm install --frozen-lockfile` first (installs the schemas package from the registry).')
  process.exit(1)
}

// --- Recompute the expected lock exactly as generate-contract-lock.mjs does ---
const filePatterns = [
  {dir: join(PORTAL_CONTRACT_PKG, 'raw-schemas'), prefix: 'raw-schemas', filter: (f) => f.endsWith('.schema.json')},
  {dir: join(SCHEMAS_PKG, 'authored'), prefix: 'authored', filter: (f) => f.endsWith('.schema.json')},
  {dir: join(SCHEMAS_PKG, 'generated'), prefix: 'generated', filter: (f) => f.endsWith('.schema.json')}
]

const expectedFiles = {}
const allContents = []
for (const {dir, prefix, filter} of filePatterns) {
  if (!existsSync(dir)) {
    continue
  }
  const files = readdirSync(dir).filter(filter).sort()
  for (const file of files) {
    const relPath = `${prefix}/${file}`
    const content = readFileSync(join(dir, file), 'utf-8')
    expectedFiles[relPath] = `sha256:${sha256(content)}`
    allContents.push(content)
  }
}
const expectedAggregate = `sha256:${sha256(allContents.join(''))}`

// The deterministic, hand-edit-relevant shape of the lock.
const expected = {
  'generatedFrom.repo': 'j0nathan-ll0yd/design-system-Lifegames',
  'generatedFrom.checksum': expectedAggregate,
  generatorVersion: '1.0.0',
  files: expectedFiles
}

// --- Read the committed lock and project it into the same shape ---
const lock = JSON.parse(readFileSync(LOCK_FILE, 'utf-8'))
const actual = {
  'generatedFrom.repo': lock.generatedFrom?.repo,
  'generatedFrom.checksum': lock.generatedFrom?.checksum,
  generatorVersion: lock.generatorVersion,
  files: lock.files ?? {}
}

const drift = []

// Scalar fields (skip volatile ones).
for (const key of ['generatedFrom.repo', 'generatedFrom.checksum', 'generatorVersion']) {
  if (VOLATILE.has(key)) {
    continue
  }
  if (actual[key] !== expected[key]) {
    drift.push(`${key}: lock "${actual[key]}" != expected "${expected[key]}"`)
  }
}

// Per-file checksums.
for (const [file, exp] of Object.entries(expected.files)) {
  const act = actual.files[file]
  if (act === undefined) {
    drift.push(`REMOVED: ${file} present on disk but absent from lock`)
  } else if (act !== exp) {
    drift.push(`CHANGED: ${file} (lock ${act} != expected ${exp})`)
  }
}
for (const file of Object.keys(actual.files)) {
  if (expected.files[file] === undefined) {
    drift.push(`EXTRA: ${file} present in lock but absent on disk`)
  }
}

if (drift.length > 0) {
  fail(['Lock does not match the regenerated contract:', ...drift])
}

console.log('[check-contract-lock] OK: .contract-lock.json matches the current schemas.')
