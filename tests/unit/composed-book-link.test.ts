// @vitest-environment node
//
// The Bookshelf tile link (web 4.6.0, DS #333; atlas decision 0160 D5): each tile's title text links
// to its book, so a visitor or crawler without JavaScript reaches it. The policy admits the link only
// in its exact DS shape, `a.shelf-book-link` in `cardBooks` with `target="_blank"` and
// `rel="sponsored noopener noreferrer"`, and only with the href `amazonBookUrl` builds. These probes
// pin those bounds, and that the known-answer Bookshelf fragment is admitted.
import {readFileSync} from 'node:fs'
import {HIDING_FOCUS_MODES} from '@j0nathan-ll0yd/portal-contract/constants'
import {amazonBookUrl} from '@j0nathan-ll0yd/web/runtime/adapters'
import {describe, expect, it} from 'vitest'
import {checkArtifact, COMPOSED_MAX_FUTURE_SKEW_MS} from '../../src/lib/composed/artifact'
import {BOOK_LINK, BOOK_LINK_QUERY, bookHrefAllowed, checkFragment, LINK_HOSTS} from '../../src/lib/composed/fragment-policy'
import {bookUrl} from '../shared/book-url'

const TEXT = readFileSync(new URL('../fixtures/composed/dashboard.json', import.meta.url), 'utf8')
const ARTIFACT = JSON.parse(TEXT) as {composedAt: string; composer: {build: string}; fragments: Record<string, string>}
const OPTIONS = {maxGeneratedAtMs: Date.parse(ARTIFACT.composedAt) + COMPOSED_MAX_FUTURE_SKEW_MS, overlayMayShow: false}
const BOOKS = ARTIFACT.fragments.cardBooks
const READING = ARTIFACT.fragments.cardReading
const ASIN = 'B0KA7731P1'
const HREF = amazonBookUrl(ASIN)
/** The href as the DS serializes it in a double-quoted attribute. */
const encoded = (href: string): string => href.replaceAll('&', '&amp;')
const SHAPE = `class="shelf-book-link" href="${encoded(HREF)}" target="_blank" rel="sponsored noopener noreferrer"`

/** The known-answer Bookshelf fragment with its first tile link's attributes replaced by `attributes`. */
function withLink(attributes: string): string {
  const at = BOOKS.indexOf(`<a ${SHAPE}>`)
  expect(at, 'the known-answer Bookshelf fragment carries the DS tile link').toBeGreaterThan(0)
  return BOOKS.slice(0, at) + `<a ${attributes}>` + BOOKS.slice(at + `<a ${SHAPE}>`.length)
}

/** The known-answer Reading fragment with `row` as the first item of its list. */
function withReadingRow(row: string): string {
  const at = READING.indexOf('<li ')
  expect(at, 'the known-answer Reading fragment lists articles').toBeGreaterThan(0)
  return READING.slice(0, at) + row + READING.slice(at)
}

describe('the Bookshelf tile link: admitted in its DS shape', () => {
  // covers: dashboard-ssr#The Worker splices only allowlisted markup
  it('admits the known-answer Bookshelf fragment, whose every tile links to its book', () => {
    expect(BOOKS.match(/<a class="shelf-book-link" /g)).toHaveLength(BOOKS.match(/<li class="shelf-book[ "]/g)?.length ?? -1)
    expect(BOOKS).toContain(`<a ${SHAPE}>`)
    expect(checkFragment(BOOKS, 'cardBooks', OPTIONS)).toMatchObject({ok: true})
    expect(checkArtifact(TEXT, Date.parse(ARTIFACT.composedAt), ARTIFACT.composer.build, new Set(HIDING_FOCUS_MODES))).toMatchObject({ok: true})
  })

  it('names the exact DS shape', () => {
    expect(BOOK_LINK).toEqual({fragment: 'cardBooks', className: 'shelf-book-link', target: '_blank', rel: 'sponsored noopener noreferrer'})
  })

  it('tethers the affiliate query, and the Playwright suites copy, to the DS amazonBookUrl', () => {
    expect(amazonBookUrl(ASIN)).toBe(`https://www.amazon.com/dp/${ASIN}${BOOK_LINK_QUERY}`)
    for (const asin of [ASIN, 'B0FBRJY116', '080413717X', '1600000010', 'a/b?c']) {
      expect(bookUrl(asin)).toBe(amazonBookUrl(asin))
    }
  })

  it.each([
    ['a 10-character ASIN', 'B0FBRJY116'],
    ['an ISBN-10 ending in X', '080413717X'],
    ['a fixture ISBN-10', '1600000010']
  ])('admits the href amazonBookUrl builds for %s', (_label, asin) => {
    expect(bookHrefAllowed(amazonBookUrl(asin))).toBe(true)
    expect(checkFragment(withLink(SHAPE.replace(encoded(HREF), encoded(amazonBookUrl(asin)))), 'cardBooks', OPTIONS)).toMatchObject({ok: true})
  })

  it('never lists the book host as a link host every card may name', () => {
    expect(LINK_HOSTS.has(new URL(HREF).hostname)).toBe(false)
  })
})

