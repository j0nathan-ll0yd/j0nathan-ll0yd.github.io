// yalc-freshness.mjs -- framework-agnostic core for the `file:.yalc/*` freshness gate.
//
// atlas decision 0013 ("merged is not deployed"): `.yalc/` is gitignored, so a linked
// dependency has four versions that nothing reconciles -- the tracked git files, the local
// `.yalc` tree, CI's reconstructed `.yalc`, and whatever `.yalc` the deploying checkout holds.
// In THIS repo, merging to `main` IS a production deploy (Cloudflare Pages auto-deploy) and it
// links SIX packages this way (copy, fixtures, portal-contract, schemas, tokens, web) -- the
// higher-risk half of 0013, previously with no gate at all.
//
// This module reconciles the one state that survives in git -- a committed lock recording the
// expected content hash of each linked package -- against the on-disk `.yalc` tree the build
// actually bundles. It is deliberately content-addressed (SHA-256 over the shipped files), not
// source-SHA-addressed: the honest question is "are these the bytes we expect?", and a content
// hash answers it against gitignored content that no upstream commit id can vouch for. It also
// catches a hand-tampered `.yalc` that a bare version/sha check would miss.
//
// PRIOR ART: ported (framework-agnostic core, JS) from mantle's
// `packages/cli/src/yalc/freshness.ts` (merged as mantle#291). We port rather than depend
// because that module imports `@mantleframework/core` (`YalcConfig`) and this is an Astro /
// Cloudflare-Pages repo with no Mantle dependency; the core is small and matches this repo's
// existing `.mjs` lock-script idiom (generate-contract-lock.mjs / check-contract-lock.mjs).
//
// THE BINDING (do not lose this -- it is what #291's first, self-blessed version got wrong):
// a lock↔disk comparison alone measures nothing, because the same machine that generated the
// lock hashed its own disk. What matters is lock↔UPSTREAM. Here that binding is achieved by
// WHERE the check runs, not by a reconstruct step in this module: CI's `scripts/ci-setup.sh`
// rebuilds `.yalc` from upstream `main` FIRST, then this check compares the committed lock
// against that upstream-fresh tree. See `scripts/check-yalc-freshness.mjs` and
// `.github/workflows/static-checks.yml` (job `yalc-freshness`).

import {createHash} from 'node:crypto'
import {existsSync, readdirSync, readFileSync, readlinkSync, statSync} from 'node:fs'
import {join, relative, resolve, sep} from 'node:path'

/** Committed lock file at the repo root. Git-tracked on purpose -- it is the only one of
 *  decision 0013's four states that a reviewer, `git diff`, and the deploying checkout all see
 *  identically. Turns an invisible `.yalc` change into a reviewable PR diff. */
export const YALC_LOCK_FILENAME = '.yalc-lock.json'

/** Loud, explicit escape hatch. When `1`/`true`, the assertion is bypassed and a prominent
 *  warning is printed -- never a silent default (decision 0013 driver 4 / global rule B10). Its
 *  legitimate use is local iteration against an unpublished DS branch. */
export const YALC_FRESHNESS_SKIP_ENV = 'YALC_FRESHNESS_SKIP'

const LOCK_VERSION = 'v1'

/** yalc's own bookkeeping file, present in every installed link. Excluded from the content hash
 *  because it is metadata, not shipped code -- and a hand-edit to a `dist` file leaves `yalc.sig`
 *  untouched, so hashing the actual files (not trusting `yalc.sig`) is what catches drift. */
const YALC_METADATA_FILES = new Set(['yalc.sig'])

/** How to repair a stale/absent link. Surfaced in every failure message so the gate names the
 *  fix, not just the problem (decision 0013: "fail loud, name the stale package and the command
 *  to fix it"). `ci-setup.sh` is the authoritative reconstruct-from-upstream path. */
export const REFRESH_GUIDANCE = [
  'Refresh the linked packages from upstream, then regenerate + commit the lock:',
  '  bash scripts/ci-setup.sh                 # reconstruct .yalc from upstream main',
  '  node scripts/generate-yalc-lock.mjs      # regenerate the lock from the fresh tree',
  '  git add .yalc-lock.json',
  '',
  'Already have a fresh yalc store (a producer just republished)? A lighter refresh is:',
  '  npx yalc update && node scripts/generate-yalc-lock.mjs && git add .yalc-lock.json'
]

/** Discover every `file:.yalc/*` dependency across dependencies / devDependencies /
 *  optionalDependencies. Only links physically rooted under `.yalc/` count -- a `file:` pointing
 *  elsewhere is an ordinary local path, not a yalc link. Sorted by name for determinism. */
