import {describe, expect, it} from 'vitest'
import {judgeCacheHeaders, judgeMetadata, runMetadata, summarizeStates} from '../checks/b12-check-ssr-metadata.mjs'
import {parsePage} from '../lib/ssr-evidence.mjs'
import {CARD_DOMAINS, makeBodies, type RenderOptions, renderPage} from './ssr-fixtures.ts'

const judge = (options: RenderOptions = {}) => {
  const page = renderPage(makeBodies(), options)
  return judgeMetadata(parsePage(page.html, page.headers), page.status)
}
const ids = (findings: {id: string}[]) => findings.map((f) => f.id)

describe('summarizeStates', () => {
  it('applies the rule in order', () => {
    const live = Array(10).fill('live')
    expect(summarizeStates(live)).toBe('live')
    expect(summarizeStates([...live.slice(1), 'empty'])).toBe('live')
    expect(summarizeStates([...live.slice(1), 'stale'])).toBe('stale')
    expect(summarizeStates([...live.slice(1), 'unavailable'])).toBe('partial')
    expect(summarizeStates([...live.slice(1), 'loading'])).toBe('partial')
    expect(summarizeStates(Array(10).fill('unavailable'))).toBe('unavailable')
    expect(summarizeStates([...live.slice(1), 'suppressed'])).toBe('suppressed')
  })
})

describe('judgeMetadata', () => {
  it('passes a consistent live page', () => {
    expect(judge()).toEqual([])
  })

  it('passes a consistent stale page', () => {
    expect(judge({summary: 'stale', states: {cardReading: 'stale'}})).toEqual([])
  })

  it('passes a consistent partial page', () => {
    expect(judge({summary: 'partial', states: {cardDevLog: 'unavailable'}})).toEqual([])
  })

  it('passes a consistent suppressed page: no data-generated-at anywhere', () => {
    expect(judge({hiding: true})).toEqual([])
  })

  it('passes the Worker fallback page, which has no meta and no dated card', () => {
    const states = Object.fromEntries(Object.keys(CARD_DOMAINS).map((id) => [id, 'loading']))
    expect(judge({summary: 'fallback', noMeta: true, states})).toEqual([])
  })

  it('fails when the header and the meta disagree', () => {
    expect(ids(judge({summary: 'live', metaValue: 'stale'}))).toEqual(['ssr-header-meta-disagree'])
  })

  it('fails when the summary does not follow the ten card states', () => {
    expect(ids(judge({summary: 'live', states: {cardDevLog: 'unavailable'}}))).toEqual(['ssr-summary-mismatch'])
  })

  it('fails when a live card has no data-generated-at', () => {
    const page = renderPage(makeBodies())
    const html = page.html.replace(/ data-generated-at="[^"]*"/, '')
    expect(ids(judgeMetadata(parsePage(html, page.headers), 200))).toEqual(['ssr-generated-at-missing'])
  })

  it('fails when a non-data card carries data-generated-at', () => {
    const page = renderPage(makeBodies(), {states: {cardDevLog: 'unavailable'}, summary: 'partial'})
    const html = page.html.replace('id="cardDevLog" data-ssr-state="unavailable"',
      'id="cardDevLog" data-ssr-state="unavailable" data-generated-at="2026-10-15T00:00:00.000Z"')
    expect(ids(judgeMetadata(parsePage(html, page.headers), 200))).toEqual(['ssr-generated-at-on-non-data-card'])
  })

  it('fails when a suppressed page carries data-generated-at', () => {
    const page = renderPage(makeBodies(), {hiding: true})
    const html = page.html.replace('id="cardHR" data-ssr-state="suppressed"',
      'id="cardHR" data-ssr-state="suppressed" data-generated-at="2026-10-15T00:00:00.000Z"')
    expect(ids(judgeMetadata(parsePage(html, page.headers), 200))).toEqual(['ssr-generated-at-on-non-data-card', 'ssr-suppressed-generated-at'])
  })

  it('fails an invalid timestamp and an invalid state', () => {
    const page = renderPage(makeBodies())
    const html = page.html.replace(/data-generated-at="[^"]*"/, 'data-generated-at="yesterday"').replace('id="cardMovement" data-ssr-state="live"',
      'id="cardMovement" data-ssr-state="ok"')
    expect(ids(judgeMetadata(parsePage(html, page.headers), 200))).toEqual(['ssr-generated-at-invalid', 'ssr-card-state-invalid'])
  })

  it('fails a missing or duplicated card', () => {
    const page = renderPage(makeBodies())
    const missing = page.html.replace('id="cardBooks"', 'id="cardBooksX"')
    expect(ids(judgeMetadata(parsePage(missing, page.headers), 200))).toContain('ssr-card-count')
    const doubled = page.html.replace('</body>', '<div id="cardHR" data-ssr-state="live"></div></body>')
    expect(ids(judgeMetadata(parsePage(doubled, page.headers), 200))).toContain('ssr-card-count')
  })

  it('fails a missing header and a missing meta by name', () => {
    expect(ids(judge({summary: null}))).toEqual(['ssr-header-missing', 'ssr-meta-missing'])
    expect(ids(judge({summary: 'live', noMeta: true}))).toEqual(['ssr-meta-missing'])
  })

  it('fails an unknown header value and a non-200 status', () => {
    expect(ids(judge({summary: 'fresh'}))).toContain('ssr-header-unknown')
    const page = renderPage(makeBodies())
    expect(ids(judgeMetadata(parsePage(page.html, page.headers), 503))).toEqual(['ssr-meta-status'])
  })
})

describe('judgeCacheHeaders', () => {
  it('passes a no-store HTML response and exempts the Worker pages', () => {
    expect(judgeCacheHeaders(renderPage(makeBodies()).headers, 'live')).toEqual([])
    expect(judgeCacheHeaders(new Headers(), 'fallback')).toEqual([])
  })

  it('fails a cacheable render and a wrong content type', () => {
    const headers = new Headers({'content-type': 'text/plain', 'cdn-cache-control': 'max-age=60'})
    expect(ids(judgeCacheHeaders(headers, 'live'))).toEqual(['ssr-cache-header', 'ssr-content-type'])
  })
})

describe('runMetadata', () => {
  it('measures the page it held and succeeds on a consistent one', async () => {
    const result = await runMetadata({fetchPageImpl: async () => renderPage(makeBodies())})
    expect(result).toMatchObject({measured: 1, outcome: 'success'})
  })

  it('reports the data-free shell as a clear failure, not a crash, and still counts the page', async () => {
    const states = Object.fromEntries(['cardHR', 'cardDevLog'].map((id) => [id, 'loading']))
    const result = await runMetadata({fetchPageImpl: async () => renderPage(makeBodies(), {summary: null, states})})
    expect(result.outcome).toBe('failure')
    expect(result.measured).toBe(1)
    expect(ids(result.findings)).toContain('ssr-header-missing')
  })

  it('measures zero when the page cannot be fetched', async () => {
    const result = await runMetadata({
      fetchPageImpl: async () => {
        throw new Error('connect ECONNREFUSED')
      }
    })
    expect(result).toMatchObject({measured: 0, outcome: 'failure'})
  })
})
