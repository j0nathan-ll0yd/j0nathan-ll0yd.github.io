import {afterEach, beforeEach, describe, expect, it} from 'vitest'
import {mkdirSync, mkdtempSync, rmSync, writeFileSync} from 'node:fs'
import {tmpdir} from 'node:os'
import {join} from 'node:path'
import {
  assessYalcFreshness,
  computeYalcLock,
  findYalcDependencies,
  hashYalcPackage,
  serializeYalcLock,
  YALC_FRESHNESS_SKIP_ENV,
  YALC_LOCK_FILENAME
} from '../../scripts/lib/yalc-freshness.mjs'

// Unit tests for the framework-agnostic freshness core (atlas decision 0013).
// Everything runs against throwaway temp repos -- no real .yalc, no network.

let repo: string

/** Write a package.json with the given file:.yalc/* deps into the temp repo. */
function writePackageJson(deps: Record<string, string>): void {
  writeFileSync(join(repo, 'package.json'), JSON.stringify({name: 'fixture', dependencies: deps}, null, 2))
}

/** Install a fake linked package under .yalc with the given files, returning nothing. */
function installLink(name: string, files: Record<string, string>, version = '1.0.0'): void {
  const dir = join(repo, '.yalc', name)
  mkdirSync(dir, {recursive: true})
  writeFileSync(join(dir, 'package.json'), JSON.stringify({name, version}))
  writeFileSync(join(dir, 'yalc.sig'), 'deadbeef') // metadata -- must be excluded from the hash
  for (const [rel, content] of Object.entries(files)) {
    const abs = join(dir, rel)
    mkdirSync(join(abs, '..'), {recursive: true})
    writeFileSync(abs, content)
  }
}

/** Generate + write a lock from the current temp-repo state (the "fresh" baseline). */
function writeLock(): void {
  writeFileSync(join(repo, YALC_LOCK_FILENAME), serializeYalcLock(computeYalcLock(repo)))
}

beforeEach(() => {
  repo = mkdtempSync(join(tmpdir(), 'yalc-fresh-'))
  delete process.env[YALC_FRESHNESS_SKIP_ENV]
})

afterEach(() => {
  rmSync(repo, {recursive: true, force: true})
  delete process.env[YALC_FRESHNESS_SKIP_ENV]
})

describe('findYalcDependencies', () => {
  it('finds only file:.yalc/* specifiers, sorted, and ignores other file: paths', () => {
    writePackageJson({
      '@lifegames/copy': 'file:.yalc/@lifegames/copy',
      '@lifegames/web': 'file:.yalc/@lifegames/web',
      'some-local': 'file:../some-local', // not under .yalc -- excluded
      astro: '^7.1.3' // registry dep -- excluded
    })
    const deps = findYalcDependencies(repo)
    expect(deps.map((d) => d.name)).toEqual(['@lifegames/copy', '@lifegames/web'])
  })

  it('returns [] for a missing or malformed package.json', () => {
    expect(findYalcDependencies(repo)).toEqual([])
    writeFileSync(join(repo, 'package.json'), '{ not valid json')
    expect(findYalcDependencies(repo)).toEqual([])
  })
})

describe('hashYalcPackage', () => {
  it('returns null for an absent directory (fail-loud, never bless nothing)', () => {
    expect(hashYalcPackage(join(repo, '.yalc', 'nope'))).toBeNull()
  })

  it('returns null for a directory that ships no non-metadata files', () => {
    const dir = join(repo, '.yalc', 'empty')
    mkdirSync(dir, {recursive: true})
    writeFileSync(join(dir, 'yalc.sig'), 'sig') // only metadata -> still "empty"
    expect(hashYalcPackage(dir)).toBeNull()
  })

  it('is stable and excludes yalc.sig from the aggregate', () => {
    installLink('@x/pkg', {'dist/a.js': 'hello'})
    const dir = join(repo, '.yalc', '@x/pkg')
    const first = hashYalcPackage(dir)
    const second = hashYalcPackage(dir)
    expect(first).not.toBeNull()
    expect(first!.aggregate).toEqual(second!.aggregate)
    // Changing yalc.sig must not change the hash (it is metadata, not shipped code).
    writeFileSync(join(dir, 'yalc.sig'), 'different-sig')
    expect(hashYalcPackage(dir)!.aggregate).toEqual(first!.aggregate)
  })
})

