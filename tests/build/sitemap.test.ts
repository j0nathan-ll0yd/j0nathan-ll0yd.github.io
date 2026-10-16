import {beforeAll, describe, expect, it} from 'vitest'
import {readFileSync} from 'fs'
import path from 'path'
import {clientDir} from '../../scripts/lib/build-paths.mjs'
import {identity, llm} from '@j0nathan-ll0yd/copy'
import {contentLastModified} from '../../src/lib/content-date'

// Asserts the enriched sitemap (astro.config.mjs sitemap() options) ships the
// per-page SEO signals it is configured for (changefreq, priority, lastmod).
// It lists only indexable pages: /privacy is noindex, so it is absent. lastmod appears only
// where an authored content date exists: the three static text pages carry their copy
// lastModified key. / carries none: it is live client-side data with no
// verifiable content date, and CI checks out with depth 1, so git history gives a wrong
// date (website #360, docs/wiki/Metadata-Files-Spec.md).
const distDir = clientDir()

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
  it('lists only the four indexable pages (home, /about, /contact, /developers)', () => {
    const locs = [...xml.matchAll(/<loc>([^<]+)<\/loc>/g)].map((m) => m[1])
    expect(locs.sort()).toEqual(['', '/about', '/contact', '/developers'].map((p) => `https://jonathanlloyd.me${p}`))
  })

  it('never lists the private on-demand render page /ssr-dashboard (atlas decision 0160, PR B)', () => {
    const pathnames = [...xml.matchAll(/<loc>([^<]+)<\/loc>/g)].map((m) => new URL(m[1]).pathname)
    expect(pathnames.filter((pathname) => pathname.startsWith('/ssr-dashboard'))).toEqual([])
    expect(xml).not.toContain('ssr-dashboard')
  })

  it.each(['/privacy', '/offline', '/404'])('omits the noindex page %s', (page) => {
    const pathnames = [...xml.matchAll(/<loc>([^<]+)<\/loc>/g)].map((m) => new URL(m[1]).pathname)
    expect(pathnames).not.toContain(page)
  })

  it('home page has priority 1.0 and daily changefreq', () => {
    const home = urlBlock('/')
    expect(home).toMatch(/<priority>1(\.0)?<\/priority>/)
    expect(home).toMatch(/<changefreq>daily<\/changefreq>/)
  })

  it.each(['/about', '/contact', '/developers'])('%s has priority 0.5 and monthly changefreq', (page) => {
    const block = urlBlock(page)
    expect(block).toMatch(/<priority>0\.5<\/priority>/)
    expect(block).toMatch(/<changefreq>monthly<\/changefreq>/)
  })

  // lastmod means "content last changed" (atlas decision 0158, owner decision 2026-10-12).
  // Two halves: a static page carries exactly its copy lastModified date, and every other URL
  // carries none. A build-time stamp on any URL is the defect this guards.
  const lastmodOf = (page: string) => urlBlock(page).match(/<lastmod>([^<]+)<\/lastmod>/)?.[1] ?? null
  const STATIC_PAGE_DATES: Array<[string, string]> = [
    ['/about', identity.about.lastModified],
    ['/contact', identity.contact.lastModified],
    ['/developers', llm.developers.lastModified]
  ]

  it('home page carries no lastmod: live data has no verifiable content date', () => {
    expect(lastmodOf('/')).toBeNull()
  })

  it.each(STATIC_PAGE_DATES)('%s lastmod is its copy lastModified (%s)', (page, copyDate) => {
    expect(lastmodOf(page)).toBe(contentLastModified(copyDate))
  })

  it('carries a lastmod on the static pages only, and none is a build timestamp', () => {
    const blocks = xml.match(/<url>[\s\S]*?<\/url>/g) ?? []
    const stamped = blocks.filter((b) => b.includes('<lastmod>')).map((b) => new URL(b.match(/<loc>([^<]+)<\/loc>/)![1]).pathname)
    expect(stamped.sort()).toEqual(STATIC_PAGE_DATES.map(([page]) => page).sort())
    for (const value of xml.match(/<lastmod>([^<]+)<\/lastmod>/g) ?? []) {
      // A copy date is a calendar day (contentLastModified emits UTC midnight); a build stamp is not.
      expect(value).toMatch(/T00:00:00\.000Z<\/lastmod>$/)
    }
  })

  it('the sitemap index stamps its child with the latest static-page date, never the build time', () => {
    const index = readFileSync(path.join(distDir, 'sitemap-index.xml'), 'utf-8')
    const latest = STATIC_PAGE_DATES.map(([, d]) => contentLastModified(d)).sort().at(-1)
    const stamps = [...index.matchAll(/<lastmod>([^<]+)<\/lastmod>/g)].map((m) => m[1])
    // Exactly one child sitemap, stamped once: an index with no lastmod cannot pass this.
    expect(stamps).toEqual([latest])
  })
})
