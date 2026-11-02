// @vitest-environment node
//
// Self-test of the generated-module build guard (scripts/vite-pnpm-build-only.mjs; atlas decision 0164
// row 1, review of website #429, M1). A build that loads src/lib/composed/value-free.generated.ts or
// shell.generated.ts must fail unless scripts/build-site.mjs marked it as its second pass, the pass
// that runs right after the gates wrote both modules. The modules are reached the way the Worker
// reaches them (an eager `import.meta.glob`) and by a plain import. A build that loads neither module
// passes without the marker, so the failures come from the guard and not from a broken harness.
//
// The builds run on the Vite that Astro itself resolves. tests/build/pnpm-build-only.test.ts runs a
// real `astro build`.
import {mkdirSync, mkdtempSync, rmSync, writeFileSync} from 'node:fs'
import {createRequire} from 'node:module'
import {tmpdir} from 'node:os'
import {dirname, join} from 'node:path'
import {pathToFileURL} from 'node:url'
import {afterAll, beforeAll, describe, expect, it} from 'vitest'
import {BUILD_SITE_PASS, BUILD_SITE_PASS_VARIABLE, GENERATED_MODULES, generatedModule, pnpmBuildOnly} from '../../scripts/vite-pnpm-build-only.mjs'
import astroConfig from '../../astro.config.mjs'

type ViteBuild = (config: Record<string, unknown>) => Promise<unknown>

const SENTINEL = 'pnpm-build-only-sentinel-41c2'
let root: string
let viteBuild: ViteBuild

function write(file: string, content: string): void {
  const full = join(root, file)
  mkdirSync(dirname(full), {recursive: true})
  writeFileSync(full, content)
}

function build(entry: string, env: Record<string, string | undefined>): Promise<unknown> {
  return viteBuild({root, configFile: false, logLevel: 'silent', plugins: [pnpmBuildOnly(env)], build: {write: false, ssr: join(root, entry)}})
}

/** Every emitted chunk's code, so a test can see what the build compiled in. */
function bundledCode(result: unknown): string {
  const outputs = (Array.isArray(result) ? result : [result]) as {output: {code?: string}[]}[]
  return outputs.flatMap((r) => r.output).map((o) => o.code ?? '').join('\n')
}

beforeAll(async () => {
  const astroRequire = createRequire(createRequire(import.meta.url).resolve('astro/package.json'))
  const vite = (await import(pathToFileURL(astroRequire.resolve('vite')).href)) as {build: ViteBuild}
  viteBuild = vite.build

  root = mkdtempSync(join(tmpdir(), 'pnpm-build-only-'))
  for (const module of GENERATED_MODULES) {
    write(module, `export const GENERATED = '${SENTINEL}'\n`)
  }
  // The Worker's own way in (src/lib/composed/compiled-*.ts), and a plain import.
  write('src/lib/composed/compiled-value-free.ts', "export default import.meta.glob('./value-free.generated.ts', {eager: true})\n")
  write('src/lib/composed/compiled-shell.ts', "export default import.meta.glob('./shell.generated.ts', {eager: true})\n")
  write('src/entry-value-free.ts', "import found from './lib/composed/compiled-value-free'\nexport default found\n")
  write('src/entry-shell.ts', "import found from './lib/composed/compiled-shell'\nexport default found\n")
  write('src/entry-direct.ts', "export {GENERATED} from './lib/composed/value-free.generated'\n")
  write('src/entry-clean.ts', "export default 'no generated module here'\n")
})

afterAll(() => {
  if (root) {
    rmSync(root, {recursive: true, force: true})
  }
})

// covers: dashboard-ssr#A hiding or unreadable focus value answers the build's value-free page
describe('pnpm-build-only build guard', () => {
  it.each([
    ['src/entry-value-free.ts', 'src/lib/composed/value-free.generated.ts'],
    ['src/entry-shell.ts', 'src/lib/composed/shell.generated.ts'],
    ['src/entry-direct.ts', 'src/lib/composed/value-free.generated.ts']
  ])('fails %s, which loads %s, without the second-pass marker', async (entry, module) => {
    await expect(build(entry, {})).rejects.toThrow(`pnpm-build-only: this build compiles ${module}, but scripts/build-site.mjs did not start it`)
    await expect(build(entry, {[BUILD_SITE_PASS_VARIABLE]: '1'})).rejects.toThrow('pnpm-build-only')
  })

  it.each(['src/entry-value-free.ts', 'src/entry-shell.ts', 'src/entry-direct.ts'])('compiles %s in the second pass of scripts/build-site.mjs',
    async (entry) => {
      expect(bundledCode(await build(entry, {[BUILD_SITE_PASS_VARIABLE]: BUILD_SITE_PASS}))).toContain(SENTINEL)
    })

  it('passes a build that loads no generated module, marker or not', async () => {
    await expect(build('src/entry-clean.ts', {})).resolves.toBeDefined()
  })

  it('applies to `vite build` only, ahead of the other plugins, so `astro dev` and the test runners keep the modules', () => {
    const plugin = pnpmBuildOnly({}) as {apply?: string; enforce?: string}
    expect(plugin.apply).toBe('build')
    expect(plugin.enforce).toBe('pre')
  })

  it('is registered in the production Astro config', () => {
    const plugins = (astroConfig.vite?.plugins ?? []).flat() as {name?: string}[]
    expect(plugins.map((p) => p?.name)).toContain('pnpm-build-only')
  })

  it('classifies resolved module ids', () => {
    expect(generatedModule('/r/src/lib/composed/value-free.generated.ts')).toBe('src/lib/composed/value-free.generated.ts')
    expect(generatedModule('C:\\r\\src\\lib\\composed\\shell.generated.ts?v=1')).toBe('src/lib/composed/shell.generated.ts')
    expect(generatedModule('/r/src/lib/composed/value-free.ts')).toBeNull()
    expect(generatedModule('/r/src/lib/composed/compiled-shell.ts')).toBeNull()
  })
})
