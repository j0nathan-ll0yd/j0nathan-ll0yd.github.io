// Helpers of the build gates that run between and after the two `astro build` passes
// (scripts/build-site.mjs): scripts/build-shell.mjs and scripts/build-value-free.mjs (atlas decision 0164).
import {readdirSync, readFileSync, realpathSync} from 'node:fs'
import path from 'node:path'
import {fileURLToPath} from 'node:url'
import {serverDir} from './build-paths.mjs'

const ROOT = fileURLToPath(new URL('../..', import.meta.url))

/** The Worker bundle's modules that name `marker` (a sha256 a generated module carries): exactly one when that module is compiled in. */
export function bundlesNaming(marker, dir = serverDir(ROOT)) {
  return readdirSync(dir, {recursive: true}).map(String).filter((name) =>
    name.endsWith('.mjs') && readFileSync(path.join(dir, name), 'utf8').includes(marker)
  )
}

/**
 * Whether the module at `url` is the script node runs. Node keeps `process.argv[1]` as given and the
 * ESM loader resolves the module URL to its real path, so a symlink in the checkout path would make a
 * plain comparison false, and a gate would exit 0 having checked nothing. Both sides are resolved here.
 */
export function isMainModule(url) {
  const entry = process.argv[1]
  if (entry === undefined) {
    return false
  }
  try {
    return realpathSync(entry) === realpathSync(fileURLToPath(url))
  } catch {
    return false
  }
}