describe('the Bookshelf tile link: every other form is refused', () => {
  it.each([
    ['a non-/dp/ path', `https://www.amazon.com/gp/product/${ASIN}${BOOK_LINK_QUERY}`],
    ['a trailing path segment', `https://www.amazon.com/dp/${ASIN}/ref${BOOK_LINK_QUERY}`],
    ['a lower-case ASIN', `https://www.amazon.com/dp/b0ka7731p1${BOOK_LINK_QUERY}`],
    ['a 9-character ASIN', `https://www.amazon.com/dp/${ASIN.slice(0, 9)}${BOOK_LINK_QUERY}`],
    ['an 11-character ASIN', `https://www.amazon.com/dp/${ASIN}X${BOOK_LINK_QUERY}`],
    ['the 4-character ASIN of the old fixtures', `https://www.amazon.com/dp/C001${BOOK_LINK_QUERY}`],
    ['an empty ASIN', `https://www.amazon.com/dp/${BOOK_LINK_QUERY}`],
    ['an encoded slash in the ASIN', `https://www.amazon.com/dp/B0KA%2F1P1${BOOK_LINK_QUERY}`],
    ['another host', `https://evil.example/dp/${ASIN}${BOOK_LINK_QUERY}`],
    ['the bare amazon.com host', `https://amazon.com/dp/${ASIN}${BOOK_LINK_QUERY}`],
    ['another Amazon store', `https://www.amazon.co.uk/dp/${ASIN}${BOOK_LINK_QUERY}`],
    ['a subdomain of the host', `https://smile.www.amazon.com/dp/${ASIN}${BOOK_LINK_QUERY}`],
    ['userinfo before the host', `https://www.amazon.com@evil.example/dp/${ASIN}${BOOK_LINK_QUERY}`],
    ['a port', `https://www.amazon.com:8443/dp/${ASIN}${BOOK_LINK_QUERY}`],
    ['http:', `http://www.amazon.com/dp/${ASIN}${BOOK_LINK_QUERY}`],
    ['no query', `https://www.amazon.com/dp/${ASIN}`],
    ['another affiliate tag', `https://www.amazon.com/dp/${ASIN}${BOOK_LINK_QUERY.replace('lifegames04-20', 'other-20')}`],
    ['an extra query parameter', `${HREF}&x=1`],
    ['a fragment', `${HREF}#x`]
  ])('refuses %s', (_label, href) => {
    expect(bookHrefAllowed(href)).toBe(false)
    expect(checkFragment(withLink(SHAPE.replace(encoded(HREF), encoded(href))), 'cardBooks', OPTIONS)).toMatchObject({ok: false})
  })

  it.each([
    ['on another Bookshelf class', `class="shelf-book-author" href="${encoded(HREF)}" target="_blank" rel="sponsored noopener noreferrer"`, 'url'],
    ['with no class', `href="${encoded(HREF)}" target="_blank" rel="sponsored noopener noreferrer"`, 'url'],
    ['with a second class', `class="shelf-book-link shelf-book-title" href="${encoded(HREF)}" target="_blank" rel="sponsored noopener noreferrer"`, 'url'],
    ['without target', `class="shelf-book-link" href="${encoded(HREF)}" rel="sponsored noopener noreferrer"`, 'url'],
    ['without rel', `class="shelf-book-link" href="${encoded(HREF)}" target="_blank"`, 'attribute'],
    ['without noopener', `class="shelf-book-link" href="${encoded(HREF)}" target="_blank" rel="sponsored noreferrer"`, 'attribute'],
    ['without sponsored', `class="shelf-book-link" href="${encoded(HREF)}" target="_blank" rel="noopener noreferrer"`, 'url'],
    ['with rel in another order', `class="shelf-book-link" href="${encoded(HREF)}" target="_blank" rel="noopener noreferrer sponsored"`, 'url'],
    ['with another rel token', `class="shelf-book-link" href="${encoded(HREF)}" target="_blank" rel="sponsored noopener noreferrer nofollow"`, 'attribute']
  ])('refuses the book href %s', (_label, attributes, reason) => {
    expect(checkFragment(withLink(attributes), 'cardBooks', OPTIONS)).toMatchObject({ok: false, reason})
  })

  it('refuses the book href on an element other than `a`', () => {
    const at = BOOKS.indexOf(`<a ${SHAPE}>`)
    const close = BOOKS.indexOf('</a>', at)
    const html = BOOKS.slice(0, at) + `<span ${SHAPE}>` + BOOKS.slice(at + `<a ${SHAPE}>`.length, close) + '</span>' + BOOKS.slice(close + '</a>'.length)
    expect(checkFragment(html, 'cardBooks', OPTIONS)).toMatchObject({ok: false, reason: 'attribute'})
  })

  it('refuses the book link shape in any card but cardBooks', () => {
    // `class` is checked first: the book class is not a Reading token.
    expect(checkFragment(withReadingRow(`<li class="article-list-item"><a ${SHAPE}>x</a></li>`), 'cardReading', OPTIONS)).toMatchObject({
      ok: false,
      reason: 'class'
    })
    // Without the class, the book href with the book rel stands nowhere outside cardBooks.
    const bare = `<li class="article-list-item"><a href="${encoded(HREF)}" target="_blank" rel="sponsored noopener noreferrer">x</a></li>`
    expect(checkFragment(withReadingRow(bare), 'cardReading', OPTIONS)).toMatchObject({ok: false, reason: 'url'})
  })

  it('refuses `sponsored` on any other link', () => {
    // An article link: any host, the article shape, but the book rel.
    const article =
      `<li class="article-list-item"><a class="article-list-title" href="https://example.com/a" target="_blank" rel="sponsored noopener noreferrer">x</a></li>`
    expect(checkFragment(withReadingRow(article), 'cardReading', OPTIONS)).toMatchObject({ok: false, reason: 'url'})
    // An allowlisted host in the book link's shape: no book href, so no `sponsored`.
    expect(checkFragment(withLink(SHAPE.replace(encoded(HREF), 'https://github.com/x')), 'cardBooks', OPTIONS)).toMatchObject({
      ok: false,
      reason: 'attribute'
    })
    // A first-party path with `sponsored` alone.
    expect(checkFragment(withLink('class="shelf-book-link" href="/privacy" rel="sponsored"'), 'cardBooks', OPTIONS)).toMatchObject({
      ok: false,
      reason: 'attribute'
    })
  })

  it.each([
    ['a decimal reference', 'rel="sponsore&#100; noopener"'],
    ['a hex reference', 'rel="&#x73;ponsored noopener"'],
    ['a named reference', 'rel="sponsored&nbsp;noopener"']
  ])('refuses a character reference in rel (%s), which would hide sponsored from the tag check', (_label, rel) => {
    // A first-party link, and an allowlisted link with target, both in cardBooks.
    expect(checkFragment(withLink(`class="shelf-book-link" href="/privacy" ${rel}`), 'cardBooks', OPTIONS)).toMatchObject({ok: false, reason: 'attribute'})
    expect(checkFragment(withLink(`href="https://github.com/x" target="_blank" ${rel}`), 'cardBooks', OPTIONS)).toMatchObject({
      ok: false,
      reason: 'attribute'
    })
  })

  it('keeps the article link admitted for an Amazon article URL in its own shape', () => {
    const article = `<li class="article-list-item"><a class="article-list-title" href="${
      encoded(HREF)
    }" target="_blank" rel="noopener noreferrer">x</a></li>`
    expect(checkFragment(withReadingRow(article), 'cardReading', OPTIONS)).toMatchObject({ok: true})
  })
})

