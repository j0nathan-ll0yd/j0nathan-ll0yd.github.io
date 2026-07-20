import {describe, expect, it} from 'vitest'
import {evaluateBeacons} from '../../scripts/audit/check-analytics.mjs'

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
