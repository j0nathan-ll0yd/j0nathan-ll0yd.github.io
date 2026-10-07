import {describe, expect, it} from 'vitest'
import {contentLastModified} from '../../src/lib/content-date'

describe('contentLastModified', () => {
  it.each([
    ['2026-06-24', '2026-06-24T00:00:00.000Z'],
    ['2026-10-07', '2026-10-07T00:00:00.000Z'],
    ['2028-02-29', '2028-02-29T00:00:00.000Z']
  ])('%j is %s', (iso, expected) => {
    expect(contentLastModified(iso)).toBe(expected)
  })

  it.each(['June 2026', '2026-06', '2026-6-24', '2026-02-30', '2026-13-01', '2026-06-24T00:00:00Z', '', ' 2026-06-24'])('throws on %j', (value) => {
    expect(() => contentLastModified(value)).toThrow(/is not a YYYY-MM-DD calendar date/)
  })
})
