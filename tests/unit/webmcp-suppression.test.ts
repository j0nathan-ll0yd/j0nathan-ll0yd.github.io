import {readFileSync} from 'node:fs'
import {describe, expect, it} from 'vitest'

describe('generated WebMCP reading tool', () => {
  const source = readFileSync('public/js/webmcp.js', 'utf8')

  it('checks the honest focus source and non-2xx bookshelf responses before reading books', () => {
    expect(source).toContain("fetch('https://d1pfm520aduift.cloudfront.net/focus.json', { cache: 'no-store' })")
    expect(source).toContain('if (!res.ok)')
    expect(source).toContain("JSON.stringify({ suppressed: true, reason: 'focus mode active' })")
    expect(source).toContain('data.suppressed === true')
  })
})
