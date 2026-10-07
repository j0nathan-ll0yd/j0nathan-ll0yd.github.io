import {beforeAll, describe, expect, it} from 'vitest'
import {readFileSync} from 'fs'
import path from 'path'
import {identity, llm} from '@j0nathan-ll0yd/copy'
import {contentLastModified} from '../../src/lib/content-date'

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
  it('contains only the five canonical pages (home + four text pages), no 404', () => {
    const locs = [...xml.matchAll(/<loc>([^<]+)<\/loc>/g)].map((m) => m[1])
    expect(locs.sort()).toEqual(['', '/about', '/contact', '/developers', '/privacy'].map((p) => `https://jonathanlloyd.me${p}`))
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

  it.each(['/about', '/contact', '/developers'])('%s has priority 0.5 and monthly changefreq', (page) => {
    const block = urlBlock(page)
    expect(block).toMatch(/<priority>0\.5<\/priority>/)
    expect(block).toMatch(/<changefreq>monthly<\/changefreq>/)
  })

  // lastmod means "content last changed" (atlas decision 0158). The homepage bakes fresh data
  // into every build, so it carries the build time. A static page carries its copy's
  // lastModified date. A static page stamped with the build time is the defect this guards.
  const lastmodOf = (page: string) => urlBlock(page).match(/<lastmod>([^<]+)<\/lastmod>/)?.[1] ?? ''

  it('home page lastmod is this build time', () => {
    const built = Date.parse(lastmodOf('/'))
    expect(Number.isNaN(built)).toBe(false)
    expect(Date.now() - built).toBeLessThan(60 * 60 * 1000)
  })

  it.each([
    ['/privacy', identity.privacy.lastModified],
    ['/about', identity.about.lastModified],
    ['/contact', identity.contact.lastModified],
    ['/developers', llm.developers.lastModified]
  ])('%s lastmod is its copy lastModified (%s), never the build time', (page, copyDate) => {
    const lastmod = lastmodOf(page)
    expect(lastmod).not.toBe(lastmodOf('/'))
    expect(lastmod).toBe(contentLastModified(copyDate))
  })
})
