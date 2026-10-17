// @vitest-environment node
//
// The Reading card's article link (web 4.3.0, DS #312): the one link that may name any https host.
// OWNER DECISION PENDING: option A admits it in its exact DS shape, `a.article-list-title` in
// `cardReading` with `target="_blank"` and `rel="noopener noreferrer"`; option B would strip the href
// on the server. These probes pin option A's bounds, and that the known-answer Reading fragment, with
// a DS-rendered row that carries notes, is admitted.
import {readFileSync} from 'node:fs'
import {HIDING_FOCUS_MODES} from '@j0nathan-ll0yd/portal-contract/constants'
import {articleItemHtml} from '@j0nathan-ll0yd/web/runtime/widget-markup'
import {describe, expect, it} from 'vitest'
import {checkArtifact, COMPOSED_MAX_FUTURE_SKEW_MS} from '../../src/lib/composed/artifact'
import {ARTICLE_LINK, articleHrefAllowed, checkFragment, MAX_ARTICLE_HREF, MAX_TITLE} from '../../src/lib/composed/fragment-policy'

const TEXT = readFileSync(new URL('../fixtures/composed/dashboard.json', import.meta.url), 'utf8')
const ARTIFACT = JSON.parse(TEXT) as {composedAt: string; composer: {build: string}; fragments: Record<string, string>}
const OPTIONS = {maxGeneratedAtMs: Date.parse(ARTIFACT.composedAt) + COMPOSED_MAX_FUTURE_SKEW_MS, overlayMayShow: false}
const READING = ARTIFACT.fragments.cardReading
const ARTICLE = 'https://articles.known-answer-kappa-7731.invalid/first'

/** The known-answer Reading fragment with `row` as the first item of its list. */
function withRow(row: string): string {
  const at = READING.indexOf('<li ')
  expect(at, 'the known-answer Reading fragment lists articles').toBeGreaterThan(0)
  return READING.slice(0, at) + row + READING.slice(at)
}

/** One row in the DS shape, with `link` as its anchor. */
function row(link: string): string {
  return `<li class="article-list-item" style="animation-delay: 0s">${link}<span class="article-list-source">(Source)</span></li>`
}

function anchor(href: string, attributes = 'target="_blank" rel="noopener noreferrer"', className = 'article-list-title'): string {
  return `<a class="${className}" href="${href}" ${attributes}>Title</a>`
}

describe('the Reading article link: admitted in its DS shape', () => {
  it('admits the known-answer Reading fragment, whose titles link to an unlisted host', () => {
    expect(READING).toContain(`href="${ARTICLE}"`)
    expect(checkFragment(READING, 'cardReading', OPTIONS)).toMatchObject({ok: true})
    expect(checkArtifact(TEXT, Date.parse(ARTIFACT.composedAt), ARTIFACT.composer.build, new Set(HIDING_FOCUS_MODES))).toMatchObject({ok: true})
  })

  it('admits a DS-rendered row with notes: the note icon, its escaped title and the article link', () => {
    const noted = articleItemHtml({
      title: 'A & B <i>"quoted"</i>',
      source: 'Hacker News',
      url: 'https://news.ycombinator.com/item?id=notes1&utm_source=x%2Fy',
      date: '1d ago',
      datetime: '2026-03-17T12:00:00.000Z',
      hasNotes: true,
      noteText: 'Great point about consensus algorithms\n<b>Follow up</b> on the "Raft" paper & more'
    }, 0)
    expect(noted).toContain('class="article-list-note" title="')
    expect(noted).toContain('class="article-list-note-icon"')
    expect(noted).toContain('class="article-list-title" href="https://news.ycombinator.com/')
    expect(checkFragment(withRow(noted), 'cardReading', OPTIONS)).toMatchObject({ok: true})
  })

  // The DS passes the feed's URL through unchanged when it parses as https (`safeHttpsUrl`), so every
  // form a publisher uses must be admitted, or one article would turn the composed page off.
  it.each([
    ['an upper-case host', 'https://Example.com/a'],
    ['an upper-case scheme', 'HTTPS://example.com/a'],
    ['the default port', 'https://example.com:443/a'],
    ['a non-ASCII path', 'https://example.com/café'],
    ['a space in the path', 'https://example.com/a b'],
    ['an underscore in a label', 'https://my_blog.example.com/'],
    ['a trailing dot', 'https://example.com./x'],
    ['an IDN TLD', 'https://xn--e1afmkfd.xn--p1ai/'],
    ['an encoded slash in the query', 'https://example.com/r?u=https%3A%2F%2Fx.example%2F'],
    ['an escaped ampersand', 'https://example.com/?a=1&amp;b=2']
  ])('admits an article link with %s', (_label, href) => {
    expect(checkFragment(withRow(row(anchor(href))), 'cardReading', OPTIONS)).toMatchObject({ok: true})
  })

  it('names the exact DS shape', () => {
    expect(ARTICLE_LINK).toEqual({fragment: 'cardReading', className: 'article-list-title', target: '_blank', rel: 'noopener noreferrer'})
  })
})

