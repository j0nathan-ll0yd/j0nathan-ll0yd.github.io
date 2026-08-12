#!/usr/bin/env node
// doctor-install.mjs -- cheap install-integrity preflight.
//
// An install churn can leave `node_modules/.bin/<tool>` a DANGLING symlink into a location that no
// longer holds the package. The platform binary is fine (e.g. node_modules/@dprint/darwin-arm64/),
// but the CLI entrypoint the toolchain calls is broken. This surfaces only as a cryptic
// `sh: dprint: command not found` at pre-push time, after a confusing diagnosis -- a targeted
// rebuild reports success and fixes nothing; a full reinstall does.
//
// The originally-observed shape was npm-specific (peer-dep shunting under npm's legacy peer
// resolution parked a wrapper in `node_modules/.ignored/`). Under pnpm (atlas decision 0032) the failure CLASS is if
// anything more likely, not less: every `.bin` entry is a symlink into the content-addressed
// `node_modules/.pnpm/` store, so a pruned/partial store, a half-finished install, or a
// cross-platform clobber (the Docker visual harness writing Linux binaries over a darwin tree)
// leaves exactly this dangling-link signature. The checks below are linker-agnostic -- they assert
// the binaries resolve and are executable, whatever produced them.
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

  // pnpm links every dependency out of the content-addressed node_modules/.pnpm/ store. If that
  // store is missing while node_modules/ exists, the tree is a husk: `.bin` links may still resolve
  // by luck but imports will fail. Name the root cause rather than leaving a symptom.
  if (!existsSync(join(REPO_ROOT, 'node_modules', '.pnpm'))) {
    problems.push('node_modules/.pnpm/ is missing -- node_modules/ was not produced by pnpm (or the store was removed).')
  }

  // The npm-era shunt smell, kept as a cheap tripwire: a package parked under
  // node_modules/.ignored/ means an `npm install` ran in this pnpm project and could not place a
  // package normally -- the churn that dangles .bin links. Under decision 0032 npm must not be used
  // here at all, so its presence is itself the finding.
  const ignoredDir = join(REPO_ROOT, 'node_modules', '.ignored')
  if (existsSync(ignoredDir)) {
    try {
      const shunted = statSync(ignoredDir).isDirectory()
      if (shunted) {
        problems.push(
          'node_modules/.ignored/ exists -- an npm install ran in this pnpm project and shunted packages aside (the install-churn smell that dangles .bin links).'
        )
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
console.error('  This is an install-churn failure mode: it otherwise surfaces as a')
console.error('  cryptic "command not found" mid-hook.')
console.error('==================================================================')
for (const p of problems) {
  console.error(`  * ${p}`)
}
console.error('')
console.error('  Fix (a full install repairs it; a targeted rebuild of the single package does NOT):')
console.error('    pnpm install --frozen-lockfile')
console.error('  If that still leaves a broken link, discard the tree and re-link from the store:')
console.error('    rm -rf node_modules && pnpm install --frozen-lockfile')
console.error('')
console.error(`  Checked under: ${resolve(BIN_DIR)}`)
console.error('')
process.exit(1)
