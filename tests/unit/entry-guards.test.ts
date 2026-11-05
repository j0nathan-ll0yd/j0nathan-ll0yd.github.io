// @vitest-environment node
//
// The three security and merge gates run their check only when node runs them (review of website
// #429, I3 and N1): check-deploy-vars (deploy.yml, right before `wrangler deploy`), check-no-clear-email
// (postbuild) and openspec-covers (the blocking covers gate). Each one is started here through a
// symlinked path with a space in it, on a known-bad input, and must exit non-zero. The plain entry
// checks they used before are false through that path, so the gate exited 0 having checked nothing.
// A clean input must print the gate's OK line, so a pass is a check that ran. The audit runners take
// the same path: `isMain` in audits/lib/http.mjs, and the spec runners that kept their own copy.
// The lint rule in eslint.config.mjs keeps a plain entry check from coming back.
import {spawnSync} from 'node:child_process'
import {copyFileSync, mkdirSync, mkdtempSync, realpathSync, rmSync, symlinkSync, writeFileSync} from 'node:fs'
import {tmpdir} from 'node:os'
import {join} from 'node:path'
import {fileURLToPath, pathToFileURL} from 'node:url'
import {ESLint} from 'eslint'
import {afterAll, beforeAll, describe, expect, it} from 'vitest'

const REPO = realpathSync(fileURLToPath(new URL('../..', import.meta.url)))
const FORBIDDEN = ['DATA_PLANE_BASE', 'SSR_FAULT_INJECTION']
let dir: string
/** The repository's scripts/ directory, reached through a symlink whose name needs encoding. */
let linkedScripts: string
/** The repository's audits/ directory, reached the same way. */
let linkedAudits: string

/** The environment without the deploy variables the gate reads, so only the fixture decides. */
function cleanEnv() {
  const env = {...process.env}
  for (const name of FORBIDDEN) {
    delete env[name]
  }
  return env
}

function run(script: string, args: string[], cwd: string) {
  return spawnSync(process.execPath, [script, ...args], {cwd, encoding: 'utf8', env: cleanEnv()})
}

/** A working directory holding `files` (relative path to contents). */
function workdir(name: string, files: Record<string, string>) {
  const root = join(dir, name)
  for (const [relative, contents] of Object.entries(files)) {
    mkdirSync(join(root, relative, '..'), {recursive: true})
    writeFileSync(join(root, relative), contents)
  }
  return root
}

/**
 * A copy of the repository's covers gate in a fixture repository holding `spec`, reached through a
 * symlink. The gate scans the repository it sits in, so it is copied, not linked; node_modules is
 * linked, and the scan ignores it.
 */
function coversFixture(name: string, spec: string) {
  const root = join(dir, `${name} repo`)
  mkdirSync(join(root, 'scripts', 'lib'), {recursive: true})
  copyFileSync(join(REPO, 'scripts', 'openspec-covers.mjs'), join(root, 'scripts', 'openspec-covers.mjs'))
  copyFileSync(join(REPO, 'scripts', 'lib', 'main-module.mjs'), join(root, 'scripts', 'lib', 'main-module.mjs'))
  symlinkSync(join(REPO, 'node_modules'), join(root, 'node_modules'))
  mkdirSync(join(root, 'openspec', 'specs', 'demo'), {recursive: true})
  writeFileSync(join(root, 'openspec', 'specs', 'demo', 'spec.md'), spec)
  const linked = join(dir, `${name} link`)
  symlinkSync(root, linked)
  return {root, script: join(linked, 'scripts', 'openspec-covers.mjs')}
}

beforeAll(() => {
  dir = realpathSync(mkdtempSync(join(tmpdir(), 'entry-guards-')))
  linkedScripts = join(dir, 'linked scripts')
  symlinkSync(join(REPO, 'scripts'), linkedScripts)
  linkedAudits = join(dir, 'linked audits')
  symlinkSync(join(REPO, 'audits'), linkedAudits)
})

afterAll(() => {
  if (dir) {
    rmSync(dir, {recursive: true, force: true})
  }
})

describe('check-deploy-vars through a symlinked path', () => {
  it('fails a Worker config that sets DATA_PLANE_BASE', () => {
    const cwd = workdir('deploy-bad', {'dist/server/wrangler.json': JSON.stringify({vars: {DATA_PLANE_BASE: 'http://127.0.0.1:1'}})})
    const result = run(join(linkedScripts, 'check-deploy-vars.mjs'), [], cwd)
    expect(result.status).toBe(1)
    expect(result.stderr).toContain('production must not set: DATA_PLANE_BASE (wrangler.json vars)')
  })

  it('passes a clean Worker config with its OK line', () => {
    const cwd = workdir('deploy-good', {'dist/server/wrangler.json': JSON.stringify({vars: {}})})
    const result = run(join(linkedScripts, 'check-deploy-vars.mjs'), [], cwd)
    expect(result.status).toBe(0)
    expect(result.stdout).toContain('[check-deploy-vars] OK')
  })
})

