#!/usr/bin/env node
/* `pnpm build` (atlas decision 0164, Variant D): `astro build` twice around the two modules the Worker
 * compiles in.
 *
 * The Worker compiles in the cut of the data-free page (src/lib/composed/compiled-shell.ts), but the
 * page exists only after `astro build` has bundled the Worker. So: build, cut the page into
 * src/lib/composed/shell.generated.ts (scripts/build-shell.mjs), build again so the Worker bundle
 * holds that cut, then check that the second build shipped the same page and that the Worker
 * bundle holds its cut (`--check`). The page does not depend on the Worker bundle; the check fails
 * the build if that ever stops being true. Measured 2026-10-23: one `astro build` takes 5.5 s.
 *
 * Between the passes it also builds the composer (scripts/build-composer.mjs) and writes the
 * value-free pages, checked by the Worker's own allowlist, into src/lib/composed/value-free.generated.ts
 * (scripts/build-value-free.mjs, atlas decision 0164 row 1); its `--check` runs after the second pass.
 * The postbuild step ships the composer built here.
 *
 * Only the second pass compiles the generated modules in: it alone carries BUILD_SITE_PASS_VARIABLE,
 * and the `pnpm-build-only` Vite plugin (scripts/vite-pnpm-build-only.mjs) fails any other build that
 * loads them, so a direct `astro build` never compiles a module no gate checked.
 *
 * Arguments go to both `astro build` runs (deploy.yml passes `--json`). */
import {execFileSync} from 'node:child_process'
import {rmSync} from 'node:fs'
import {fileURLToPath} from 'node:url'
import {BUILD_SITE_PASS, BUILD_SITE_PASS_VARIABLE, GENERATED_MODULES} from './vite-pnpm-build-only.mjs'

const ROOT = fileURLToPath(new URL('..', import.meta.url))
const SHELL_SCRIPT = fileURLToPath(new URL('./build-shell.mjs', import.meta.url))
const COMPOSER_SCRIPT = fileURLToPath(new URL('./build-composer.mjs', import.meta.url))
const VALUE_FREE_SCRIPT = fileURLToPath(new URL('./build-value-free.mjs', import.meta.url))
const args = process.argv.slice(2)
// No step inherits the marker; only the second `astro build` gets it.
const ENV = {...process.env}
delete ENV[BUILD_SITE_PASS_VARIABLE]
const run = (command, commandArgs, env = ENV) => execFileSync(command, commandArgs, {stdio: 'inherit', cwd: ROOT, env})

// The modules the Worker compiles in come from this build only. A module an earlier build left behind
// (every local build id is `dev`) would otherwise reach the first pass, and stay if a gate below fails.
for (const generated of GENERATED_MODULES) {
  rmSync(fileURLToPath(new URL(`../${generated}`, import.meta.url)), {force: true})
}

run('pnpm', ['exec', 'astro', 'build', ...args])
run('pnpm', ['exec', 'tsx', SHELL_SCRIPT])
run('node', [COMPOSER_SCRIPT])
run('pnpm', ['exec', 'tsx', VALUE_FREE_SCRIPT])
run('pnpm', ['exec', 'astro', 'build', ...args], {...ENV, [BUILD_SITE_PASS_VARIABLE]: BUILD_SITE_PASS})
run('pnpm', ['exec', 'tsx', SHELL_SCRIPT, '--check'])
run('pnpm', ['exec', 'tsx', VALUE_FREE_SCRIPT, '--check'])
