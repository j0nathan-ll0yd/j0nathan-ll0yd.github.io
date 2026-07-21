import {beforeAll, describe, expect, it} from 'vitest'
import {readFileSync} from 'fs'
import path from 'path'

// Asserts the enriched sitemap (astro.config.mjs sitemap() options) ships the
// per-page SEO signals it is configured for. Without this, the changefreq /
// priority / lastmod enrichment could silently regress to bare <loc> entries.
const distDir = path.resolve(process.cwd(), 'dist')

let xml: string

beforeAll(() => {
  xml = readFileSync(path.join(distDir, 'sitemap-0.xml'), 'utf-8')
})

// Pull the <url> block whose <loc> ends with the given path.
function urlBlock(locSuffix: string): string {
  const blocks = xml.match(/<url>[\s\S]*?<\/url>/g) ?? []
  const block = blocks.find((b) => {
    const loc = b.match(/<loc>([^<]+)<\/loc>/)?.[1] ?? ''
    return locSuffix === '/' ? /jonathanlloyd\.me<\/loc>/.test(b) : loc.endsWith(locSuffix)
  })
  expect(block, `no <url> block for "${locSuffix}"`).toBeTruthy()
  return block!
}

describe('Enriched sitemap', () => {
  it('contains only the two canonical pages (home + privacy), no 404', () => {
    const locs = [...xml.matchAll(/<loc>([^<]+)<\/loc>/g)].map((m) => m[1])
    expect(locs).toHaveLength(2)
    expect(locs.some((l) => /jonathanlloyd\.me$/.test(l))).toBe(true)
    expect(locs.some((l) => l.endsWith('/privacy'))).toBe(true)
    expect(locs.some((l) => l.includes('/404'))).toBe(false)
  })

  it('every url carries a lastmod', () => {
    const urls = xml.match(/<url>[\s\S]*?<\/url>/g) ?? []
    expect(urls.length).toBeGreaterThan(0)
    for (const u of urls) {
      expect(u, `missing <lastmod> in ${u}`).toMatch(/<lastmod>[^<]+<\/lastmod>/)
    }
  })

  it('home page has priority 1.0 and daily changefreq', () => {
    const home = urlBlock('/')
    expect(home).toMatch(/<priority>1(\.0)?<\/priority>/)
    expect(home).toMatch(/<changefreq>daily<\/changefreq>/)
  })

  it('privacy page has priority 0.3 and monthly changefreq', () => {
    const privacy = urlBlock('/privacy')
    expect(privacy).toMatch(/<priority>0\.3<\/priority>/)
    expect(privacy).toMatch(/<changefreq>monthly<\/changefreq>/)
  })
})