describe('the Reading article link: every other form is refused', () => {
  it.each([
    ['javascript: in mixed case', 'JaVaScRiPt:alert(1)'],
    ['javascript: entity-encoded', '&#106;avascript:alert(1)'],
    ['userinfo before the host', 'https://github.com@evil.example/'],
    ['a password in the userinfo', 'https://user:pass@evil.example/'],
    ['a data: URL', 'data:text/html;base64,PHNjcmlwdD5hbGVydCgxKTwvc2NyaXB0Pg=='],
    ['an http: URL', 'http://evil.example/'],
    ['a protocol-relative URL', '//evil.example/'],
    ['an https: URL without its slashes', 'https:evil.example/'],
    ['a port', 'https://evil.example:8443/'],
    ['an IPv4 host', 'https://127.0.0.1/'],
    ['an IPv6 host', 'https://[::1]/'],
    ['a single-label host', 'https://localhost/'],
    ['a backslash', 'https://evil.example\\@good.example/'],
    ['a tab', 'https://evil.example/\ta'],
    ['an entity-encoded newline', 'https://evil.example/&#10;a'],
    ['a leading space', ' https://evil.example/'],
    ['the site', 'https://jonathanlloyd.me/%2e%2e/focus.json'],
    ['a subdomain of the site', 'https://www.jonathanlloyd.me/'],
    ['the data plane', 'https://d1pfm520aduift.cloudfront.net/focus.json'],
    ['a workers.dev host', 'https://human-datastream.example.workers.dev/'],
    [`a 5 KB href (the bound is ${MAX_ARTICLE_HREF})`, `https://evil.example/${'a'.repeat(5_000)}`]
  ])('refuses %s', (_label, href) => {
    expect(checkFragment(withRow(row(anchor(href))), 'cardReading', OPTIONS)).toMatchObject({ok: false, reason: 'url'})
  })

  it('bounds the href length exactly', () => {
    const base = 'https://evil.example/'
    expect(articleHrefAllowed(base + 'a'.repeat(MAX_ARTICLE_HREF - base.length))).toBe(true)
    expect(articleHrefAllowed(base + 'a'.repeat(MAX_ARTICLE_HREF - base.length + 1))).toBe(false)
  })

  it.each([
    ['without target', 'rel="noopener noreferrer"', 'article-list-title', 'url'],
    ['without rel', 'target="_blank"', 'article-list-title', 'attribute'],
    ['with rel noopener alone', 'target="_blank" rel="noopener"', 'article-list-title', 'url'],
    ['with rel in another order', 'target="_blank" rel="noreferrer noopener"', 'article-list-title', 'url'],
    ['with another class', 'target="_blank" rel="noopener noreferrer"', 'article-list-source', 'url'],
    ['with a second class', 'target="_blank" rel="noopener noreferrer"', 'article-list-title article-list-source', 'url']
  ])('refuses an any-host link %s', (_label, attributes, className, reason) => {
    expect(checkFragment(withRow(row(anchor(ARTICLE, attributes, className))), 'cardReading', OPTIONS)).toMatchObject({ok: false, reason})
  })

  it('refuses the article class on an any-host link outside cardReading', () => {
    const books = ARTIFACT.fragments.cardBooks
    const open = books.indexOf('>') + 1
    const injected = books.slice(0, open) + anchor(ARTICLE) + books.slice(open)
    // `class` is checked first: the article class is not a Bookshelf token.
    expect(checkFragment(injected, 'cardBooks', OPTIONS)).toMatchObject({ok: false})
    // Without the class, the any-host href is refused on its own.
    const bare = books.slice(0, open) + `<a href="${ARTICLE}" target="_blank" rel="noopener noreferrer">x</a>` + books.slice(open)
    expect(checkFragment(bare, 'cardBooks', OPTIONS)).toMatchObject({ok: false, reason: 'url'})
  })

  it('refuses the any-host href on another element of cardReading', () => {
    const html = withRow(`<li class="article-list-item"><span class="article-list-title" href="${ARTICLE}">x</span></li>`)
    expect(checkFragment(html, 'cardReading', OPTIONS)).toMatchObject({ok: false, reason: 'attribute'})
  })

  it.each([
    ['a raw angle bracket', '<b>x</b>'],
    ['an invalid character reference', '&bogus;'],
    [`more than ${MAX_TITLE} characters`, 'x'.repeat(MAX_TITLE + 1)]
  ])('refuses a note title with %s', (_label, title) => {
    const html = withRow(`<li class="article-list-item"><span class="article-list-note" title="${title}"></span></li>`)
    expect(checkFragment(html, 'cardReading', OPTIONS)).toMatchObject({ok: false, reason: 'attribute'})
  })

  it.each([
    ['an upper-case REL', 'target="_blank" REL="noopener noreferrer"', 'attribute'],
    ['an upper-case Target', 'Target="_blank" rel="noopener noreferrer"', 'attribute'],
    ['an entity-encoded target', 'target="&#95;blank" rel="noopener noreferrer"', 'url'],
    ['an entity-encoded rel', 'target="_blank" rel="noopener&#32;noreferrer"', 'attribute'],
    ['a duplicate rel', 'target="_blank" rel="noopener noreferrer" rel="noopener noreferrer"', 'attribute']
  ])('refuses an any-host link with %s', (_label, attributes, reason) => {
    expect(checkFragment(withRow(row(anchor(ARTICLE, attributes))), 'cardReading', OPTIONS)).toMatchObject({ok: false, reason})
  })

  it.each([
    ['an upper-case CLASS', `<a CLASS="article-list-title" href="${ARTICLE}" target="_blank" rel="noopener noreferrer">x</a>`, 'attribute'],
    ['an entity-encoded class', `<a class="article&#45;list-title" href="${ARTICLE}" target="_blank" rel="noopener noreferrer">x</a>`, 'url']
  ])('refuses an any-host link with %s', (_label, link, reason) => {
    expect(checkFragment(withRow(row(link)), 'cardReading', OPTIONS)).toMatchObject({ok: false, reason})
  })

  it('refuses `title` on an element other than `span`', () => {
    const html = withRow(`<li class="article-list-item" title="x"></li>`)
    expect(checkFragment(html, 'cardReading', OPTIONS)).toMatchObject({ok: false, reason: 'attribute'})
  })
})
