// @vitest-environment node
//
// The composer's Reading props (src/lib/composed/reading-links.ts; web 4.3.0, DS #312): a link the
// Worker would refuse is degraded to text and a note title is cut to MAX_TITLE, so one article can
// never turn the composed page off. The end-to-end form (the built composer, the artifact check and
// the oracle parity) is in tests/oracle/composer-parity.test.ts.
import {describe, expect, it} from 'vitest'
import {MAX_TITLE} from '../../src/lib/composed/fragment-policy'
import {articleLinkKept, capNoteText, composableReading} from '../../src/lib/composed/reading-links'
import {READING_LINKS} from '../../src/lib/composed/reading-option'
import {REFUSED_ARTICLE_URLS} from '../shared/refused-article-urls'

function props(url: string | null, noteText: string | null = null) {
  return {state: 'live', reading: {articles: [{title: 'T', source: 'S', date: '1d ago', url, hasNotes: noteText !== null, noteText}]}}
}

describe('composableReading', () => {
  it('reads option A today', () => {
    expect(READING_LINKS).toBe('allow')
  })

  it.each(REFUSED_ARTICLE_URLS)('degrades a link with %s to text, keeping the row', (_label, url) => {
    expect(new URL(url).protocol, 'the DS would link it').toBe('https:')
    expect(articleLinkKept(url)).toBe(false)
    const out = composableReading(props(url))
    expect(out.reading.articles).toHaveLength(1)
    expect(out.reading.articles[0]).toMatchObject({title: 'T', source: 'S', url: null})
  })

  it.each([
    ['an article host', 'https://news.ycombinator.com/item?id=1'],
    ['an allowlisted host', 'https://github.com/j0nathan-ll0yd'],
    ['an upper-case host and the default port', 'https://Example.com:443/a']
  ])('keeps a link to %s', (_label, url) => {
    expect(composableReading(props(url)).reading.articles[0].url).toBe(url)
  })

  it("strips every link under option B ('strip')", () => {
    expect(composableReading(props('https://news.ycombinator.com/item?id=1'), 'strip').reading.articles[0].url).toBeNull()
    expect(articleLinkKept('https://github.com/j0nathan-ll0yd', 'strip')).toBe(false)
  })

  it('cuts a note title above MAX_TITLE and keeps a shorter one whole', () => {
    const long = 'n'.repeat(MAX_TITLE * 2)
    const cut = composableReading(props(null, long)).reading.articles[0].noteText as string
    expect(cut.length).toBeLessThanOrEqual(MAX_TITLE)
    expect(cut.endsWith('…')).toBe(true)
    expect(composableReading(props(null, 'short note')).reading.articles[0].noteText).toBe('short note')
    expect(capNoteText('x'.repeat(MAX_TITLE))).toHaveLength(MAX_TITLE)
  })

  it('never splits a surrogate pair', () => {
    const cut = capNoteText('😀'.repeat(MAX_TITLE))
    expect(cut.length).toBeLessThanOrEqual(MAX_TITLE)
    expect(cut).toMatch(/^(?:😀)+…$/u)
  })

  it('returns props without articles unchanged', () => {
    const empty = {state: 'loading'}
    expect(composableReading(empty)).toBe(empty)
  })
})
