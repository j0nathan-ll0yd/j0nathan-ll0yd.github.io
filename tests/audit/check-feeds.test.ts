import {describe, expect, it} from 'vitest'
import {validateFeedXml} from '../../scripts/audit/check-feeds.mjs'

const NOW = new Date('2026-07-16T00:00:00.000Z')

function rss(pubDate: string, extraItems = ''): string {
  return `<?xml version="1.0" encoding="utf-8"?>
<rss version="2.0"><channel>
<title>Example Feed</title>
<link>https://example.com</link>
<description>An example feed</description>
<item><title>First</title><link>https://example.com/1</link><guid>1</guid><pubDate>${pubDate}</pubDate></item>
${extraItems}
</channel></rss>`
}

describe('validateFeedXml', () => {
  it('a conformant, fresh RSS 2.0 feed produces zero findings', () => {
    const findings = validateFeedXml(rss('Thu, 16 Jul 2026 00:00:00 GMT'), NOW)
    expect(findings).toEqual([])
  })

  it('not-well-formed XML fails to parse', () => {
    const findings = validateFeedXml('<rss><channel><title>unclosed', NOW)
    expect(findings.map((f) => f.id)).toContain('feed-xml-parse')
  })

  it('missing the <rss><channel> root fails', () => {
    const findings = validateFeedXml('<foo></foo>', NOW)
    expect(findings).toEqual([expect.objectContaining({severity: 'fail', id: 'feed-xml-shape'})])
  })

  it('a channel missing required fields (link, description) fails', () => {
    const xml = '<rss><channel><title>Only Title</title></channel></rss>'
    const findings = validateFeedXml(xml, NOW)
    const ids = findings.map((f) => f.id)
    expect(ids.filter((id) => id === 'feed-xml-channel-field')).toHaveLength(2)
  })

  it('a channel with no items is a warn', () => {
    const xml = '<rss><channel><title>T</title><link>https://example.com</link><description>D</description></channel></rss>'
    const findings = validateFeedXml(xml, NOW)
    expect(findings).toEqual([expect.objectContaining({severity: 'warn', id: 'feed-xml-no-items'})])
  })

  it('an item missing guid fails', () => {
    const xml = `<rss><channel><title>T</title><link>https://example.com</link><description>D</description>
      <item><title>X</title><link>https://example.com/x</link><pubDate>Thu, 16 Jul 2026 00:00:00 GMT</pubDate></item>
    </channel></rss>`
    const findings = validateFeedXml(xml, NOW)
    expect(findings.map((f) => f.id)).toContain('feed-xml-item-field')
  })

  it('known-answer: a newest item older than the 7-day soft window fails freshness', () => {
    const findings = validateFeedXml(rss('Thu, 01 Jan 2026 00:00:00 GMT'), NOW)
    expect(findings).toEqual([expect.objectContaining({severity: 'fail', id: 'feed-xml-stale'})])
  })

  it('an item just inside the 7-day window passes', () => {
    const sixDaysAgo = new Date(NOW.getTime() - 6 * 86_400_000).toUTCString()
    const findings = validateFeedXml(rss(sixDaysAgo), NOW)
    expect(findings).toEqual([])
  })
})

// decisions/0011 Step 4.5: every validateFeedJson case formerly hand-written
// here (conformant/fresh, missing-fields, bad-version, empty-items,
// item-missing-id, item-missing-content, known-answer-stale) now lives as a
// derived case in specs/feed-json/*.rule.json, exercised against equivalent
// (or, for the freshness boundary, more precise) fixtures by
// tests/audit/spec-cases.test.ts -- deleted here as replacement, not as
// inconvenience. validateFeedXml is out of the B2 pilot's scope (UD2 brought
// in validateFeedJson only) and its tests above are untouched.
