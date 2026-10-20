// .env.local holds the Cloudflare and Access credentials (atlas decision 0162, X3). Two copiers seed it
// into a new worktree: paseo.json worktree.setup[0] (the Paseo setup) and scripts/worktree-setup.sh
// (run by .husky/post-checkout). Both must create the copy with mode 0600 whatever the source mode is.
// The plain `cp` they replaced keeps the source mode, and every copy was -rw-r--r-- on 2026-10-18.
// Each case runs in a throwaway repository with a linked worktree, under umask 022 (the macOS default).
import {execFileSync, spawnSync} from 'node:child_process'
import {chmodSync, existsSync, mkdirSync, mkdtempSync, readFileSync, rmSync, statSync, writeFileSync} from 'node:fs'
import {tmpdir} from 'node:os'
import path from 'node:path'
import {afterEach, beforeEach, describe, expect, it} from 'vitest'

const PASEO_SETUP: string = JSON.parse(readFileSync('paseo.json', 'utf8')).worktree.setup[0]
const SETUP_SCRIPT = path.resolve('scripts/worktree-setup.sh')
const BODY = 'CLOUDFLARE_ACCOUNT_READALL=not-a-real-token\n'

// Git sees only the scratch repository. Every inherited GIT_* variable goes: a git hook exports
// GIT_DIR, which would point these commands at the real repository (a stray commit, a branch, a
// worktree entry, and a copy of the real .env.local). No global or system config either, so a user
// hook or a signing setting cannot change the result.
const GIT_ENV = {
  ...Object.fromEntries(Object.entries(process.env).filter(([name]) => !name.startsWith('GIT_'))),
  GIT_CONFIG_GLOBAL: '/dev/null',
  GIT_CONFIG_NOSYSTEM: '1',
  GIT_AUTHOR_NAME: 'test',
  GIT_AUTHOR_EMAIL: 'test@example.invalid',
  GIT_COMMITTER_NAME: 'test',
  GIT_COMMITTER_EMAIL: 'test@example.invalid'
}

let scratch = ''
let main = ''
let worktree = ''

beforeEach(() => {
  scratch = mkdtempSync(path.join(tmpdir(), 'worktree-env-'))
  main = path.join(scratch, 'main')
  worktree = path.join(scratch, 'linked')
  mkdirSync(main)
  const git = (...args: string[]) => execFileSync('git', args, {cwd: main, env: GIT_ENV, stdio: 'pipe'})
  git('-c', 'init.defaultBranch=main', 'init', '--quiet')
  writeFileSync(path.join(main, 'README'), 'test\n')
  git('add', 'README')
  git('commit', '--quiet', '-m', 'init')
  git('worktree', 'add', '--quiet', '-b', 'linked', worktree)
})
afterEach(() => rmSync(scratch, {recursive: true, force: true}))

const mainCopy = () => path.join(main, '.env.local')
const worktreeCopy = () => path.join(worktree, '.env.local')
const modeOf = (file: string) => statSync(file).mode & 0o777

function seed(file: string, body: string, mode: number): void {
  writeFileSync(file, body)
  chmodSync(file, mode)
}

/** Runs a shell command in the linked worktree, as both copiers run. */
function sh(command: string, env: Record<string, string> = {}) {
  return spawnSync('sh', ['-c', `umask 022; ${command}`], {cwd: worktree, env: {...GIT_ENV, ...env}, encoding: 'utf8'})
}

describe('paseo.json worktree.setup[0] copies .env.local with mode 0600', () => {
  it('copies a 0644 source to a 0600 copy, byte for byte, and leaves the source in place', () => {
    seed(mainCopy(), BODY, 0o644)
    expect(sh(PASEO_SETUP).status).toBe(0)
    expect(modeOf(worktreeCopy())).toBe(0o600)
    expect(readFileSync(worktreeCopy(), 'utf8')).toBe(BODY)
    expect(modeOf(mainCopy())).toBe(0o644)
  })

  it('narrows a 0644 copy that the post-checkout hook wrote first, as in a real Paseo worktree', () => {
    seed(mainCopy(), BODY, 0o644)
    seed(worktreeCopy(), 'stale\n', 0o644)
    expect(sh(PASEO_SETUP).status).toBe(0)
    expect(modeOf(worktreeCopy())).toBe(0o600)
    expect(readFileSync(worktreeCopy(), 'utf8')).toBe(BODY)
  })

  it('succeeds and writes nothing when the main checkout has no .env.local', () => {
    expect(sh(PASEO_SETUP).status).toBe(0)
    expect(existsSync(worktreeCopy())).toBe(false)
  })

  it('discriminates: the cp it replaced leaves a 0644 copy under the same umask', () => {
    expect(PASEO_SETUP).toContain('install -m 600 "$MAIN/.env.local" .env.local')
    seed(mainCopy(), BODY, 0o644)
    expect(sh(PASEO_SETUP.replace('install -m 600', 'cp')).status).toBe(0)
    expect(modeOf(worktreeCopy())).toBe(0o644)
  })
})

describe('scripts/worktree-setup.sh seeds .env.local with mode 0600', () => {
  it('copies a 0644 source to a 0600 copy, and exits 0 when it starts no install', () => {
    seed(mainCopy(), BODY, 0o644)
    const result = sh(`sh "${SETUP_SCRIPT}"`, {WORKTREE_SKIP_INSTALL: '1'})
    expect(result.status).toBe(0)
    expect(result.stderr).toBe('')
    expect(result.stdout).toContain('seeded .env.local (mode 0600)')
    expect(result.stdout).toContain('done (background tasks PID none)')
    expect(modeOf(worktreeCopy())).toBe(0o600)
    expect(readFileSync(worktreeCopy(), 'utf8')).toBe(BODY)
  })
})
