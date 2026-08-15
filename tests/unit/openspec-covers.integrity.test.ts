import {describe, expect, it} from 'vitest'
import {readFileSync} from 'node:fs'
import {resolve} from 'node:path'
import {createHash} from 'node:crypto'

export const OPENSPEC_COVERS_SHA256 = '82287af2f8392f6a39a6396e4b40e6841bf9884f8f5de7da635680613645bf3f'

describe('openspec-covers vendor integrity', () => {
  it('matches the pinned OPENSPEC_COVERS_SHA256 constant', () => {
    const codePath = resolve(__dirname, '../../scripts/vendor/openspec-covers.mjs')
    const code = readFileSync(codePath, 'utf8')
    const actualSha = createHash('sha256').update(code).digest('hex')
    expect(actualSha).toBe(OPENSPEC_COVERS_SHA256)
  })
})
