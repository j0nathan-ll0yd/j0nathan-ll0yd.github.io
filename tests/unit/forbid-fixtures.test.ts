// @vitest-environment node
//
// Self-test of the production build guard (scripts/vite-forbid-fixtures.mjs; atlas decision 0160,
// plan Step 6.7). The guard must be able to FAIL: a temporary module that imports
// @j0nathan-ll0yd/fixtures through an intermediate module, or through an intermediate package, must
// fail the build, in a client build and in a server build alike. A clean entry must still build, so
// the failures come from the guard and not from a broken harness.
//
// The builds run on the Vite that Astro itself resolves, so the test exercises the same bundler the
// production build uses.
import {spawnSync} from 'node:child_process'
import {mkdirSync, mkdtempSync, rmSync, writeFileSync} from 'node:fs'
import {createRequire} from 'node:module'
import {tmpdir} from 'node:os'
import {dirname, join, resolve} from 'node:path'
import {pathToFileURL} from 'node:url'
import {afterAll, beforeAll, describe, expect, it} from 'vitest'
import {forbidFixtures, isFixturesModule, isFixturesSpecifier} from '../../scripts/vite-forbid-fixtures.mjs'
import astroConfig from '../../astro.config.mjs'

type ViteBuild = (config: Record<string, unknown>) => Promise<unknown>

const SENTINEL = 'forbid-fixtures-sentinel-7f3a'
let root: string
let viteBuild: ViteBuild

function write(path: string, content: string): void {
  const full = join(root, path)
  mkdirSync(dirname(full), {recursive: true})
  writeFileSync(full, content)
}

function packageJson(name: string): string {
  return JSON.stringify({name, version: '0.0.0', type: 'module', exports: {'.': './index.js', './generated/*': './generated/*'}})
}

function build(entry: string, target: 'client' | 'server', plugins: unknown[] = [forbidFixtures()]): Promise<unknown> {
  const input = join(root, entry)
  return viteBuild({
    root,
    configFile: false,
    logLevel: 'silent',
    plugins,
    build: {write: false, ssr: target === 'server' ? input : false, rollupOptions: target === 'server' ? {} : {input}}
  })
}

/** Every emitted chunk's code, so a test can see whether the sentinel was bundled or left external. */
function bundledCode(result: unknown): string {
  const outputs = (Array.isArray(result) ? result : [result]) as {output: {type: string; code?: string}[]}[]
  return outputs.flatMap((r) => r.output).map((o) => o.code ?? '').join('\n')
}

beforeAll(async () => {
  const astroRequire = createRequire(createRequire(import.meta.url).resolve('astro/package.json'))
  const vite = (await import(pathToFileURL(astroRequire.resolve('vite')).href)) as {build: ViteBuild}
  viteBuild = vite.build

  root = mkdtempSync(join(tmpdir(), 'forbid-fixtures-'))
  // A stand-in for the fixtures package, a first-party package that re-exports it, and one that
  // reaches into it by relative path (no bare specifier for resolveId to see).
  write('node_modules/@j0nathan-ll0yd/fixtures/package.json', packageJson('@j0nathan-ll0yd/fixtures'))
  write('node_modules/@j0nathan-ll0yd/fixtures/index.js', `export const SENTINEL = '${SENTINEL}'\n`)
  write('node_modules/@j0nathan-ll0yd/fixtures/generated/health/baseline.json', `{"sentinel": "${SENTINEL}"}\n`)
  write('node_modules/@j0nathan-ll0yd/intermediate/package.json', packageJson('@j0nathan-ll0yd/intermediate'))
  write('node_modules/@j0nathan-ll0yd/intermediate/index.js', "export {SENTINEL} from '@j0nathan-ll0yd/fixtures'\n")
  write('node_modules/@j0nathan-ll0yd/sideways/package.json', packageJson('@j0nathan-ll0yd/sideways'))
  write('node_modules/@j0nathan-ll0yd/sideways/index.js', "export {SENTINEL} from '../fixtures/index.js'\n")

  write('src/intermediate.js', "export {SENTINEL} from '@j0nathan-ll0yd/fixtures'\n")
  write('src/entry-module.js', "import {SENTINEL} from './intermediate.js'\nglobalThis.sentinel = SENTINEL\nexport default SENTINEL\n")
  write('src/entry-package.js', "import {SENTINEL} from '@j0nathan-ll0yd/intermediate'\nexport default SENTINEL\n")
  write('src/entry-sideways.js', "import {SENTINEL} from '@j0nathan-ll0yd/sideways'\nexport default SENTINEL\n")
  write('src/entry-json.js', "import data from '@j0nathan-ll0yd/fixtures/generated/health/baseline.json'\nexport default data\n")
  write('src/entry-clean.js', "export default 'no fixtures here'\n")
})

