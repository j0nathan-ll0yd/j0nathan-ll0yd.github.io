#!/usr/bin/env node
// generate-contract-lock.mjs — Generate .contract-lock.json for the web repo.
// Tracks the @j0nathan-ll0yd/schemas package consumed from the registry (GitHub Packages).
import {createHash} from 'node:crypto'
import {existsSync, readdirSync, readFileSync, writeFileSync} from 'node:fs'
import {dirname, join} from 'node:path'
import {execSync} from 'node:child_process'
import {fileURLToPath} from 'node:url'

const __dirname = dirname(fileURLToPath(import.meta.url))
const REPO_ROOT = join(__dirname, '..')
const LOCK_FILE = join(REPO_ROOT, '.contract-lock.json')
const SCHEMAS_PKG = join(REPO_ROOT, 'node_modules', '@j0nathan-ll0yd', 'schemas')
// Raw export schemas moved to the backend-owned @j0nathan-ll0yd/portal-contract package.
const PORTAL_CONTRACT_PKG = join(REPO_ROOT, 'node_modules', '@j0nathan-ll0yd', 'portal-contract')

function sha256(content) {
  return createHash('sha256').update(content, 'utf-8').digest('hex')
}

if (!existsSync(SCHEMAS_PKG)) {
  console.error('[contract-lock] ERROR: node_modules/@j0nathan-ll0yd/schemas not found.')
  console.error('  Run `npm ci --legacy-peer-deps` (or `npm install --legacy-peer-deps`) first.')
  process.exit(1)
}

// Resolve the upstream design-system-Lifegames sha for provenance. Priority:
//   1. Git HEAD of the DS repo (sibling checkout, or DS_REPO_ROOT override).
//   2. lpGitSha from the installed package's .lp-sync-manifest.json.
// If neither resolves we FAIL LOUDLY rather than silently recording a
// plausible-looking placeholder. A provenance field whose failure mode is
// "record nothing" is worse than one that errors: check-contract-lock.mjs
// deliberately excludes generatedFrom.sha, so no gate can ever tell a genuine
// sha from a swallowed "unknown". Set CONTRACT_LOCK_ALLOW_UNKNOWN_SHA=1 to opt
// into a deliberate "unknown" (e.g. an environment with no DS provenance).

// (1) DS repo HEAD. Defaults to the sibling checkout; DS_REPO_ROOT overrides it
// for worktrees where ../design-system-Lifegames does not resolve. stderr is
// suppressed so a missing path does not print git's fatal noise before the
// clean diagnostic below.
const dsRepoRoot = process.env.DS_REPO_ROOT ?? join(REPO_ROOT, '..', 'design-system-Lifegames')
let dsRepoSha = null
try {
  dsRepoSha = execSync('git rev-parse HEAD', {cwd: dsRepoRoot, encoding: 'utf-8', stdio: ['ignore', 'pipe', 'ignore']}).trim()
} catch {
  // Fall through to the manifest, then the loud failure below.
}

// (2) Manifest fallback — the LP git sha the schemas were synced from.
let dsSha = null
const manifestPath = join(SCHEMAS_PKG, 'vendored', '.lp-sync-manifest.json')
if (existsSync(manifestPath)) {
  const manifest = JSON.parse(readFileSync(manifestPath, 'utf-8'))
  dsSha = manifest.lpGitSha ?? null
}

const resolvedSha = dsRepoSha ?? dsSha
let upstreamSha
if (resolvedSha) {
  upstreamSha = resolvedSha
} else if (process.env.CONTRACT_LOCK_ALLOW_UNKNOWN_SHA === '1') {
  upstreamSha = 'unknown'
  console.warn('[contract-lock] WARNING: recording generatedFrom.sha="unknown" (CONTRACT_LOCK_ALLOW_UNKNOWN_SHA=1).')
} else {
  console.error('[contract-lock] ERROR: could not resolve the upstream design-system-Lifegames sha.')
  console.error(`  tried git HEAD at: ${dsRepoRoot}`)
  console.error(`  tried manifest at: ${manifestPath}`)
  console.error('  Fix one of:')
  console.error('    - run from the main checkout where ../design-system-Lifegames exists, or')
  console.error('    - set DS_REPO_ROOT=/path/to/design-system-Lifegames, or')
  console.error('    - set CONTRACT_LOCK_ALLOW_UNKNOWN_SHA=1 to deliberately record "unknown".')
  process.exit(1)
}

// Collect all schema-relevant files from the installed package
// Include vendored schemas, authored schemas, generated schemas, and dist types
const filePatterns = [
  {dir: join(PORTAL_CONTRACT_PKG, 'raw-schemas'), key: 'raw-schemas', filter: (f) => f.endsWith('.schema.json')},
  {dir: join(SCHEMAS_PKG, 'authored'), key: 'authored', filter: (f) => f.endsWith('.schema.json')},
  {dir: join(SCHEMAS_PKG, 'generated'), key: 'generated', filter: (f) => f.endsWith('.schema.json')}
]

const checksums = {}
const allContents = []

for (const {dir, key, filter} of filePatterns) {
  if (!existsSync(dir)) {
    continue
  }
  const files = readdirSync(dir).filter(filter).sort()
  for (const file of files) {
    const relPath = `${key}/${file}`
    const content = readFileSync(join(dir, file), 'utf-8')
    checksums[relPath] = `sha256:${sha256(content)}`
    allContents.push(content)
  }
}

const aggregateChecksum = `sha256:${sha256(allContents.join(''))}`

const lock = {
  generatedFrom: {repo: 'j0nathan-ll0yd/design-system-Lifegames', sha: upstreamSha, checksum: aggregateChecksum},
  generatedAt: new Date().toISOString(),
  generatorVersion: '1.0.0',
  files: checksums
}

writeFileSync(LOCK_FILE, JSON.stringify(lock, null, 2) + '\n')
console.log(`[contract-lock] Generated ${LOCK_FILE}`)
console.log(`  upstream: j0nathan-ll0yd/design-system-Lifegames@${upstreamSha.slice(0, 8)}`)
console.log(`  aggregate: ${aggregateChecksum}`)
console.log(`  files: ${Object.keys(checksums).length}`)