describe('assessYalcFreshness', () => {
  it('passes when disk matches the committed lock (ok)', () => {
    writePackageJson({'@x/pkg': 'file:.yalc/@x/pkg'})
    installLink('@x/pkg', {'dist/a.js': 'v1'})
    writeLock()
    const result = assessYalcFreshness(repo)
    expect(result.ok).toBe(true)
    expect(result.findings.map((f) => f.kind)).toEqual(['ok'])
  })

  it('fails on drift and names the changed file', () => {
    writePackageJson({'@x/pkg': 'file:.yalc/@x/pkg'})
    installLink('@x/pkg', {'dist/a.js': 'v1'})
    writeLock()
    // Simulate an upstream change the checkout missed / an unlocked local bump.
    writeFileSync(join(repo, '.yalc', '@x/pkg', 'dist', 'a.js'), 'v2')
    const result = assessYalcFreshness(repo)
    expect(result.ok).toBe(false)
    const drift = result.findings.find((f) => f.kind === 'drift')
    expect(drift).toBeDefined()
    expect(drift!.changedFiles).toEqual(['dist/a.js'])
    expect(drift!.expectedAggregate).not.toEqual(drift!.actualAggregate)
  })

  it('fails with no-lock when the lock file is absent', () => {
    writePackageJson({'@x/pkg': 'file:.yalc/@x/pkg'})
    installLink('@x/pkg', {'dist/a.js': 'v1'})
    const result = assessYalcFreshness(repo)
    expect(result.ok).toBe(false)
    expect(result.findings.every((f) => f.kind === 'no-lock')).toBe(true)
  })

  it('fails with not-installed when a locked dep has no content on disk', () => {
    writePackageJson({'@x/pkg': 'file:.yalc/@x/pkg'})
    installLink('@x/pkg', {'dist/a.js': 'v1'})
    writeLock()
    // Remove the on-disk content but keep the dep declared + locked.
    rmSync(join(repo, '.yalc', '@x/pkg'), {recursive: true, force: true})
    const result = assessYalcFreshness(repo)
    expect(result.findings.map((f) => f.kind)).toEqual(['not-installed'])
    expect(result.ok).toBe(false)
  })

  it('fails with missing-lock-entry when a linked package is absent from the lock', () => {
    writePackageJson({'@x/pkg': 'file:.yalc/@x/pkg'})
    installLink('@x/pkg', {'dist/a.js': 'v1'})
    writeLock()
    // Add a second link that the lock does not know about.
    writePackageJson({'@x/pkg': 'file:.yalc/@x/pkg', '@x/pkg2': 'file:.yalc/@x/pkg2'})
    installLink('@x/pkg2', {'dist/b.js': 'v1'})
    const result = assessYalcFreshness(repo)
    expect(result.findings.find((f) => f.package === '@x/pkg2')!.kind).toBe('missing-lock-entry')
    expect(result.ok).toBe(false)
  })

  it('fails with stale-lock-entry when the lock records an unlinked package', () => {
    writePackageJson({'@x/pkg': 'file:.yalc/@x/pkg', '@x/gone': 'file:.yalc/@x/gone'})
    installLink('@x/pkg', {'dist/a.js': 'v1'})
    installLink('@x/gone', {'dist/c.js': 'v1'})
    writeLock()
    // Remove @x/gone from package.json -- the lock still carries it.
    writePackageJson({'@x/pkg': 'file:.yalc/@x/pkg'})
    const result = assessYalcFreshness(repo)
    expect(result.findings.find((f) => f.package === '@x/gone')!.kind).toBe('stale-lock-entry')
    expect(result.ok).toBe(false)
  })

  it('reports no yalc deps as trivially ok (nothing to gate)', () => {
    writePackageJson({astro: '^7.1.3'})
    const result = assessYalcFreshness(repo)
    expect(result).toMatchObject({ok: true, hasYalcDeps: false})
  })

  it('honours the loud skip escape hatch (never a silent default)', () => {
    writePackageJson({'@x/pkg': 'file:.yalc/@x/pkg'})
    installLink('@x/pkg', {'dist/a.js': 'v1'})
    // No lock at all -> would normally fail; skip env forces a pass but flags skipped.
    process.env[YALC_FRESHNESS_SKIP_ENV] = '1'
    const result = assessYalcFreshness(repo)
    expect(result).toMatchObject({ok: true, skipped: true})
  })
})
