import {describe, expect, it} from 'vitest'
import {evaluateBeacons, evaluateIngestion, eventTotal, saEventsQueryUrl, syntheticEventPayload} from '../checks/b6-check-analytics.mjs'

function fullSeen(overrides: Record<string, {status: number; url: string}> = {}): Map<string, {status: number; url: string}> {
  const base = new Map([
    ['cf-insights-js', {status: 200, url: 'https://jonathanlloyd.me/cf-insights.js'}],
    ['cf-rum', {status: 204, url: 'https://jonathanlloyd.me/cf-rum'}],
    ['sa-script', {status: 200, url: 'https://jonathanlloyd.me/sa'}],
    ['sa-pageview-pixel', {status: 202, url: 'https://jonathanlloyd.me/simple/simple.gif'}]
  ])
  for (const [k, v] of Object.entries(overrides)) {
    base.set(k, v)
  }
  return base
}

describe('evaluateBeacons', () => {
  it('all four beacons present with their real observed status codes produce zero findings', () => {
    expect(evaluateBeacons(fullSeen())).toEqual([])
  })

  it('a beacon that never fired within the wait window fails as missing', () => {
    const seen = fullSeen()
    seen.delete('sa-script')
    const findings = evaluateBeacons(seen)
    expect(findings).toEqual([expect.objectContaining({severity: 'fail', id: 'analytics-sa-script-missing'})])
  })

  it('known-answer: the SA pageview pixel returning 200 instead of the real 202 contract fails with a specific message', () => {
    const seen = fullSeen({'sa-pageview-pixel': {status: 200, url: 'https://jonathanlloyd.me/simple/simple.gif'}})
    const findings = evaluateBeacons(seen)
    expect(findings).toEqual([expect.objectContaining({severity: 'fail', id: 'analytics-sa-pageview-pixel-status'})])
    expect(findings[0].message).toContain('202')
  })

  it('cf-rum returning a non-2xx status fails', () => {
    const seen = fullSeen({'cf-rum': {status: 500, url: 'https://jonathanlloyd.me/cf-rum'}})
    const findings = evaluateBeacons(seen)
    expect(findings).toEqual([expect.objectContaining({severity: 'fail', id: 'analytics-cf-rum-status'})])
  })
})

describe('saEventsQueryUrl', () => {
  it('queries a named event count with UTC pinned and a bounded window', () => {
    const url = new URL(saEventsQueryUrl('jonathanlloyd.me', 'audit_ingestion_probe', 1))
    expect(url.origin + url.pathname).toBe('https://simpleanalytics.com/jonathanlloyd.me.json')
    // events= is how SA returns per-event counts (fields=events is NOT valid;
    // the empirically-correct shape is fields=pageviews + events=<name>).
    expect(url.searchParams.get('events')).toBe('audit_ingestion_probe')
    expect(url.searchParams.get('fields')).toBe('pageviews')
    // timezone MUST be pinned (SA defaults to the site's dashboard tz).
    expect(url.searchParams.get('timezone')).toBe('UTC')
    expect(url.searchParams.get('start')).toBe('today-1d')
    expect(url.searchParams.get('end')).toBe('today')
    expect(url.searchParams.get('version')).toBe('6')
  })
})

describe('eventTotal', () => {
  const name = 'audit_ingestion_probe'
  it('extracts the total for a matching event', () => {
    expect(eventTotal({ok: true, events: [{name, total: 3}]}, name)).toBe(3)
  })
  it('returns 0 when the event is absent or events is missing', () => {
    expect(eventTotal({ok: true, events: [{name: 'other', total: 9}]}, name)).toBe(0)
    expect(eventTotal({ok: true}, name)).toBe(0)
    expect(eventTotal(null, name)).toBe(0)
  })
})

describe('syntheticEventPayload', () => {
  it('builds a server-side SA event body (type=event, not pageview, to avoid distorting pageview metrics)', () => {
    const ua = 'Mozilla/5.0 ... Chrome/148.0.0.0 Safari/537.36'
    expect(syntheticEventPayload('jonathanlloyd.me', 'audit_ingestion_probe', ua)).toEqual({
      type: 'event',
      hostname: 'jonathanlloyd.me',
      event: 'audit_ingestion_probe',
      ua,
      unique: true
    })
  })
})

describe('evaluateIngestion', () => {
  const base = {eventName: 'audit_ingestion_probe', timeoutMs: 180_000}

  it('after > before -> confirmed (info, carries the measured latency)', () => {
    const findings = evaluateIngestion({...base, before: 4, after: 5, elapsedMs: 21_000})
    expect(findings).toEqual([expect.objectContaining({severity: 'info', id: 'analytics-sa-ingestion-confirmed'})])
    expect(findings[0].message).toContain('4 -> 5')
    expect(findings[0].message).toContain('~21s')
  })

  it('count never increased within the timeout -> fail (not observed)', () => {
    const findings = evaluateIngestion({...base, before: 4, after: 4, elapsedMs: 180_000})
    expect(findings).toEqual([expect.objectContaining({severity: 'fail', id: 'analytics-sa-ingestion-not-observed'})])
  })

  it('a pre-resolved I/O error is surfaced with its own id (e.g. bad API key)', () => {
    const findings = evaluateIngestion({...base, error: {id: 'analytics-sa-stats-api-error', message: 'SA Stats API error (HTTP 401)'}})
    expect(findings).toEqual([{severity: 'fail', id: 'analytics-sa-stats-api-error', message: 'SA Stats API error (HTTP 401)'}])
  })

  it('a failed synthetic POST is surfaced as post-failed (never a silent pass)', () => {
    const findings = evaluateIngestion({...base, error: {id: 'analytics-sa-ingestion-post-failed', message: 'could not POST'}})
    expect(findings).toEqual([expect.objectContaining({severity: 'fail', id: 'analytics-sa-ingestion-post-failed'})])
  })
})
