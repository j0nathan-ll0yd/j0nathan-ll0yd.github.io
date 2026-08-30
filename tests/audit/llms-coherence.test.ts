import {describe, expect, it} from 'vitest'
import {compositionTimestamp, evaluateLlmsCoherence, LLMS_COHERENCE_THRESHOLDS} from '../../scripts/audit/lib/llms-coherence'
import type {LlmsCoherenceInput, LlmsResponseSnapshot} from '../../scripts/audit/lib/llms-coherence'
import {rules} from '../../scripts/audit/specs/load.mjs'

const encoder = new TextEncoder()
const NOW = Date.parse('2026-08-29T18:00:00.000Z')
const RECENT = '2026-08-29T17:55:00.000Z'

function snapshot(body: string, contentType: string, status = 200, site = false): LlmsResponseSnapshot {
  return {
    status,
    contentType,
    body: encoder.encode(body),
    cacheControl: site ? 'no-store' : 'public, max-age=300',
    cdnCacheControl: site ? 'no-store' : null,
    cfCacheStatus: site ? 'BYPASS' : null
  }
}

function discoveryBody(timestamp: string): string {
  return `# Site\n\n> Summary\n\n<!-- composed-at: ${timestamp} -->\n`
}

function fullBody(timestamp: string, payload = 'same payload'): string {
  return `# Complete profile\n\n**Generated:** ${timestamp}\n\n${payload}\n`
}

function coherentInput(timestamp = RECENT): LlmsCoherenceInput {
  const discovery = discoveryBody(timestamp)
  const full = fullBody(timestamp)
  return {
    'llms.txt': {origin: snapshot(discovery, 'text/markdown; charset=utf-8'), site: snapshot(discovery, 'text/plain; charset=utf-8', 200, true)},
    'llms-full.txt': {origin: snapshot(full, 'text/markdown; charset=utf-8'), site: snapshot(full, 'text/markdown; charset=utf-8', 200, true)},
    'index.md': {origin: snapshot(full, 'text/markdown; charset=utf-8'), site: snapshot(full, 'text/markdown; charset=utf-8', 200, true)}
  }
}

describe('compositionTimestamp', () => {
  it('reads both composer timestamp formats', () => {
    expect(compositionTimestamp(encoder.encode(discoveryBody(RECENT)))).toBe(Date.parse(RECENT))
    expect(compositionTimestamp(encoder.encode(fullBody(RECENT)))).toBe(Date.parse(RECENT))
  })

  it('rejects absent, invalid, and non-UTF-8 timestamps', () => {
    expect(compositionTimestamp(encoder.encode('# no timestamp'))).toBeNull()
    expect(compositionTimestamp(encoder.encode('**Generated:** invalid'))).toBeNull()
    expect(compositionTimestamp(Uint8Array.of(0xff))).toBeNull()
  })
})

