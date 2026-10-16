import {mkdtempSync, writeFileSync} from 'node:fs'
import {tmpdir} from 'node:os'
import path from 'node:path'
import {describe, expect, it} from 'vitest'
import {createRunMemory} from '../lib/run-memory.mjs'

const scratch = () => mkdtempSync(path.join(tmpdir(), 'run-memory-'))

describe('createRunMemory', () => {
  it('is unavailable without a directory, and writes nothing', async () => {
    const memory = createRunMemory({dir: ''})
    expect(await memory.read('partial')).toEqual({available: false, value: null})
    expect(await memory.write('partial', 'partial')).toBe(false)
  })

  it('reads an absent file as available with no value: the first run, or an evicted cache entry', async () => {
    expect(await createRunMemory({dir: scratch()}).read('partial')).toEqual({available: true, value: null})
  })

  it('round-trips a value and creates the directory on the first write', async () => {
    const memory = createRunMemory({dir: path.join(scratch(), 'nested')})
    expect(await memory.write('partial', 'partial')).toBe(true)
    expect(await memory.read('partial')).toEqual({available: true, value: 'partial'})
    expect(await memory.write('partial', 'clear')).toBe(true)
    expect(await memory.read('partial')).toEqual({available: true, value: 'clear'})
  })

  it('reports an unreadable or unwritable path as unavailable, never as a clean slate', async () => {
    const dir = scratch()
    writeFileSync(path.join(dir, 'blocker'), 'x')
    const memory = createRunMemory({dir: path.join(dir, 'blocker')})
    expect(await memory.write('partial', 'partial')).toBe(false)
    expect(await memory.read('partial')).toEqual({available: false, value: null})
  })

  it('rejects a name that could leave the directory', async () => {
    await expect(createRunMemory({dir: scratch()}).read('../x')).rejects.toThrow(TypeError)
  })
})
