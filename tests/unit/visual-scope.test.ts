import {spawnSync} from 'node:child_process'
import {mkdirSync, mkdtempSync, rmSync, writeFileSync} from 'node:fs'
import {tmpdir} from 'node:os'
import {dirname, join, resolve} from 'node:path'
import {afterEach, beforeEach, describe, expect, it} from 'vitest'

// Atlas decision 0168 item 16: `.husky/pre-push` runs the Docker visual suite only when a pushed
// commit changes a rendered input against origin/main, and runs it whenever the diff cannot be
// computed. scripts/visual-scope.sh makes that call: exit 0 runs the suite, exit 1 skips it. Each
// case below builds a scratch repository, so the real checkout's refs never decide a result.

const SCRIPT = resolve('scripts/visual-scope.sh')
const ZERO_SHA = '0000000000000000000000000000000000000000'

let repo = ''

function git(...args: string[]): string {
  const result = spawnSync('git', args, {cwd: repo, encoding: 'utf8'})
  if (result.status !== 0) {
    throw new Error(`git ${args.join(' ')} failed: ${result.stderr}`)
  }
  return result.stdout.trim()
}

function commit(path: string, message: string): string {
  const file = join(repo, path)
  mkdirSync(dirname(file), {recursive: true})
  writeFileSync(file, `${message}\n`)
  git('add', path)
  git('commit', '-q', '-m', message)
  return git('rev-parse', 'HEAD')
}

function scope(stdin = ''): {status: number | null; reason: string} {
  const result = spawnSync('sh', [SCRIPT], {cwd: repo, encoding: 'utf8', input: stdin})
  return {status: result.status, reason: result.stdout.trim()}
}

function pushLine(sha: string): string {
  return `refs/heads/feature ${sha} refs/heads/feature ${ZERO_SHA}\n`
}

beforeEach(() => {
  repo = mkdtempSync(join(tmpdir(), 'visual-scope-'))
  git('init', '-q', '-b', 'main')
  git('config', 'user.email', 'test@example.invalid')
  git('config', 'user.name', 'visual-scope test')
  git('config', 'commit.gpgsign', 'false')
  const base = commit('README.md', 'base')
  git('update-ref', 'refs/remotes/origin/main', base)
  git('checkout', '-q', '-b', 'feature')
})

afterEach(() => {
  rmSync(repo, {recursive: true, force: true})
})

describe('visual-scope.sh (decision 0168 item 16)', () => {
  it('skips a push whose diff names no rendered input', () => {
    const sha = commit('docs/notes.md', 'docs only')
    const {status, reason} = scope(pushLine(sha))
    expect(status).toBe(1)
    expect(reason).toMatch(/no pushed commit changes a rendered input/)
  })

  it.each([
    'src/pages/index.astro',
    'public/js/clock.js',
    'tests/visual/helpers.ts',
    'package.json',
    'pnpm-lock.yaml',
    'astro.config.mjs',
    'playwright.config.ts',
    'scripts/build-composer.mjs',
    'tests/data-plane/server.ts',
    'tests/shared/chromium-launch-args.ts',
    'tests/fixtures/composed/kv-focus.json',
    'wrangler.jsonc',
    'tsconfig.json',
    'pnpm-workspace.yaml'
  ])('runs for a change to %s', (path) => {
    const sha = commit(path, 'rendered')
    const {status, reason} = scope(pushLine(sha))
    expect(status).toBe(0)
    expect(reason).toContain(path)
  })

  it('runs when any one of several pushed refs changes a rendered input', () => {
    const docs = commit('docs/notes.md', 'docs only')
    git('checkout', '-q', '-b', 'other', 'origin/main')
    const rendered = commit('src/lib/x.ts', 'rendered')
    git('checkout', '-q', 'feature')
    const {status} = scope(pushLine(docs) + pushLine(rendered))
    expect(status).toBe(0)
  })

  it('judges HEAD when git passes no refs (a manual run)', () => {
    commit('src/lib/x.ts', 'rendered')
    expect(scope('').status).toBe(0)
  })

  it('skips a push that only deletes refs', () => {
    const {status, reason} = scope(`(delete) ${ZERO_SHA} refs/heads/gone ${git('rev-parse', 'HEAD')}\n`)
    expect(status).toBe(1)
    expect(reason).toMatch(/deletes refs only/)
  })

  it('runs when origin/main is missing', () => {
    const sha = commit('docs/notes.md', 'docs only')
    git('update-ref', '-d', 'refs/remotes/origin/main')
    const {status, reason} = scope(pushLine(sha))
    expect(status).toBe(0)
    expect(reason).toMatch(/origin\/main is missing/)
  })

  it('runs when HEAD is detached', () => {
    const sha = commit('docs/notes.md', 'docs only')
    git('checkout', '-q', '--detach')
    const {status, reason} = scope(pushLine(sha))
    expect(status).toBe(0)
    expect(reason).toMatch(/detached/)
  })

  it('runs when the pushed commit shares no history with origin/main', () => {
    git('checkout', '-q', '--orphan', 'unrelated')
    git('rm', '-rq', '--cached', '.')
    const sha = commit('docs/notes.md', 'unrelated docs')
    const {status, reason} = scope(pushLine(sha))
    expect(status).toBe(0)
    expect(reason).toMatch(/cannot diff/)
  })

  it('runs when the pushed sha is unknown', () => {
    const {status, reason} = scope(pushLine('1234567890123456789012345678901234567890'))
    expect(status).toBe(0)
    expect(reason).toMatch(/cannot diff/)
  })
})

