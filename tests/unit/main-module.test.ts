// @vitest-environment node
//
// scripts/lib/main-module.mjs (review of website #429, I3): a script that is also imported runs its
// main block only when node runs it, through a symlink in the path or a path that needs encoding too.
// The plain comparisons it replaces are false in both cases, and a gate written that way exits 0
// having checked nothing.
import {spawnSync} from 'node:child_process'
import {mkdirSync, mkdtempSync, realpathSync, rmSync, symlinkSync, writeFileSync} from 'node:fs'
import {tmpdir} from 'node:os'
import {join} from 'node:path'
import {fileURLToPath, pathToFileURL} from 'node:url'
import {afterAll, beforeAll, describe, expect, it} from 'vitest'
import {isMainModule} from '../../scripts/lib/main-module.mjs'

const HELPER = fileURLToPath(new URL('../../scripts/lib/main-module.mjs', import.meta.url))
let dir: string
/** A script in a directory whose name needs encoding in a URL. */
let script: string
/** The same directory, reached through a symlink. */
let linked: string

beforeAll(() => {
  dir = realpathSync(mkdtempSync(join(tmpdir(), 'main-module-')))
  mkdirSync(join(dir, 'a dir'))
  script = join(dir, 'a dir', 'gate.mjs')
  writeFileSync(script,
    `import {isMainModule} from ${JSON.stringify(pathToFileURL(HELPER).href)}\nif (isMainModule(import.meta.url)) {\n  console.log('checked')\n}\n`)
  symlinkSync(join(dir, 'a dir'), join(dir, 'link'))
  linked = join(dir, 'link', 'gate.mjs')
})

afterAll(() => {
  if (dir) {
    rmSync(dir, {recursive: true, force: true})
  }
})

describe('isMainModule', () => {
  it('is true for the script node runs, by its own path, through a symlink, or with a space in the path', () => {
    const url = pathToFileURL(script).href
    expect(isMainModule(url, script)).toBe(true)
    expect(isMainModule(url, linked)).toBe(true)
    // The two comparisons it replaces are both false through the symlink, and one is false for the space.
    expect(linked === fileURLToPath(url)).toBe(false)
    expect(url === `file://${script}`).toBe(false)
  })

  it('is false when another script runs, when node runs no script, and for a path that does not exist', () => {
    const url = pathToFileURL(script).href
    expect(isMainModule(url, HELPER)).toBe(false)
    expect(isMainModule(url, undefined)).toBe(false)
    expect(isMainModule(url, join(dir, 'missing.mjs'))).toBe(false)
  })

  it('runs the main block of a script started through a symlinked path with a space in it', () => {
    for (const path of [script, linked]) {
      const run = spawnSync(process.execPath, [path], {encoding: 'utf8'})
      expect(run.status, path).toBe(0)
      expect(run.stdout.trim(), path).toBe('checked')
    }
  })
})
