import {describe, expect, it} from 'vitest'
import {ALLOWED_EMPTY_405_CONTENT_TYPE, compare} from '../../scripts/worker-parity.mjs'

// The parity comparison's named allowances (atlas decision 0160, Step 3.6).

const testCase = {path: '/privacy', method: 'POST', accept: 'text/html', body: 'none'}
const side = (status: number, headers: Record<string, string>, body = '') => ({
  status,
  location: null,
  headers: new Map(Object.entries(headers)),
  body: Buffer.from(body)
})

describe('compare', () => {
  it('allows the page Content-Type on an empty 405 (owner-accepted 2026-10-14)', () => {
    expect(compare(testCase, side(405, {}), side(405, {'content-type': ALLOWED_EMPTY_405_CONTENT_TYPE}))).toEqual([])
  })

  it('does not allow it on a 405 with a body, or on another status', () => {
    expect(compare(testCase, side(405, {}, 'x'), side(405, {'content-type': ALLOWED_EMPTY_405_CONTENT_TYPE}, 'x'))).toHaveLength(1)
    expect(compare(testCase, side(200, {}), side(200, {'content-type': ALLOWED_EMPTY_405_CONTENT_TYPE}))).toHaveLength(1)
  })

  it('allows the preview noindex only for a workers.dev candidate', () => {
    expect(compare(testCase, side(405, {}), side(405, {'x-robots-tag': 'noindex'}), true)).toEqual([])
    expect(compare(testCase, side(405, {}), side(405, {'x-robots-tag': 'noindex'}), false)).toHaveLength(1)
  })
})
