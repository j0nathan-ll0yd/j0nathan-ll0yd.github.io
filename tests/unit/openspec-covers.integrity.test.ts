import {describe, expect, it} from 'vitest'
import {readFileSync} from 'node:fs'
import {resolve} from 'node:path'
import {createHash} from 'node:crypto'

export const OPENSPEC_COVERS_SHA256 = '380733e423898f25f94fcbcecd63cf3201f4c516a96e7f4b1e3f5e9afefbe9d6'

describe('openspec-covers vendor integrity', () => {
  it('matches the pinned OPENSPEC_COVERS_SHA256 constant', () => {
    const codePath = resolve(__dirname, '../../scripts/vendor/openspec-covers.mjs')
    const code = readFileSync(codePath, 'utf8')
    const actualSha = createHash('sha256').update(code).digest('hex')
    expect(actualSha).toBe(OPENSPEC_COVERS_SHA256)
  })
})
