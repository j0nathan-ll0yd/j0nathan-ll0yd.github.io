import {beforeAll, describe, expect, it} from 'vitest'
import {existsSync, readdirSync, readFileSync, statSync} from 'fs'
import {load} from 'cheerio'
import path from 'path'
import {SITE_URL} from '@j0nathan-ll0yd/portal-contract/constants'

// Every canonical URL, sitemap URL and internal link must answer 200 directly, with no redirect.
// The host maps a URL to the static output by these rules, which Cloudflare Pages and the Workers
// static-assets default (html_handling "auto-trailing-slash") share:
//   /x            serves x.html with a 200; a directory index x/index.html is served only at /x/,
//                 so /x redirects to /x/
//   /x/           redirects to /x when x.html exists
//   /x.html       redirects to /x
//   /x/index.html redirects to /x/
// With trailingSlash: 'never' the site's URLs have no trailing slash, so a page must build as
// x.html (build.format 'file'). A page built as x/index.html makes its own canonical URL redirect.
const distDir = path.resolve(process.cwd(), 'dist')
const site = new URL(SITE_URL)

type Resolution = {ok: true; file: string} | {ok: false; reason: string}

/** How the host answers a same-origin pathname, read from the built output. */
function resolve(pathname: string): Resolution {
  if (pathname === '/') {
    return existsSync(path.join(distDir, 'index.html')) ? {ok: true, file: 'index.html'} : {ok: false, reason: 'no index.html'}
  }
  if (pathname.endsWith('/')) {
    return {ok: false, reason: 'has a trailing slash; the host redirects it'}
  }
  if (pathname.endsWith('.html')) {
    return {ok: false, reason: 'names the .html file; the host redirects it to the extensionless URL'}
  }
  const relative = decodeURIComponent(pathname).replace(/^\/+/, '')
  const file = path.join(distDir, relative)
  if (existsSync(path.join(file, 'index.html'))) {
    return {ok: false, reason: `is served from the directory index ${relative}/index.html; the host redirects it to ${pathname}/`}
  }
  if (existsSync(`${file}.html`)) {
    return {ok: true, file: `${relative}.html`}
  }
  if (existsSync(file) && statSync(file).isFile()) {
    return {ok: true, file: relative}
  }
  return {ok: false, reason: 'is not in the static output'}
}

/** The URL the host serves a built page at: index.html at `/`, privacy.html at `/privacy`. */
const pageUrl = (file: string) => new URL(`/${file.split(path.sep).join('/')}`.replace(/(?:\/index)?\.html$/, '') || '/', site)

/** The same-origin pathname a URL resolves to from `base`, or null for another origin or scheme. */
function sameOriginPath(value: string | undefined, base: URL = site): string | null {
  if (!value) {
    return null
  }
  let url: URL
  try {
    url = new URL(value, base)
  } catch {
    return null
  }
  return url.origin === site.origin ? url.pathname : null
}

/** A pathname that names a page, not an asset or endpoint: no file extension in its last segment. */
const isPagePath = (pathname: string) => !/\.[a-z0-9]+$/i.test(pathname.split('/').pop() ?? '')

// Build output that is not a page: bundles, vendored libraries, mirrored images.
const NOT_PAGES = /^(_astro|vendor|images|assets|fonts)[\\/]/
const pages = () => readdirSync(distDir, {recursive: true, encoding: 'utf-8'}).filter((file) => file.endsWith('.html') && !NOT_PAGES.test(file)).sort()

const locs = (file: string) => [...readFileSync(path.join(distDir, file), 'utf-8').matchAll(/<loc>([^<]+)<\/loc>/g)].map((match) => match[1])

let sitemapUrls: string[] = []

beforeAll(() => {
  // Every child sitemap the index lists, so a split into sitemap-1.xml stays checked.
  sitemapUrls = locs('sitemap-index.xml').flatMap((child) => locs(new URL(child).pathname.slice(1)))
})

describe('URLs answer 200 with no redirect', () => {
  it('builds every page as <name>.html, never as a directory index', () => {
    expect(pages().filter((file) => file !== 'index.html' && path.basename(file) === 'index.html')).toEqual([])
  })

  it('lists only sitemap URLs the host serves directly', () => {
    expect(sitemapUrls.length).toBeGreaterThan(0)
    const failures = sitemapUrls.flatMap((url) => {
      const pathname = sameOriginPath(url)
      if (pathname === null) {
        return [`${url} is not on ${site.origin}`]
      }
      const result = resolve(pathname)
      return result.ok && result.file.endsWith('.html') ? [] : [`${url} ${result.ok ? 'is not an HTML page' : result.reason}`]
    })
    expect(failures).toEqual([])
  })

  it.each(pages())('declares a canonical URL and og:url on %s that the host serves directly', (file) => {
    const $ = load(readFileSync(path.join(distDir, file), 'utf-8'))
    const canonical = $('link[rel="canonical"]').attr('href')
    const ogUrl = $('meta[property="og:url"]').attr('content')
    expect(canonical, `${file} has no canonical URL`).toBeTruthy()
    expect(ogUrl, `${file}: og:url differs from the canonical URL`).toBe(canonical)
    const pathname = sameOriginPath(canonical)
    expect(pathname, `${file}: canonical ${canonical} is not on ${site.origin}`).not.toBeNull()
    expect(`${new URL(canonical!).search}${new URL(canonical!).hash}`, `${file}: canonical ${canonical} carries a query or fragment`).toBe('')
    const result = resolve(pathname!)
    expect(result.ok ? '' : `${canonical} ${result.reason}`, file).toBe('')
    // A page must name ITSELF as canonical, so the canonical URL resolves to this very file.
    expect(result.ok && result.file, `${file}: canonical ${canonical} names another file`).toBe(file)
  })

  it.each(pages())('links only to page URLs the host serves directly, on %s', (file) => {
    const $ = load(readFileSync(path.join(distDir, file), 'utf-8'))
    const links = new Set<string>()
    $('a[href], link[href]').each((_, element) => {
      const pathname = sameOriginPath($(element).attr('href'), pageUrl(file))
      if (pathname !== null) {
        links.add(pathname)
      }
    })
    // JSON-LD URLs (WebPage.url, Dataset.license) are links too.
    $('script[type="application/ld+json"]').each((_, element) => {
      const walk = (node: unknown): void => {
        if (typeof node === 'string' && /^(https?:)?\//.test(node)) {
          const pathname = sameOriginPath(node)
          if (pathname !== null) {
            links.add(pathname)
          }
        } else if (node && typeof node === 'object') {
          Object.values(node).forEach(walk)
        }
      }
      walk(JSON.parse($(element).text()))
    })
    // An asset or endpoint path (with an extension) may be a Pages Function rather than a file,
    // but it can never be a directory index; a page path must be in the static output.
    const failures = [...links].sort().flatMap((pathname) => {
      const result = resolve(pathname)
      if (result.ok || (!isPagePath(pathname) && result.reason === 'is not in the static output')) {
        return []
      }
      return [`${pathname} ${result.reason}`]
    })
    expect(failures).toEqual([])
  })
})