export function findYalcDependencies(cwd) {
  const pkgPath = join(cwd, 'package.json')
  if (!existsSync(pkgPath)) {
    return []
  }
  let pkg
  try {
    // Narrow at runtime rather than trusting the parse: a malformed manifest is "no deps",
    // not a crash. (Repo idiom + mantle freshness.ts readPackageJson.)
    const parsed = JSON.parse(readFileSync(pkgPath, 'utf-8'))
    pkg = parsed && typeof parsed === 'object' ? parsed : {}
  } catch {
    return []
  }

  const found = new Map()
  for (const bucket of ['dependencies', 'devDependencies', 'optionalDependencies']) {
    const deps = pkg[bucket]
    if (!deps || typeof deps !== 'object') {
      continue
    }
    for (const [name, spec] of Object.entries(deps)) {
      if (typeof spec !== 'string' || !spec.startsWith('file:')) {
        continue
      }
      const target = spec.slice('file:'.length)
      const normalized = target.replaceAll('\\', '/')
      if (normalized !== '.yalc' && !normalized.startsWith('.yalc/')) {
        continue
      }
      if (!found.has(name)) {
        // First declaration wins; a package repeated across buckets is the same link.
        found.set(name, {name, specifier: spec, dir: resolve(cwd, target)})
      }
    }
  }
  return [...found.values()].sort((a, b) => a.name.localeCompare(b.name))
}

/** Recursively list files under a dir as POSIX-relative paths, excluding nested `node_modules`
 *  (yalc's own sub-links live there and are not this package's shipped content). Symlinks are
 *  recorded but never traversed -- a symlink-to-directory would otherwise EISDIR, a dangling one
 *  ENOENT. Sorted by path for deterministic hashing. */
function listFiles(root) {
  const out = []
  const walk = (dir) => {
    for (const entry of readdirSync(dir, {withFileTypes: true})) {
      if (entry.name === 'node_modules') {
        continue
      }
      const abs = join(dir, entry.name)
      const rel = relative(root, abs).split(sep).join('/')
      if (entry.isSymbolicLink()) {
        out.push({rel, symlink: true})
      } else if (entry.isDirectory()) {
        walk(abs)
      } else if (entry.isFile()) {
        out.push({rel, symlink: false})
      }
    }
  }
  walk(root)
  return out.sort((a, b) => a.rel.localeCompare(b.rel))
}

function sha256(data) {
  return `sha256:${createHash('sha256').update(data).digest('hex')}`
}

/**
 * Content hash of an installed link: `{aggregate, files}`. Returns null when the directory is
 * absent OR ships no files -- callers fail loud rather than blessing an empty tree. An empty file
 * set hashes to the SHA-256 of nothing (`e3b0c442...`) and would otherwise pass forever while
 * measuring nothing, the exact placeholder antipattern the web #153 contract-lock fix rejects.
 */
export function hashYalcPackage(dir) {
  if (!existsSync(dir) || !statSync(dir).isDirectory()) {
    return null
  }
  const files = {}
  const aggregateParts = []
  for (const {rel, symlink} of listFiles(dir)) {
    if (YALC_METADATA_FILES.has(rel)) {
      continue
    }
    // Symlinks are hashed by their target string (not followed): deterministic and immune to the
    // EISDIR/ENOENT a link-to-directory or a dangling link would raise on readFileSync.
    const fileHash = symlink
      ? sha256(`symlink:${readlinkSync(join(dir, rel))}`)
      : sha256(readFileSync(join(dir, rel)))
    files[rel] = fileHash
    // Path-tag each file so a rename is not hash-neutral with an identical-content sibling.
    aggregateParts.push(`${rel} ${fileHash}`)
  }
  if (aggregateParts.length === 0) {
    return null
  }
  return {aggregate: sha256(aggregateParts.join('\n')), files}
}

/** Read the `version` from a linked package's own package.json -- provenance only (answers
 *  "which version shipped" from git; the aggregate covers content). undefined when unreadable. */
function readLinkedVersion(dir) {
  const path = join(dir, 'package.json')
  if (!existsSync(path)) {
    return undefined
  }
  try {
    const parsed = JSON.parse(readFileSync(path, 'utf-8'))
    if (parsed && typeof parsed === 'object' && typeof parsed.version === 'string') {
      return parsed.version
    }
  } catch {
    // Provenance is best-effort, not load-bearing.
  }
  return undefined
}

/** Build a fresh lock from the current on-disk `.yalc` state. Skips uninstalled/empty links (they
 *  cannot be hashed). `generatedAt` is intentionally NOT set here so this stays deterministic; the
 *  generate command stamps it. */
