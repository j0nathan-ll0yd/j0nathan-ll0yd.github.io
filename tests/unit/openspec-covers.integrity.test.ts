import {describe, expect, it} from 'vitest'
import {readFileSync} from 'node:fs'
import {resolve} from 'node:path'
import {createHash} from 'node:crypto'

export const OPENSPEC_COVERS_SHA256 = '13e7fc5aca68be812e941b3908884c608afce43cd84368d3c0999ce8ddc9429c'

describe('openspec-covers vendor integrity', () => {
  it('matches the pinned OPENSPEC_COVERS_SHA256 constant', () => {
    const codePath = resolve(__dirname, '../../scripts/vendor/openspec-covers.mjs')
    const code = readFileSync(codePath, 'utf8')
    const actualSha = createHash('sha256').update(code).digest('hex')
    expect(actualSha).toBe(OPENSPEC_COVERS_SHA256)
  })
})
