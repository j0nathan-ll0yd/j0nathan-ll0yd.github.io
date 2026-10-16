// audits/lib/run-memory.mjs -- the memory one scheduled check keeps between two daily runs.
//
// WHY. Plan Step 6.8 item 7 fails a `partial` page only on the SECOND consecutive run, so one
// upstream blip never pages the owner. B11 also keeps the last visible oracle values, so a hiding
// run can look for them in the page text.
//
// WHERE. A directory of small files (`B11_STATE_DIR`). The workflow restores it before the check
// and saves it after, with actions/cache (restore by the key prefix `b11-state-`, save under a
// per-run key, because a cache key is immutable). No GitHub issue, label or comment carries state:
// finding issues belong to the reconciler (audits/lib/file-check-issues.mjs) alone.
//
// LOUD, NEVER QUIET. Without a directory (a workstation run) or when a read or write fails, the
// memory is `unavailable`, and the caller must fail at once. An ABSENT file is not unavailable: it
// is the first run, or an entry the cache evicted after seven idle days.

import {mkdirSync, readFileSync, writeFileSync} from 'node:fs'
import path from 'node:path'

const NAME = /^[a-z0-9-]+$/

/**
 * @param {{dir?: string}} [options] `dir` defaults to `$B11_STATE_DIR`.
 * @returns {{read(name: string): Promise<{available: boolean, value: string|null}>, write(name: string, value: string): Promise<boolean>}}
 */
export function createRunMemory({dir = process.env.B11_STATE_DIR} = {}) {
  const fileOf = (name) => {
    if (!NAME.test(name)) {
      throw new TypeError(`run memory name must match ${NAME}, got ${JSON.stringify(name)}`)
    }
    return path.join(dir, name)
  }
  return {
    async read(name) {
      const file = dir ? fileOf(name) : ''
      if (!dir) {
        return {available: false, value: null}
      }
      try {
        return {available: true, value: readFileSync(file, 'utf8')}
      } catch (err) {
        return err?.code === 'ENOENT' ? {available: true, value: null} : {available: false, value: null}
      }
    },
    async write(name, value) {
      const file = dir ? fileOf(name) : ''
      if (!dir) {
        return false
      }
      try {
        mkdirSync(dir, {recursive: true})
        writeFileSync(file, value, 'utf8')
        return true
      } catch {
        return false
      }
    }
  }
}