describe('evaluateLlmsCoherence', () => {
  // covers: llms-txt#Raw and canonical llms artifacts stay coherent
  it('accepts fresh, typed, synchronized, byte-identical artifacts', () => {
    expect(evaluateLlmsCoherence(coherentInput(), NOW)).toEqual([])
    expect(LLMS_COHERENCE_THRESHOLDS).toEqual({
      maxCompositionAgeMs: 4 * 60 * 60 * 1000,
      maxCompositionSkewMs: 10 * 60 * 1000,
      maxFutureSkewMs: 5 * 60 * 1000
    })
  })

  it('reports status, content-type, and composition timestamp failures with artifact evidence', () => {
    const input = coherentInput()
    input['llms.txt'].origin = snapshot('# missing timestamp', 'text/plain', 503)

    const findings = evaluateLlmsCoherence(input, NOW)
    expect(findings).toEqual(expect.arrayContaining([
      expect.objectContaining({id: 'llms-origin-status', artifact: 'llms.txt', message: expect.stringContaining('HTTP 503')}),
      expect.objectContaining({id: 'llms-origin-content-type', artifact: 'llms.txt'}),
      expect.objectContaining({id: 'llms-origin-composition-time', artifact: 'llms.txt'})
    ]))
  })

  // covers: llms-txt#Full-content artifacts stay fresh
  it('enforces composition age and bounded origin-to-site skew as pure time comparisons', () => {
    const llmsRules = rules('llms-txt')
    expect(llmsRules['llms-full-txt-stale'].params.maxAgeHours * 3_600_000).toBe(LLMS_COHERENCE_THRESHOLDS.maxCompositionAgeMs)
    expect(llmsRules['index-md-stale'].params.maxAgeHours * 3_600_000).toBe(LLMS_COHERENCE_THRESHOLDS.maxCompositionAgeMs)

    expect(evaluateLlmsCoherence(coherentInput('2026-08-29T14:00:00.000Z'), NOW)).toEqual([])
    expect(evaluateLlmsCoherence(coherentInput('2026-08-29T13:59:59.999Z'), NOW)).toEqual(
      expect.arrayContaining([expect.objectContaining({id: 'llms-origin-stale'})])
    )

    const input = coherentInput()
    input['llms-full.txt'].site = snapshot(fullBody('2026-08-29T13:00:00.000Z'), 'text/markdown; charset=utf-8', 200, true)

    const findings = evaluateLlmsCoherence(input, NOW)
    expect(findings).toEqual(expect.arrayContaining([
      expect.objectContaining({id: 'llms-site-stale', artifact: 'llms-full.txt'}),
      expect.objectContaining({id: 'llms-origin-site-skew', artifact: 'llms-full.txt'})
    ]))
  })

  it('reports same-timestamp origin/site and full/index byte mismatches', () => {
    const input = coherentInput()
    input['llms-full.txt'].site = snapshot(fullBody(RECENT, 'site drift'), 'text/markdown; charset=utf-8', 200, true)
    input['index.md'].origin = snapshot(fullBody(RECENT, 'origin alias drift'), 'text/markdown; charset=utf-8')

    const findings = evaluateLlmsCoherence(input, NOW)
    expect(findings).toHaveLength(4)
    expect(findings.filter(({id}) => id === 'llms-origin-site-bytes')).toHaveLength(2)
    expect(findings.filter(({id}) => id === 'llms-full-index-bytes')).toHaveLength(2)
  })

  it('accepts adjacent fresh generations inside the convergence window without claiming byte corruption', () => {
    const input = coherentInput()
    const previous = '2026-08-29T17:45:00.000Z'
    input['llms-full.txt'].site = snapshot(fullBody(previous, 'previous generation'), 'text/markdown; charset=utf-8', 200, true)
    input['index.md'].origin = snapshot(fullBody(previous, 'previous generation'), 'text/markdown; charset=utf-8')
    input['index.md'].site = snapshot(fullBody(previous, 'previous generation'), 'text/markdown; charset=utf-8', 200, true)

    expect(evaluateLlmsCoherence(input, NOW)).toEqual([])
  })

  it('rejects excessive origin/site and full/index composition skew without byte findings across generations', () => {
    const input = coherentInput()
    input['llms-full.txt'].site = snapshot(fullBody('2026-08-29T17:44:00.000Z', 'previous generation'), 'text/markdown; charset=utf-8', 200, true)

    const findings = evaluateLlmsCoherence(input, NOW)
    expect(findings).toEqual(expect.arrayContaining([
      expect.objectContaining({id: 'llms-origin-site-skew', artifact: 'llms-full.txt'}),
      expect.objectContaining({id: 'llms-full-index-skew', artifact: 'llms-full.txt/index.md'})
    ]))
    expect(findings).toHaveLength(2)
    expect(findings.some(({id}) => id.endsWith('-bytes'))).toBe(false)
  })

  it('rejects composition times beyond the future clock allowance', () => {
    const input = coherentInput('2026-08-29T18:06:00.000Z')
    expect(evaluateLlmsCoherence(input, NOW)).toEqual(expect.arrayContaining([
      expect.objectContaining({id: 'llms-origin-composition-future'}),
      expect.objectContaining({id: 'llms-site-composition-future'})
    ]))
  })

  it('rejects canonical responses retained by an outer cache', () => {
    const input = coherentInput()
    input['llms.txt'].site.cacheControl = 'public, max-age=600'
    input['llms.txt'].site.cdnCacheControl = null
    input['llms.txt'].site.cfCacheStatus = 'HIT'

    expect(evaluateLlmsCoherence(input, NOW)).toEqual(expect.arrayContaining([
      expect.objectContaining({id: 'llms-site-browser-cache-policy', artifact: 'llms.txt'}),
      expect.objectContaining({id: 'llms-site-cdn-cache-policy', artifact: 'llms.txt'}),
      expect.objectContaining({id: 'llms-site-edge-cache-status', artifact: 'llms.txt'})
    ]))
  })
})