// The hook glue: `.husky/pre-push` must skip the suite on an exact exit 1 from the scope and run
// it on any other status, a missing script included. A stub `pnpm` on PATH records each call, and
// a stub scope script exits with the status under test.
describe('.husky/pre-push scope mapping (decision 0168 item 16)', () => {
  const HOOK = resolve('.husky/pre-push')
  let dir = ''

  beforeEach(() => {
    dir = mkdtempSync(join(tmpdir(), 'pre-push-'))
    mkdirSync(join(dir, 'bin'))
    writeFileSync(join(dir, 'bin', 'pnpm'), '#!/bin/sh\necho "$*" >> "$PNPM_LOG"\n', {mode: 0o755})
  })

  afterEach(() => {
    rmSync(dir, {recursive: true, force: true})
  })

  function hook(scopeStatus: number | 'missing', env: Record<string, string> = {}): {status: number | null; calls: string[]; stdout: string} {
    if (scopeStatus !== 'missing') {
      mkdirSync(join(dir, 'scripts'), {recursive: true})
      writeFileSync(join(dir, 'scripts', 'visual-scope.sh'), `echo "stub reason"\nexit ${scopeStatus}\n`)
    }
    const log = join(dir, 'pnpm.log')
    const result = spawnSync('sh', ['-e', HOOK], {
      cwd: dir,
      encoding: 'utf8',
      input: pushLine('1234567890123456789012345678901234567890'),
      env: {...process.env, ...env, PATH: `${join(dir, 'bin')}:${process.env.PATH ?? ''}`, PNPM_LOG: log, SKIP_VISUAL: env.SKIP_VISUAL ?? ''}
    })
    const calls = spawnSync('cat', [log], {encoding: 'utf8'}).stdout.split('\n').filter(Boolean)
    return {status: result.status, calls, stdout: result.stdout}
  }

  it('skips the suite on exit 1 and keeps the static gates', () => {
    const {status, calls, stdout} = hook(1)
    expect(status).toBe(0)
    expect(calls).toEqual(['run doctor:install', 'run format:check', 'run typecheck', 'run lint'])
    expect(stdout).toContain('Visual suite skipped: stub reason')
  })

  it.each([0, 2, 127, 130])('runs the suite when the scope exits %i', (scopeStatus) => {
    const {status, calls} = hook(scopeStatus)
    expect(status).toBe(0)
    expect(calls.at(-1)).toBe('run test:visual')
  })

  it('runs the suite when the scope script is missing', () => {
    const {calls, stdout} = hook('missing')
    expect(calls.at(-1)).toBe('run test:visual')
    expect(stdout).toMatch(/exited 127, so the suite runs \(fail closed\)/)
  })

  it('honors SKIP_VISUAL=1 before the scope runs', () => {
    const {calls} = hook(0, {SKIP_VISUAL: '1'})
    expect(calls).not.toContain('run test:visual')
  })
})
