#!/usr/bin/env node
// doctor-install.mjs -- cheap install-integrity preflight (atlas decision 0013, Task 3).
//
// yalc churns node_modules aggressively: `yalc add` reinstalls, and npm can shunt a wrapper package
// into `node_modules/.ignored/<pkg>` while leaving `node_modules/.bin/<tool>` a DANGLING symlink
// into the now-empty original location. The platform binary is fine (e.g.
// node_modules/@dprint/darwin-arm64/), but the CLI entrypoint the toolchain calls is broken. This
// surfaced only as a cryptic `sh: dprint: command not found` at pre-push time, after a confusing
// diagnosis -- `npm rebuild dprint` reported success and fixed nothing; a full `npm install` did.
//
// This doctor makes that failure LOUD and EARLY: it verifies the toolchain binaries the hooks and
// CI actually invoke are present and resolvable, and reports the exact fix -- rather than letting
// it detonate as an inscrutable hook failure. Kept cheap (pure fs stat, no spawning) so it can run
// on every push. Exit 0 = healthy, exit 1 = broken (with instructions).

import {existsSync, lstatSync, readlinkSync, statSync} from 'node:fs'
import {dirname, join, resolve} from 'node:path'
import {fileURLToPath} from 'node:url'

const REPO_ROOT = join(dirname(fileURLToPath(import.meta.url)), '..')
const BIN_DIR = join(REPO_ROOT, 'node_modules', '.bin')

// The CLI tools the pre-push hook + CI jobs invoke by bare name. If any of these is a dangling
// `.bin` symlink or missing, a hook/CI step dies with an inscrutable "command not found".
const REQUIRED_BINS = ['dprint', 'eslint', 'astro', 'vitest', 'playwright', 'tsx']

const problems = []

if (!existsSync(join(REPO_ROOT, 'node_modules'))) {
  problems.push('node_modules/ is missing entirely -- dependencies are not installed.')
} else {
  for (const bin of REQUIRED_BINS) {
    const binPath = join(BIN_DIR, bin)
    let linkStat
    try {
      linkStat = lstatSync(binPath) // lstat: inspect the link itself, do not follow it.
    } catch {
      problems.push(`${bin}: node_modules/.bin/${bin} is missing.`)
      continue
    }
    if (linkStat.isSymbolicLink()) {
      // The exact failure mode observed: a `.bin` symlink whose target no longer exists (the
      // wrapper was shunted to node_modules/.ignored/). statSync FOLLOWS the link and throws
      // ENOENT when the target is gone -- that is the dangling-link signal.
      const target = readlinkSync(binPath)
      try {
        statSync(binPath)
      } catch {
        problems.push(`${bin}: node_modules/.bin/${bin} is a BROKEN symlink -> ${target} (target missing).`)
        continue
      }
    } else if (!linkStat.isFile()) {
      problems.push(`${bin}: node_modules/.bin/${bin} exists but is neither a file nor a resolvable symlink.`)
      continue
    }
    // A resolvable file/symlink: also confirm it is executable (mode bit), the other way a bare
    // invocation fails.
    try {
      const resolved = statSync(binPath)
      if (!(resolved.mode & 0o111)) {
        problems.push(`${bin}: node_modules/.bin/${bin} is not executable.`)
      }
    } catch {
      // Already reported above.
    }
  }

  // The specific shunt smell: a package parked under node_modules/.ignored/ is npm telling us it
  // could not place that package normally (the churn that dangles the .bin link). Surface it so the
  // root cause is named, not just the symptom.
  const ignoredDir = join(REPO_ROOT, 'node_modules', '.ignored')
  if (existsSync(ignoredDir)) {
    try {
      const shunted = statSync(ignoredDir).isDirectory()
      if (shunted) {
        problems.push('node_modules/.ignored/ exists -- npm shunted one or more packages aside (the yalc-churn smell that dangles .bin links).')
      }
    } catch {
      // Non-fatal: the presence check above is the signal.
    }
  }
}

if (problems.length === 0) {
  console.log(`[doctor:install] OK: ${REQUIRED_BINS.length} toolchain binaries resolve (${REQUIRED_BINS.join(', ')}).`)
  process.exit(0)
}

console.error('')
console.error('==================================================================')
console.error('  ERROR: install integrity check FAILED.')
console.error('  A toolchain binary is missing or a node_modules/.bin symlink is broken.')
console.error('  This is the yalc-churn failure mode (atlas 0013, Task 3): it otherwise')
console.error('  surfaces as a cryptic "command not found" mid-hook.')
console.error('==================================================================')
for (const p of problems) {
  console.error(`  * ${p}`)
}
console.error('')
console.error('  Fix (verified: a full install repairs it; `npm rebuild <pkg>` does NOT):')
console.error('    npm install --legacy-peer-deps')
console.error('')
console.error(`  Checked under: ${resolve(BIN_DIR)}`)
console.error('')
process.exit(1)
