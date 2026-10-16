import {describe, expect, it, vi} from 'vitest'
import {
  judgeProbes,
  judgeResponse,
  mediaTypeOf,
  MISSING_PATH_PREFIX,
  missingPath,
  PROBES,
  runProbes,
  varyNamesAccept
} from '../checks/b2-check-not-found.mjs'
import {NOT_FOUND_MARKDOWN} from '../../src/lib/edge/not-found-markdown.mjs'

const [MARKDOWN, HTML] = PROBES
const SITE_USAGE = 'train-ai=n, search=y'
const log = () => {}

// The 2026-10-16 production answers, recorded by curl.
const markdown404 = {status: 404, contentType: 'text/markdown; charset=utf-8', vary: 'Accept', contentUsage: SITE_USAGE, body: NOT_FOUND_MARKDOWN}
const html404 = {
  status: 404,
  contentType: 'text/html; charset=utf-8',
  vary: 'Accept',
  contentUsage: SITE_USAGE,
  body: '<!DOCTYPE html><html lang="en"></html>'
}

describe('probes', () => {
  it('asks for markdown and for HTML, and names a path unique to the run', () => {
    expect(PROBES.map((p: {accept: string}) => p.accept)).toEqual(['text/markdown', 'text/html'])
    expect(missingPath('abc')).toBe(`${MISSING_PATH_PREFIX}abc`)
    expect(missingPath()).toMatch(/^\/__audit-not-found-[0-9a-z]+$/)
  })
})

describe('mediaTypeOf and varyNamesAccept', () => {
  it.each([
    ['text/markdown; charset=utf-8', 'text/markdown'],
    ['Text/HTML', 'text/html'],
    [null, '']
  ])('%j is %j', (value, mediaType) => {
    expect(mediaTypeOf(value)).toBe(mediaType)
  })

  it.each([
    ['Accept', true],
    ['Accept-Encoding, accept', true],
    ['*', true],
    ['Accept-Encoding', false],
    [null, false]
  ])('Vary %j names Accept: %s', (vary, names) => {
    expect(varyNamesAccept(vary)).toBe(names)
  })
})

describe('judgeResponse', () => {
  it('accepts the deployed markdown 404 and the deployed HTML 404', () => {
    expect(judgeResponse(MARKDOWN, markdown404)).toEqual([])
    expect(judgeResponse(HTML, html404)).toEqual([])
  })

  it('rejects the HTML page served to a markdown Accept (the middleware branch is gone)', () => {
    expect(judgeResponse(MARKDOWN, html404)).toEqual([
      'Content-Type "text/html; charset=utf-8", expected text/markdown',
      'the markdown body does not open with a heading'
    ])
  })

  it('rejects a markdown 404 that answers 200 (a soft 404)', () => {
    expect(judgeResponse(MARKDOWN, {...markdown404, status: 200})).toEqual(['HTTP 200, expected 404'])
  })

  it('rejects a 404 without Vary: Accept, and one the site never wrote', () => {
    expect(judgeResponse(HTML, {...html404, vary: null, contentUsage: null})).toEqual([
      'no Content-Usage header, so the site never answered it (the zone or another layer did)',
      'Vary null does not name Accept, so a cache can serve one representation for the other'
    ])
  })

  it('rejects markdown served to an HTML Accept', () => {
    expect(judgeResponse(HTML, markdown404)).toEqual([
      'Content-Type "text/markdown; charset=utf-8", expected text/html',
      'the HTML body does not open with <!DOCTYPE html>'
    ])
  })
})

describe('judgeProbes', () => {
  const url = 'https://jonathanlloyd.me/__audit-not-found-x'

  it('is clean and measures both when both 404s hold', () => {
    expect(judgeProbes([{probe: MARKDOWN, url, response: markdown404}, {probe: HTML, url, response: html404}])).toEqual({
      findings: [],
      measured: 2,
      issueOutcome: 'success'
    })
  })

  it('fails the probe that broke and still counts it as measured', () => {
    const {findings, measured, issueOutcome} = judgeProbes([{probe: MARKDOWN, url, response: html404}, {probe: HTML, url, error: 'fetch failed'}])
    expect(measured).toBe(1)
    // A judged defect files even when the sibling probe went unanswered.
    expect(issueOutcome).toBe('failure')
    expect(findings.map((f: {id: string}) => f.id)).toEqual(['not-found-markdown', 'not-found-indeterminate'])
    expect(findings[0].message).toContain('Accept: text/markdown')
  })

  it('reports an unanswered probe as INDETERMINATE and does not count it, so a dark run measures 0', () => {
    const {findings, measured, issueOutcome} = judgeProbes([{probe: MARKDOWN, url, error: 'fetch failed'}, {probe: HTML, url, error: 'fetch failed'}])
    expect(measured).toBe(0)
    // Unanswered is not a defect: the managed issue stays as it stands.
    expect(issueOutcome).toBe('indeterminate')
    expect(findings.map((f: {id: string}) => f.id)).toEqual(['not-found-indeterminate', 'not-found-indeterminate'])
    expect(findings[0].message).toMatch(/^INDETERMINATE/)
  })
})

describe('runProbes', () => {
  it('sends each Accept to the same missing path and records the answer', async () => {
    const fetchImpl = vi.fn(async (_url: string, init?: RequestInit) =>
      new Headers(init?.headers).get('Accept') === 'text/markdown'
        ? new Response(markdown404.body, {status: 404, headers: {'Content-Type': markdown404.contentType, Vary: 'Accept', 'Content-Usage': SITE_USAGE}})
        : new Response(html404.body, {status: 404, headers: {'Content-Type': html404.contentType, Vary: 'Accept', 'Content-Usage': SITE_USAGE}})
    )

    const outcomes = await runProbes('/__audit-not-found-x', {fetchImpl, log})

    expect(fetchImpl).toHaveBeenNthCalledWith(1, 'https://jonathanlloyd.me/__audit-not-found-x', {headers: {Accept: 'text/markdown'}, redirect: 'manual'},
      expect.any(Number))
    expect(judgeProbes(outcomes)).toEqual({findings: [], measured: 2, issueOutcome: 'success'})
  })

  it('turns a transport failure into an outcome with an error, never a pass', async () => {
    const fetchImpl = vi.fn(async () => {
      throw new Error('ECONNRESET')
    })
    const outcomes = await runProbes('/__audit-not-found-x', {fetchImpl, log})
    expect(outcomes.map((o: {error?: string}) => o.error)).toEqual(['ECONNRESET', 'ECONNRESET'])
  })
})
