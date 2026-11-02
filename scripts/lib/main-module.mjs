// Whether a module is the script node runs, for a script that tests and other scripts also import.
// Node keeps `process.argv[1]` as given, while the ESM loader gives `import.meta.url` as the real
// path, percent-encoded. A plain comparison of the two is false through a symlink in the checkout path
// (macOS `/tmp` is `/private/tmp`) or a path that needs encoding, and a gate written that way exits 0
// having checked nothing (review of website #429, I3). Both sides are resolved here.
import {realpathSync} from 'node:fs'
import {fileURLToPath} from 'node:url'

/** True when the module at `url` (its `import.meta.url`) is the script node runs (`entry`, `process.argv[1]`). */
export function isMainModule(url, entry = process.argv[1]) {
  if (entry === undefined) {
    return false
  }
  try {
    return realpathSync(entry) === realpathSync(fileURLToPath(url))
  } catch {
    return false
  }
}
