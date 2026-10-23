#!/usr/bin/env node
/* `pnpm build` (atlas decision 0164, Variant D): `astro build` twice around the build-time shell cut.
 *
 * The Worker compiles in the cut of the data-free page (src/lib/composed/compiled-shell.ts), but the
 * page exists only after `astro build` has bundled the Worker. So: build, cut the page into
 * src/lib/composed/shell.generated.ts (scripts/build-shell.mjs), build again so the Worker bundle
 * holds that cut, then check that the second build shipped the same page and that the Worker
 * bundle holds its cut (`--check`). The page does not depend on the Worker bundle; the check fails
 * the build if that ever stops being true. Measured 2026-10-23: one `astro build` takes 5.5 s.
 *
 * Arguments go to both `astro build` runs (deploy.yml passes `--json`). */
import {execFileSync} from 'node:child_process'
import {fileURLToPath} from 'node:url'

const ROOT = fileURLToPath(new URL('..', import.meta.url))
const SHELL_SCRIPT = fileURLToPath(new URL('./build-shell.mjs', import.meta.url))
const args = process.argv.slice(2)
const run = (command, commandArgs) => execFileSync(command, commandArgs, {stdio: 'inherit', cwd: ROOT})

run('pnpm', ['exec', 'astro', 'build', ...args])
run('pnpm', ['exec', 'tsx', SHELL_SCRIPT])
run('pnpm', ['exec', 'astro', 'build', ...args])
run('pnpm', ['exec', 'tsx', SHELL_SCRIPT, '--check'])
