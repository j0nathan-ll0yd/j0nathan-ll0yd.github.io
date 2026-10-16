// Shared reads of the server-rendered `/` for the no-JavaScript suite (atlas decision 0160, plan Step 6.3).
import {readFileSync} from 'node:fs'
import path from 'node:path'
import {load} from 'cheerio'
import {clientDir} from '../../scripts/lib/build-paths.mjs'

/** The prerendered data-free page: the D2 fallback, the `HEAD /` source and the D9 rollback content. */
export function prerenderedIndexHtml(): string {
  return readFileSync(path.join(clientDir(), 'index.html'), 'utf8')
}

/** The visible text of a built page, scripts and styles removed, whitespace collapsed. */
export function visibleTextOf(html: string): string {
  const doc = load(html)
  doc('script, style').remove()
  return doc('body').text().replace(/\s+/g, ' ')
}

/** The head facts both renders must share. */
export interface HeadFacts {
  canonical: string | undefined
  robots: string | undefined
  ogUrl: string | undefined
  title: string
  jsonLdTypes: string[]
  /** Every other head fact: all <meta> name/property -> content (minus `ssr-data`), all <link> rel -> href, all JSON-LD blocks. */
  metas: string[]
  links: string[]
  jsonLd: unknown[]
}

export function headFactsOf(html: string): HeadFacts {
  const doc = load(html)
  const types = doc('script[type="application/ld+json"]').map((_, el) => {
    const parsed = JSON.parse(doc(el).text()) as {'@type'?: string | string[]; '@graph'?: {'@type'?: string | string[]}[]}
    const nodes = parsed['@graph'] ?? [parsed]
    return nodes.flatMap((node) => [node['@type'] ?? []].flat())
  }).get() as string[]
  const metas = doc('head meta').map((_, el) => {
    const key = doc(el).attr('name') ?? doc(el).attr('property') ?? doc(el).attr('http-equiv') ?? doc(el).attr('charset') ?? ''
    return key === 'ssr-data' ? [] : [`${key}=${doc(el).attr('content') ?? ''}`]
  }).get() as string[]
  const links = doc('head link').map((_, el) => `${doc(el).attr('rel') ?? ''}=${doc(el).attr('href') ?? ''}`).get() as string[]
  return {
    metas: metas.sort(),
    links: links.sort(),
    jsonLd: doc('script[type="application/ld+json"]').map((_, el) => JSON.parse(doc(el).text()) as unknown).get(),
    canonical: doc('link[rel="canonical"]').attr('href'),
    robots: doc('meta[name="robots"]').attr('content'),
    ogUrl: doc('meta[property="og:url"]').attr('content'),
    title: doc('title').text(),
    jsonLdTypes: types
  }
}