// HTML splits `rel` and `srcset` on ASCII whitespace only (tab, LF, FF, CR, space). JavaScript's
// `\s` also matches U+00A0 and the Unicode spaces, so a policy that split with `\s` admitted
// `rel="noopener<U+00A0>noreferrer"`, which a browser reads as one unknown token and no `noopener`.
describe('rel and srcset: ASCII whitespace only, as HTML splits them', () => {
  const SPACES: [string, string][] = [
    ['U+00A0 (no-break space)', '\u00a0'],
    ['U+2003 (em space)', '\u2003'],
    ['U+000B (vertical tab)', '\u000b'],
    ['U+FEFF (byte order mark)', '\ufeff']
  ]

  it.each(SPACES)('refuses rel tokens joined by %s on a first-party link with target', (_label, space) => {
    const html = withLink(`href="/privacy" target="_blank" rel="noopener${space}noreferrer"`)
    expect(checkFragment(html, 'cardBooks', OPTIONS)).toMatchObject({ok: false, reason: 'attribute'})
  })

  it.each(SPACES)('refuses the book link shape with %s in its rel', (_label, space) => {
    const html = withLink(SHAPE.replace('sponsored noopener', `sponsored${space}noopener`))
    expect(checkFragment(html, 'cardBooks', OPTIONS)).toMatchObject({ok: false})
  })

  it.each([
    ['a tab', '\t'],
    ['a line feed', '\n']
  ])('admits rel tokens joined by %s, which HTML also splits on', (_label, space) => {
    const html = withLink(`href="/privacy" target="_blank" rel="noopener${space}noreferrer"`)
    expect(checkFragment(html, 'cardBooks', OPTIONS)).toMatchObject({ok: true})
  })

  it.each(SPACES)('refuses a srcset descriptor joined by %s', (_label, space) => {
    const srcset = 'srcset="/images/no-cover.svg 1x, /images/no-cover.svg 2x"'
    expect(BOOKS).toContain(srcset)
    const html = BOOKS.replace(srcset, `srcset="/images/no-cover.svg 1x, /images/no-cover.svg${space}2x"`)
    expect(checkFragment(html, 'cardBooks', OPTIONS)).toMatchObject({ok: false, reason: 'url'})
  })
})
