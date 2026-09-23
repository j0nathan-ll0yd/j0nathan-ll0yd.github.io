import {beforeAll, describe, expect, it} from 'vitest'
import {readFileSync} from 'fs'
import {load} from 'cheerio'
import path from 'path'
import {LLM_CONTENT_PATHS, SITE_URL} from '@j0nathan-ll0yd/portal-contract/constants'
import {LLMS_TXT_PATH} from '../../functions/_lib/llms-artifacts'
import {PNG} from 'pngjs'

const distDir = path.resolve(process.cwd(), 'dist')

let $: ReturnType<typeof load>

beforeAll(() => {
  const html = readFileSync(path.join(distDir, 'index.html'), 'utf-8')
  $ = load(html)
})

describe('SEO Meta Tags', () => {
  it('title contains "Jonathan Lloyd"', () => {
    const title = $('title').text()
    expect(title).toContain('Jonathan Lloyd')
  })

  it('meta description is non-empty', () => {
    const desc = $('meta[name="description"]').attr('content')
    expect(desc).toBeTruthy()
    expect(desc!.length).toBeGreaterThan(0)
  })

  it('meta description contains "data dashboard"', () => {
    const desc = $('meta[name="description"]').attr('content')
    expect(desc).toContain('data dashboard')
  })

  it('og:type is "profile"', () => {
    const ogType = $('meta[property="og:type"]').attr('content')
    expect(ogType).toBe('profile')
  })

  it('og:title is present and non-empty', () => {
    const ogTitle = $('meta[property="og:title"]').attr('content')
    expect(ogTitle).toBeTruthy()
    expect(ogTitle!.length).toBeGreaterThan(0)
  })

  it('og:description is present and non-empty', () => {
    const ogDesc = $('meta[property="og:description"]').attr('content')
    expect(ogDesc).toBeTruthy()
    expect(ogDesc!.length).toBeGreaterThan(0)
  })

  it('og:image is present and non-empty', () => {
    const ogImage = $('meta[property="og:image"]').attr('content')
    expect(ogImage).toBeTruthy()
    expect(ogImage!.length).toBeGreaterThan(0)
  })

  it('og:image is the exact same-origin 1200x630 decodable PNG', () => {
    const expected = new URL('/assets/og-image.png', SITE_URL)
    const raw = $('meta[property="og:image"]').attr('content')
    expect(raw).toBe(expected.href)

    const url = new URL(raw!)
    expect(url.origin).toBe(new URL(SITE_URL).origin)
    expect(url.search).toBe('')
    expect(url.hash).toBe('')

    const file = path.join(distDir, url.pathname.replace(/^\//, ''))
    const decoded = PNG.sync.read(readFileSync(file))
    expect(decoded.width).toBe(1200)
    expect(decoded.height).toBe(630)
  })

  it('profile:first_name is "Jonathan"', () => {
    const firstName = $('meta[property="profile:first_name"]').attr('content')
    expect(firstName).toBe('Jonathan')
  })

  it('profile:last_name is "Lloyd"', () => {
    const lastName = $('meta[property="profile:last_name"]').attr('content')
    expect(lastName).toBe('Lloyd')
  })

  it('twitter:card is present', () => {
    const twitterCard = $('meta[name="twitter:card"]').attr('content')
    expect(twitterCard).toBeTruthy()
  })

  it('canonical link is present and uses the canonical site URL', () => {
    const canonical = $('link[rel="canonical"]').attr('href')
    expect(canonical).toBeTruthy()
    expect(canonical).toContain(new URL(SITE_URL).hostname)
  })

  it('sitemap link is present', () => {
    const sitemap = $('link[rel="sitemap"]').attr('href')
    expect(sitemap).toBeTruthy()
  })

  it('no duplicate title tags', () => {
    const titles = $('title')
    expect(titles.length).toBe(1)
  })

  it('og:url is present', () => {
    const ogUrl = $('meta[property="og:url"]').attr('content')
    expect(ogUrl).toBeTruthy()
  })

  it('meta author is present', () => {
    const author = $('meta[name="author"]').attr('content')
    expect(author).toBeTruthy()
  })

  it('RSS feed discovery link is present with correct type and href', () => {
    const rssLink = $('link[rel="alternate"][type="application/rss+xml"]')
    expect(rssLink.length, 'RSS <link rel="alternate"> is missing').toBeGreaterThan(0)
    expect(rssLink.attr('href'), 'RSS feed href should be /feed.xml').toBe('/feed.xml')
    expect(rssLink.attr('title'), 'RSS feed title should be non-empty').toBeTruthy()
  })

  it('JSON Feed discovery link is present with correct type and href', () => {
    const jsonLink = $('link[rel="alternate"][type="application/feed+json"]')
    expect(jsonLink.length, 'JSON Feed <link rel="alternate"> is missing').toBeGreaterThan(0)
    expect(jsonLink.attr('href'), 'JSON Feed href should be /feed.json').toBe('/feed.json')
    expect(jsonLink.attr('title'), 'JSON Feed title should be non-empty').toBeTruthy()
  })
})

// covers: llms-txt#Advertised LLM addresses resolve on the site plane
/**
 * Nothing pinned these two links before atlas decision 0142, which is how the markdown alternate
 * drifted to the raw CloudFront origin unnoticed and stayed there.
 *
 * The ADDRESS IS THE POLICY. An advertised URL that resolves at the origin is an address the
 * site's privacy gate and cache rules never see -- and the origin serves selectively (on
 * 2026-09-22, location.json returned 403 AccessDenied while focus.json returned 200). Both
 * alternates must therefore address the site plane, where functions/_lib/proxy.ts gates them.
 */
describe('LLM content alternates', () => {
  const markdownSelector = 'link[rel="alternate"][type="text/markdown"]'
  const plainSelector = 'link[rel="alternate"][type="text/plain"]'

  function loadPage(relativePath: string) {
    return load(readFileSync(path.join(distDir, relativePath), 'utf-8'))
  }

  it('advertises llms-full.txt on the site plane, never the CloudFront origin', () => {
    const link = $(markdownSelector)
    expect(link.length, 'markdown <link rel="alternate"> is missing').toBe(1)
    expect(link.attr('href')).toBe(`${SITE_URL}${LLM_CONTENT_PATHS.llmsFull}`)
    expect(link.attr('href')).not.toContain('cloudfront.net')
    expect(link.attr('title'), 'markdown alternate title should be non-empty').toBeTruthy()
  })

  // The href is DERIVED, not spelled: LLMS_TXT_PATH is the pathname of the contract's own "LLM
  // discovery index" distribution entry (functions/_lib/llms-artifacts.ts).
  it('advertises the llms.txt discovery index at its derived contract path', () => {
    const link = $(plainSelector)
    expect(link.length, 'plain-text <link rel="alternate"> is missing').toBe(1)
    expect(link.attr('href')).toBe(`${SITE_URL}${LLMS_TXT_PATH}`)
    expect(link.attr('href')).not.toContain('cloudfront.net')
    expect(link.attr('title'), 'plain-text alternate title should be non-empty').toBeTruthy()
  })

  // Dashboard.astro is the layout for /, /privacy and /404 alike. These alternates describe the
  // homepage datastream, so every other page advertising them was over-advertising.
  it.each(['404.html', path.join('privacy', 'index.html')])('does not advertise them on %s', (page) => {
    const $page = loadPage(page)
    expect($page(markdownSelector).length).toBe(0)
    expect($page(plainSelector).length).toBe(0)
    // The feed alternates are site-wide and stay put.
    expect($page('link[rel="alternate"][type="application/rss+xml"]').length).toBe(1)
  })
})
