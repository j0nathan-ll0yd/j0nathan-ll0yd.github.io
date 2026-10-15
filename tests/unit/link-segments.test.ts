import {describe, expect, it} from 'vitest'
import {SITE_URL} from '@j0nathan-ll0yd/portal-contract/constants'
import {linkSegments} from '../../src/lib/link-segments'

describe('linkSegments', () => {
  it('returns plain text unchanged as one segment', () => {
    expect(linkSegments('No links here.')).toEqual([{text: 'No links here.'}])
  })

  it('links a site URL and keeps the text around it', () => {
    expect(linkSegments(`${SITE_URL}/openapi.json describes every export.`)).toEqual([
      {text: `${SITE_URL}/openapi.json`, href: `${SITE_URL}/openapi.json`},
      {text: ' describes every export.'}
    ])
  })

  it('leaves trailing sentence punctuation outside the link', () => {
    expect(linkSegments(`The card is at ${SITE_URL}/mcp/server-card.`)).toEqual([
      {text: 'The card is at '},
      {text: `${SITE_URL}/mcp/server-card`, href: `${SITE_URL}/mcp/server-card`},
      {text: '.'}
    ])
  })

  it('links several URLs in one sentence, including a list separated by commas', () => {
    const segments = linkSegments(`${SITE_URL}/feed.xml (RSS 2.0) and ${SITE_URL}/feed.json, then ${SITE_URL}/llms.txt`)
    expect(segments.filter((s) => s.href).map((s) => s.href)).toEqual([`${SITE_URL}/feed.xml`, `${SITE_URL}/feed.json`, `${SITE_URL}/llms.txt`])
    expect(segments.map((s) => s.text).join('')).toBe(`${SITE_URL}/feed.xml (RSS 2.0) and ${SITE_URL}/feed.json, then ${SITE_URL}/llms.txt`)
  })

  it('never links another host', () => {
    expect(linkSegments('See https://example.com/x for more.')).toEqual([{text: 'See https://example.com/x for more.'}])
  })
})
