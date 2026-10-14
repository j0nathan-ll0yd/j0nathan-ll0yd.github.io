import {describe, expect, it} from 'vitest'
import {canonicalPagePaths, renderRedirectsFile} from '../../scripts/lib/redirects.mjs'
import {CODE_FREE_PREFIXES, CSP, CSP_HEADERS, isCodeFreePath, renderHeadersFile, withUtf8Charset} from '../../src/lib/edge/security-headers'

// The `_headers` and `_redirects` files the Workers static-asset plane reads (atlas decision 0160,
// PR A; plan Step 3.3). They must give each file exactly the headers and redirect status Pages did.

/** The rendered `_headers` file as one map per path pattern. */
function rules(): Map<string, string[]> {
  return rulesFor(renderHeadersFile())
}

function rulesFor(file: string): Map<string, string[]> {
  const map = new Map<string, string[]>()
  for (const block of file.trim().split('\n\n')) {
    const [pattern = '', ...lines] = block.split('\n')
    map.set(pattern, lines.map((line) => line.trim()))
  }
  return map
}

describe('_headers', () => {
  it('gives every file the CSP trio, as the Pages middleware did on every path it ran', () => {
    const all = rules().get('/*') ?? []
    expect(all).toContain(`Content-Security-Policy: ${CSP}`)
    expect(all).toContain('Access-Control-Allow-Origin: *')
  })

  it.each(CODE_FREE_PREFIXES)('detaches the CSP trio under %s, which never ran the middleware', (prefix) => {
    expect(rules().get(`${prefix}*`)).toEqual(CSP_HEADERS.map(([name]) => `! ${name}`))
  })

  it('keeps the robots.txt cache rule and the Pages JavaScript content type', () => {
    expect(rules().get('/robots.txt')).toEqual(['Cache-Control: public, max-age=3600, s-maxage=86400'])
    expect(rules().get('/*.js')).toEqual(['Content-Type: application/javascript'])
  })

  it('sets no Cache-Control on /_astro/*, unlike the adapter default (Pages sent the asset default)', () => {
    expect(rules().get('/_astro/*')?.some((line) => line.startsWith('Cache-Control'))).toBe(false)
  })

  it('stays within the Workers limits: 100 rules, 2,000 characters a line', () => {
    expect(rules().size).toBeLessThanOrEqual(100)
    for (const line of renderHeadersFile().split('\n')) {
      expect(line.length).toBeLessThanOrEqual(2000)
    }
  })

  it.each([['/_astro/a.js', true], ['/assets/icon.png', true], ['/js/clock.js', false], ['/', false], ['/astro', false]])('isCodeFreePath(%s) is %s',
    (path, expected) => {
      expect(isCodeFreePath(path)).toBe(expected)
    })
})

describe('_redirects', () => {
  it('answers the .html and trailing-slash forms of each page with a 308 to the canonical URL', () => {
    expect(renderRedirectsFile(['privacy.html', 'index.html', '404.html'])).toBe(
      ['/404.html /404 308', '/404/ /404 308', '/index.html / 308', '/privacy.html /privacy 308', '/privacy/ /privacy 308'].join('\n') + '\n'
    )
  })

  it('handles a page in a subdirectory', () => {
    expect(renderRedirectsFile(['docs/a.html'])).toBe('/docs/a.html /docs/a 308\n/docs/a/ /docs/a 308\n')
  })

  it('refuses a directory index, which build.format "file" never emits', () => {
    expect(() => renderRedirectsFile(['privacy/index.html'])).toThrow(/directory index/)
  })
})

describe('UTF-8 charset (Pages parity, measured on the Version URL 2026-10-14)', () => {
  it.each([
    ['text/html', 'text/html; charset=utf-8'],
    ['text/plain', 'text/plain; charset=utf-8'],
    ['text/css', 'text/css; charset=utf-8'],
    ['text/markdown', 'text/markdown; charset=utf-8'],
    ['text/html; charset=utf-8', 'text/html; charset=utf-8'],
    ['text/html; charset=ISO-8859-1', 'text/html; charset=ISO-8859-1'],
    ['application/json', 'application/json'],
    ['image/png', 'image/png']
  ])('withUtf8Charset(%s) is %s', (input, expected) => {
    expect(withUtf8Charset(input)).toBe(expected)
  })

  it('leaves a missing Content-Type missing', () => {
    expect(withUtf8Charset(null)).toBeNull()
  })

  it('adds a charset rule for each text extension and each built page', () => {
    const map = rulesFor(renderHeadersFile(['/', '/404', '/privacy']))
    expect(map.get('/*.css')).toEqual(['Content-Type: text/css; charset=utf-8'])
    expect(map.get('/*.txt')).toEqual(['Content-Type: text/plain; charset=utf-8'])
    expect(map.get('/*.md')).toEqual(['Content-Type: text/markdown; charset=utf-8'])
    for (const page of ['/', '/404', '/privacy']) {
      expect(map.get(page)).toEqual(['Content-Type: text/html; charset=utf-8'])
    }
  })

  it('maps built files to canonical page URLs', () => {
    expect(canonicalPagePaths(['privacy.html', 'index.html', '404.html'])).toEqual(['/404', '/', '/privacy'])
  })
})
