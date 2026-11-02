// Helpers of the build gates that run between and after the two `astro build` passes
// (scripts/build-site.mjs): scripts/build-shell.mjs and scripts/build-value-free.mjs (atlas decision 0164).
import {readdirSync, readFileSync} from 'node:fs'
import path from 'node:path'
import {fileURLToPath} from 'node:url'
import {serverDir} from './build-paths.mjs'

const ROOT = fileURLToPath(new URL('../..', import.meta.url))

/** The Worker bundle's modules that name `marker` (the sha256 a generated module carries): exactly one when that module is compiled in. */
export function bundlesNaming(marker, dir = serverDir(ROOT)) {
  return readdirSync(dir, {recursive: true}).map(String).filter((name) =>
    name.endsWith('.mjs') && readFileSync(path.join(dir, name), 'utf8').includes(marker)
  )
}