afterAll(() => {
  if (root) {
    rmSync(root, {recursive: true, force: true})
  }
})

// covers: dashboard-shell#The production build cannot reach the fixtures package
describe('forbid-fixtures build guard', () => {
  describe.each(['client', 'server'] as const)('%s build', (target) => {
    it('fails when a module imports fixtures through an intermediate module', async () => {
      await expect(build('src/entry-module.js', target)).rejects.toThrow(/forbid-fixtures: the production build reached @j0nathan-ll0yd\/fixtures/)
    })

    it('fails when a module imports fixtures through an intermediate first-party package', async () => {
      await expect(build('src/entry-package.js', target)).rejects.toThrow(/forbid-fixtures/)
    })

    it('fails when a package reaches the fixtures files by relative path', async () => {
      await expect(build('src/entry-sideways.js', target)).rejects.toThrow(/forbid-fixtures/)
    })

    it('fails on a generated fixture JSON subpath', async () => {
      await expect(build('src/entry-json.js', target)).rejects.toThrow(/forbid-fixtures/)
    })

    it('builds a module graph that never reaches fixtures', async () => {
      await expect(build('src/entry-clean.js', target)).resolves.toBeDefined()
    })
  })

  it('without the guard the transitive imports build silently (the guard is the only thing that fails them)', async () => {
    // Client: the fixture value is bundled into the shipped chunk.
    expect(bundledCode(await build('src/entry-module.js', 'client', []))).toContain(SENTINEL)
    // Server: the intermediate package is externalized, so nothing the build reads names fixtures.
    const server = bundledCode(await build('src/entry-package.js', 'server', []))
    expect(server).toContain('@j0nathan-ll0yd/intermediate')
    expect(server).not.toContain(SENTINEL)
  })

  it('is registered in the production Astro config', () => {
    const plugins = (astroConfig.vite?.plugins ?? []).flat() as {name?: string}[]
    expect(plugins.map((p) => p?.name)).toContain('forbid-fixtures')
  })

  it('classifies specifiers and resolved paths', () => {
    expect(isFixturesSpecifier('@j0nathan-ll0yd/fixtures')).toBe(true)
    expect(isFixturesSpecifier('@j0nathan-ll0yd/fixtures/generated/focus/dnd.json')).toBe(true)
    expect(isFixturesSpecifier('@j0nathan-ll0yd/fixtures-extra')).toBe(false)
    expect(isFixturesSpecifier('@j0nathan-ll0yd/web')).toBe(false)
    expect(isFixturesModule('/r/node_modules/.pnpm/@j0nathan-ll0yd+fixtures@1.5.0/node_modules/@j0nathan-ll0yd/fixtures/dist/index.js')).toBe(true)
    expect(isFixturesModule('C:\\r\\node_modules\\@j0nathan-ll0yd\\fixtures\\index.js?import')).toBe(true)
    expect(isFixturesModule('/r/node_modules/@j0nathan-ll0yd/web/src/index.ts')).toBe(false)
  })
})

// The source half: scripts/audit-fixtures.mjs (prebuild) refuses a DIRECT import in shipped code.
describe('audit-fixtures source check', () => {
  const script = resolve(process.cwd(), 'scripts/audit-fixtures.mjs')

  function audit(files: Record<string, string>): {status: number | null; stderr: string} {
    const dir = mkdtempSync(join(tmpdir(), 'audit-fixtures-'))
    try {
      for (const [path, content] of Object.entries(files)) {
        mkdirSync(dirname(join(dir, path)), {recursive: true})
        writeFileSync(join(dir, path), content)
      }
      const run = spawnSync(process.execPath, [script], {cwd: dir, encoding: 'utf8'})
      return {status: run.status, stderr: run.stderr}
    } finally {
      rmSync(dir, {recursive: true, force: true})
    }
  }

  it.each([
    ['src/lib/a.ts', "import {getDashboardFixture} from '@j0nathan-ll0yd/fixtures'\n"],
    ['src/pages/b.astro', '---\nimport data from "@j0nathan-ll0yd/fixtures/generated/health/baseline.json"\n---\n'],
    ['src/lib/c.ts', "const m = await import('@j0nathan-ll0yd/fixtures')\n"],
    ['functions/d.ts', "export * from '@j0nathan-ll0yd/fixtures'\n"]
  ])('fails on a direct import in %s', (path, content) => {
    const run = audit({[path]: content})
    expect(run.status).toBe(1)
    expect(run.stderr).toContain(path)
  })

  it('passes shipped code that only names the package in prose', () => {
    expect(audit({'src/lib/a.ts': '// `@j0nathan-ll0yd/fixtures` is a devDependency for tests only.\nexport const x = 1\n'}).status).toBe(0)
  })
})
