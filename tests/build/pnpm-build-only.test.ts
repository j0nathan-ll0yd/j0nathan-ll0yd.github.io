// The Worker is built only by `pnpm build` (atlas decision 0164 row 1; review of website #429, M1).
//
// The Worker does not check the value-free pages it serves; the build's gate is their only check, and
// it runs between the two passes of scripts/build-site.mjs. A direct `astro build` would compile
// whatever generated module is on disk, stale or hand-edited. This suite runs one: the global setup's
// `pnpm build` left both generated modules in src/lib/composed/, and an `astro build` without the
// second-pass marker must fail on them (scripts/vite-pnpm-build-only.mjs). It builds into a temporary
// directory, because a failed `astro build` empties its output directory first, and other suites read
// dist/.
import {spawnSync} from 'node:child_process'
import {existsSync, mkdtempSync, readFileSync, rmSync, writeFileSync} from 'node:fs'
import {tmpdir} from 'node:os'
import path from 'node:path'
import {fileURLToPath} from 'node:url'
import {describe, expect, it} from 'vitest'
import {BUILD_SITE_PASS_VARIABLE, GENERATED_MODULES} from '../../scripts/vite-pnpm-build-only.mjs'

const ROOT = fileURLToPath(new URL('../..', import.meta.url))
/** The variables Vitest sets for itself (tests/build/setup.ts): a build that inherits them is a dev build. */
const VITEST_ENV = /^(TEST|VITEST.*|MODE|DEV|PROD|SSR|BASE_URL)$/
/** The pointer the Cloudflare adapter writes at the end of a build; `wrangler dev` follows it. */
const WRANGLER_REDIRECT = path.join(ROOT, '.wrangler/deploy/config.json')

describe('a direct astro build (atlas decision 0164 row 1)', () => {
  // covers: dashboard-ssr#A hiding or unreadable focus value answers the build's value-free page
  it('fails when a generated module is on disk and scripts/build-site.mjs did not start the pass', () => {
    for (const module of GENERATED_MODULES) {
      expect(existsSync(path.join(ROOT, module)), module).toBe(true)
    }
    const env = Object.fromEntries(Object.entries(process.env).filter(([name]) => !VITEST_ENV.test(name) && name !== BUILD_SITE_PASS_VARIABLE))
    const outDir = mkdtempSync(path.join(tmpdir(), 'pnpm-build-only-'))
    const redirect = existsSync(WRANGLER_REDIRECT) ? readFileSync(WRANGLER_REDIRECT, 'utf8') : null
    try {
      const run = spawnSync('pnpm', ['exec', 'astro', 'build', '--outDir', outDir], {cwd: ROOT, env: {...env, NODE_ENV: 'production'}, encoding: 'utf8'})
      expect(run.status).not.toBe(0)
      expect(`${run.stdout}\n${run.stderr}`).toMatch(
        /pnpm-build-only: this build compiles src\/lib\/composed\/(?:shell|value-free)\.generated\.ts, but scripts\/build-site\.mjs did not start it/
      )
    } finally {
      rmSync(outDir, {recursive: true, force: true})
      // A failed build writes no pointer; this keeps a later `wrangler dev` on dist/ if one ever does.
      if (redirect !== null && readFileSync(WRANGLER_REDIRECT, 'utf8') !== redirect) {
        writeFileSync(WRANGLER_REDIRECT, redirect)
      }
    }
  }, 180_000)
})