describe('check-no-clear-email through a symlinked path', () => {
  it('fails built HTML that carries an address in clear', () => {
    const cwd = workdir('email-bad', {'dist/client/index.html': '<!doctype html><p>Write to someone@example.com</p>'})
    const result = run(join(linkedScripts, 'check-no-clear-email.mjs'), [], cwd)
    expect(result.status).toBe(1)
    expect(result.stderr).toContain('built HTML carries an email address in clear')
  })

  it('passes clean built HTML with its OK line', () => {
    const cwd = workdir('email-good', {'dist/client/index.html': '<!doctype html><p>No address here</p>'})
    const result = run(join(linkedScripts, 'check-no-clear-email.mjs'), [], cwd)
    expect(result.status).toBe(0)
    expect(result.stdout).toContain('[check-no-clear-email] OK: no clear email address in 1 HTML file(s)')
  })
})

describe('openspec-covers --blocking through a symlinked path', () => {
  it('fails a requirement that no test covers', () => {
    const {root, script} = coversFixture('covers-bad', [
      '# Demo',
      '',
      '### Requirement: A gate runs its check',
      '',
      '#### Scenario: Started through a symlink',
      '',
      '- GIVEN a known-bad input',
      '- WHEN node runs the gate through a symlinked path',
      '- THEN the gate exits non-zero',
      ''
    ].join('\n'))
    const result = run(script, ['--blocking'], root)
    expect(result.status).toBe(1)
    expect(result.stdout).toContain('FAIL: 1 covers-conformance finding(s).')
  })

  it('passes a spec tree with no requirement with its OK line', () => {
    const {root, script} = coversFixture('covers-good', '# Demo\n')
    const result = run(script, ['--blocking'], root)
    expect(result.status).toBe(0)
    expect(result.stdout).toContain('OK: every requirement has a covering test')
  })
})

describe('the audit runners through a symlinked path', () => {
  it('run their main block through isMain in audits/lib/http.mjs', () => {
    const http = pathToFileURL(join(REPO, 'audits', 'lib', 'http.mjs')).href
    const cwd = workdir('audit-runner', {
      'runner.mjs': `import {isMain} from ${JSON.stringify(http)}\nif (isMain(import.meta.url)) {\n  console.log('checked')\n}\n`
    })
    symlinkSync(cwd, join(dir, 'audit-runner link'))
    const result = run(join(dir, 'audit-runner link', 'runner.mjs'), [], cwd)
    expect(result.status).toBe(0)
    expect(result.stdout.trim()).toBe('checked')
  })

  it('run a spec runner that kept its own entry check before', () => {
    // The verdict belongs to the rule tree, which audit:spec-integrity gates; the header proves main ran.
    const result = run(join(linkedAudits, 'checks', 'b2-check-spec-verification.mjs'), [], REPO)
    expect([0, 1]).toContain(result.status)
    expect(result.stdout).toContain('=== check-spec-verification ===')
  })
})

describe('the entry-check lint rule', () => {
  const eslint = new ESLint({cwd: REPO})
  async function restricted(filePath: string, code: string) {
    const [result] = await eslint.lintText(code, {filePath: join(REPO, filePath)})
    return result.messages.filter((message) => message.ruleId === 'no-restricted-syntax').map((message) => message.message)
  }

  it('rejects a plain entry check in a script, an audit runner and a source module', async () => {
    const plain = [
      'if (import.meta.url === `file://${process.argv[1]}`) {\n  console.log(1)\n}\n',
      'export const entry = process.argv.at(1)\n'
    ]
    // A .ts path must be in the typed project, so it names a real module; only the text is linted.
    for (const filePath of ['scripts/probe.mjs', 'audits/checks/probe.mjs', 'src/worker.ts']) {
      for (const code of plain) {
        expect(await restricted(filePath, code), `${filePath}: ${code}`).toEqual([
          'Read the entry path through isMainModule(import.meta.url) from scripts/lib/main-module.mjs.'
        ])
      }
    }
  })

  it('allows the helper itself and the helper call', async () => {
    expect(await restricted('scripts/lib/main-module.mjs', 'export const entry = process.argv[1]\n')).toEqual([])
    const call = "import {isMainModule} from './lib/main-module.mjs'\nif (isMainModule(import.meta.url)) {\n  console.log(1)\n}\n"
    expect(await restricted('scripts/probe.mjs', call)).toEqual([])
  })
})