export function computeYalcLock(cwd) {
  const packages = {}
  for (const dep of findYalcDependencies(cwd)) {
    const hash = hashYalcPackage(dep.dir)
    if (!hash) {
      continue
    }
    packages[dep.name] = {specifier: dep.specifier, version: readLinkedVersion(dep.dir), aggregate: hash.aggregate, files: hash.files}
  }
  return {version: LOCK_VERSION, packages}
}

/** Serialize a lock deterministically (sorted keys, trailing newline) for a stable git diff. */
export function serializeYalcLock(lock) {
  const sortedPackages = {}
  for (const name of Object.keys(lock.packages).sort()) {
    const entry = lock.packages[name]
    const sortedFiles = {}
    for (const file of Object.keys(entry.files).sort()) {
      sortedFiles[file] = entry.files[file]
    }
    sortedPackages[name] = {specifier: entry.specifier, version: entry.version, aggregate: entry.aggregate, files: sortedFiles}
  }
  const out = {version: lock.version, generatedAt: lock.generatedAt, packages: sortedPackages}
  return `${JSON.stringify(out, null, 2)}\n`
}

/** Read the committed lock, or null when absent/unparseable/malformed. A truncated lock is
 *  treated as "no lock" (a hard error downstream), never silently accepted. */
export function readYalcLock(cwd, filename = YALC_LOCK_FILENAME) {
  const path = join(cwd, filename)
  if (!existsSync(path)) {
    return null
  }
  try {
    const parsed = JSON.parse(readFileSync(path, 'utf-8'))
    if (!parsed || typeof parsed !== 'object') {
      return null
    }
    if (!parsed.packages || typeof parsed.packages !== 'object') {
      return null
    }
    return parsed
  } catch {
    return null
  }
}

/** True when the loud escape hatch is engaged. */
export function isFreshnessSkipped() {
  const value = process.env[YALC_FRESHNESS_SKIP_ENV]
  return value === '1' || value === 'true'
}

/** Files present in both maps with differing hashes, plus files added or removed. Sorted. */
function diffChangedFiles(expected, actual) {
  const changed = new Set()
  for (const [file, hash] of Object.entries(expected)) {
    if (actual[file] !== hash) {
      changed.add(file)
    }
  }
  for (const file of Object.keys(actual)) {
    if (expected[file] === undefined) {
      changed.add(file)
    }
  }
  return [...changed].sort()
}

/**
 * Assess `file:.yalc/*` freshness by comparing on-disk `.yalc` content hashes against the
 * committed lock. Pure -- no console output, never exits; callers report and decide.
 *
 * Finding kinds: 'ok' | 'drift' | 'not-installed' | 'missing-lock-entry' | 'stale-lock-entry' |
 * 'no-lock'. Every non-'ok' kind is an error (fail loud).
 */
export function assessYalcFreshness(cwd, {lockFilename = YALC_LOCK_FILENAME} = {}) {
  if (isFreshnessSkipped()) {
    return {ok: true, skipped: true, hasYalcDeps: findYalcDependencies(cwd).length > 0, findings: []}
  }

  const deps = findYalcDependencies(cwd)
  if (deps.length === 0) {
    return {ok: true, skipped: false, hasYalcDeps: false, findings: []}
  }

  const lock = readYalcLock(cwd, lockFilename)
  const findings = []

  // A yalc-linked repo with no committed lock is exactly the ungated state 0013 describes: no
  // git-tracked record of what the link should contain. Fail loud.
  if (!lock) {
    for (const dep of deps) {
      findings.push({package: dep.name, kind: 'no-lock'})
    }
    return {ok: false, skipped: false, hasYalcDeps: true, findings}
  }

  const lockedNames = new Set(Object.keys(lock.packages))

  for (const dep of deps) {
    lockedNames.delete(dep.name)
    const entry = lock.packages[dep.name]
    const hash = hashYalcPackage(dep.dir)

    if (!hash) {
      findings.push({package: dep.name, kind: 'not-installed'})
      continue
    }
    if (!entry) {
      findings.push({package: dep.name, kind: 'missing-lock-entry', actualAggregate: hash.aggregate})
      continue
    }
    if (entry.aggregate !== hash.aggregate) {
      findings.push({
        package: dep.name,
        kind: 'drift',
        expectedAggregate: entry.aggregate,
        actualAggregate: hash.aggregate,
        changedFiles: diffChangedFiles(entry.files ?? {}, hash.files)
      })
      continue
    }
    findings.push({package: dep.name, kind: 'ok'})
  }

  // A lock entry with no matching dependency: the link was removed from package.json but the lock
  // was not regenerated. Regenerate to reconcile.
  for (const name of lockedNames) {
    findings.push({package: name, kind: 'stale-lock-entry'})
  }

  const ok = findings.every((f) => f.kind === 'ok')
  return {ok, skipped: false, hasYalcDeps: true, findings}
}
