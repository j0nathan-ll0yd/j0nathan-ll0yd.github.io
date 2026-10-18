import {describe, expect, it} from 'vitest'
import {DEFAULT_BUDGET_MS} from '../lib/http.mjs'
import {httpsRedirectProbes, judgeHttpsRedirect, runHttpsRedirectArm, validateHeaders} from '../checks/b7-check-headers.mjs'

const GOLDEN_CSP = "default-src 'self'; script-src 'self';"
const TRUSTED_TYPES = "require-trusted-types-for 'script'; report-uri /api/csp-report; report-to csp-endpoint"

function headers(overrides: Record<string, string> = {}): Headers {
  return new Headers({'content-security-policy': GOLDEN_CSP, 'content-security-policy-report-only': TRUSTED_TYPES, ...overrides})
}

describe('validateHeaders', () => {
  it('a live CSP matching the golden, with Trusted Types present, produces zero findings', () => {
    expect(validateHeaders(headers(), GOLDEN_CSP)).toEqual([])
  })

  it('a missing CSP header fails', () => {
    const h = new Headers({'content-security-policy-report-only': TRUSTED_TYPES})
    const findings = validateHeaders(h, GOLDEN_CSP)
    expect(findings.map((f) => f.id)).toContain('headers-csp-missing')
  })

  it('known-answer: a CSP that drifted from the golden fails, quoting both values', () => {
    const findings = validateHeaders(headers({'content-security-policy': "default-src 'none';"}), GOLDEN_CSP)
    expect(findings).toHaveLength(1)
    expect(findings[0].id).toBe('headers-csp-drift')
    expect(findings[0].message).toContain("default-src 'none'")
    expect(findings[0].message).toContain(GOLDEN_CSP)
  })

  it('a missing Trusted Types report-only directive fails', () => {
    const findings = validateHeaders(headers({'content-security-policy-report-only': ''}), GOLDEN_CSP)
    expect(findings.map((f) => f.id)).toContain('headers-trusted-types-missing')
  })
})

const ROOT = {url: 'http://jonathanlloyd.me/', allowed: ['https://jonathanlloyd.me/']}
const DEEP = {url: 'http://jonathanlloyd.me/privacy?b7=1', allowed: ['https://jonathanlloyd.me/privacy?b7=1']}
// Captured 2026-10-18 from http://www.jonathanlloyd.me/ (162 bytes).
const REDIRECT_BODY =
  '<html>\r\n<head><title>301 Moved Permanently</title></head>\r\n<body>\r\n<center><h1>301 Moved Permanently</h1></center>\r\n<hr><center>nginx</center>\r\n</body>\r\n</html>\r\n'
'<html>\r\n<head><title>301 Moved Permanently</title></head>\r\n<body>\r\n<center><h1>301 Moved Permanently</h1></center>\r\n<hr><center>cloudflare</center>\r\n</body>\r\n</html>\r\n'

function answer(status: number, headers: Record<string, string> = {}, body = ''): Response {
  return new Response(status === 204 ? null : body, {status, headers})
}

/** A fetch stand-in keyed by URL; it records the init so the no-follow rule is checked. */
function fakeFetch(byUrl: Record<string, () => Response>) {
  const calls: {url: string; init: RequestInit}[] = []
  const impl = async (url: string, init: RequestInit) => {
    calls.push({url, init})
    const make = byUrl[url]
    if (!make) {
      throw new TypeError(`fetch failed: no stand-in for ${url}`)
    }
    return make()
  }
  return {impl, calls}
}

describe('httpsRedirectProbes', () => {
  it('covers the root, the gated llms.txt proxy and a deep path with a query, on the apex and on www', () => {
    const probes = httpsRedirectProbes()
    expect(probes.map((p: {url: string}) => p.url)).toEqual([
      'http://jonathanlloyd.me/',
      'http://jonathanlloyd.me/llms.txt',
      'http://jonathanlloyd.me/privacy?b7=1',
      'http://www.jonathanlloyd.me/',
      'http://www.jonathanlloyd.me/llms.txt',
      'http://www.jonathanlloyd.me/privacy?b7=1'
    ])
    expect(probes[2].allowed).toEqual(['https://jonathanlloyd.me/privacy?b7=1'])
    expect(probes[5].allowed).toEqual(['https://www.jonathanlloyd.me/privacy?b7=1', 'https://jonathanlloyd.me/privacy?b7=1'])
  })
})

describe('judgeHttpsRedirect', () => {
  it('a 301 with the exact https Location and a minimal body passes', () => {
    expect(judgeHttpsRedirect(ROOT, {status: 301, location: 'https://jonathanlloyd.me/', ssrData: null, bodyBytes: 162})).toEqual([])
  })

  it('a 308 with the exact https Location passes', () => {
    expect(judgeHttpsRedirect(DEEP, {status: 308, location: 'https://jonathanlloyd.me/privacy?b7=1', ssrData: null, bodyBytes: 0})).toEqual([])
  })

  it('known-answer (2026-10-18 production): a 200 with X-SSR-Data and the full page fails, naming the URL and the status', () => {
    const findings = judgeHttpsRedirect(ROOT, {status: 200, location: null, ssrData: 'live', bodyBytes: 194161})
    expect(findings.map((f: {id: string}) => f.id)).toEqual(['headers-http-not-redirected', 'headers-http-ssr-data', 'headers-http-body'])
    for (const f of findings) {
      expect(f.severity).toBe('fail')
      expect(f.message).toContain('http://jonathanlloyd.me/')
      expect(f.message).toContain('HTTP 200')
    }
  })

  it('a 302 is not an accepted redirect status', () => {
    const findings = judgeHttpsRedirect(ROOT, {status: 302, location: 'https://jonathanlloyd.me/', ssrData: null, bodyBytes: 0})
    expect(findings.map((f: {id: string}) => f.id)).toEqual(['headers-http-not-redirected'])
  })

  it.each([
    ['a wrong host', 'https://example.com/privacy?b7=1'],
    ['an http Location (a plaintext hop)', 'http://jonathanlloyd.me/privacy?b7=1'],
    ['a dropped path', 'https://jonathanlloyd.me/'],
    ['a dropped query', 'https://jonathanlloyd.me/privacy'],
    ['a relative Location', '/privacy?b7=1']
  ])('a redirect with %s fails', (_label, location) => {
    const findings = judgeHttpsRedirect(DEEP, {status: 301, location, ssrData: null, bodyBytes: 0})
    expect(findings).toHaveLength(1)
    expect(findings[0].id).toBe('headers-http-redirect-location')
    expect(findings[0].message).toContain(DEEP.url)
    expect(findings[0].message).toContain(location)
  })

  it('a redirect with no Location fails', () => {
    const findings = judgeHttpsRedirect(ROOT, {status: 301, location: null, ssrData: null, bodyBytes: 0})
    expect(findings.map((f: {id: string}) => f.id)).toEqual(['headers-http-redirect-location'])
    expect(findings[0].message).toContain('(none)')
  })

  it('the body limit is 1024 bytes: 1024 passes, 1025 fails', () => {
    const ok = {status: 301, location: 'https://jonathanlloyd.me/', ssrData: null}
    expect(judgeHttpsRedirect(ROOT, {...ok, bodyBytes: 1024})).toEqual([])
    expect(judgeHttpsRedirect(ROOT, {...ok, bodyBytes: 1025}).map((f: {id: string}) => f.id)).toEqual(['headers-http-body'])
  })

  it('a correct redirect that still carries X-SSR-Data or a page body fails', () => {
    const findings = judgeHttpsRedirect(ROOT, {status: 301, location: 'https://jonathanlloyd.me/', ssrData: 'live', bodyBytes: 5000})
    expect(findings.map((f: {id: string}) => f.id)).toEqual(['headers-http-ssr-data', 'headers-http-body'])
  })

  it('www may redirect to its own https origin or straight to the apex, path and query kept', () => {
    const www = httpsRedirectProbes()[5]
    for (const location of ['https://www.jonathanlloyd.me/privacy?b7=1', 'https://jonathanlloyd.me/privacy?b7=1']) {
      expect(judgeHttpsRedirect(www, {status: 301, location, ssrData: null, bodyBytes: 162})).toEqual([])
    }
  })

  it('known-answer (2026-10-18 production): www redirecting to the http apex fails', () => {
    const www = httpsRedirectProbes()[5]
    const findings = judgeHttpsRedirect(www, {status: 301, location: 'http://jonathanlloyd.me/privacy?b7=1', ssrData: null, bodyBytes: 162})
    expect(findings.map((f: {id: string}) => f.id)).toEqual(['headers-http-redirect-location'])
  })
})

describe('runHttpsRedirectArm', () => {
  it('the captured redirect body is 162 bytes', () => {
    expect(new TextEncoder().encode(REDIRECT_BODY).byteLength).toBe(162)
  })

  it('passes the shared budget to the fetch', async () => {
    const {impl, calls} = fakeFetch({[ROOT.url]: () => answer(301, {location: 'https://jonathanlloyd.me/'})})
    const seen: unknown[] = []
    await runHttpsRedirectArm({
      fetchImpl: async (url: string, init: RequestInit, budget: unknown) => {
        seen.push(budget)
        return impl(url, init)
      },
      probes: [ROOT]
    })
    expect(calls).toHaveLength(1)
    expect(seen).toEqual([DEFAULT_BUDGET_MS])
  })

  it('a 5xx final answer is measured and fails as not redirected', async () => {
    const {impl} = fakeFetch({[ROOT.url]: () => answer(503, {}, 'busy')})
    const result = await runHttpsRedirectArm({fetchImpl: impl, probes: [ROOT]})
    expect(result.measured).toBe(1)
    expect(result.findings.map((f: {id: string}) => f.id)).toEqual(['headers-http-not-redirected'])
    expect(result.findings[0].message).toContain('HTTP 503')
  })

  it('a body that breaks after the status is held stays measured, judged on status and headers, with a warn', async () => {
    const broken = new ReadableStream({
      start(controller) {
        controller.error(new Error('socket hang up'))
      }
    })
    const {impl} = fakeFetch({[ROOT.url]: () => new Response(broken, {status: 200, headers: {'x-ssr-data': 'live'}})})
    const result = await runHttpsRedirectArm({fetchImpl: impl, probes: [ROOT]})
    expect(result.measured).toBe(1)
    expect(result.findings.map((f: {id: string; severity: string}) => `${f.severity}:${f.id}`)).toEqual([
      'warn:headers-http-body-unreadable',
      'fail:headers-http-not-redirected',
      'fail:headers-http-ssr-data'
    ])
  })

  it('counts every held answer, passes correct redirects, and never follows them', async () => {
    const {impl, calls} = fakeFetch({
      [ROOT.url]: () => answer(301, {location: 'https://jonathanlloyd.me/'}, REDIRECT_BODY),
      [DEEP.url]: () => answer(308, {location: 'https://jonathanlloyd.me/privacy?b7=1'})
    })
    const result = await runHttpsRedirectArm({fetchImpl: impl, probes: [ROOT, DEEP]})
    expect(result).toEqual({measured: 2, findings: []})
    expect(calls.map((c) => c.init.redirect)).toEqual(['manual', 'manual'])
  })

  it('a 200 over http:// is measured and fails', async () => {
    const {impl} = fakeFetch({[ROOT.url]: () => answer(200, {'x-ssr-data': 'live', 'content-type': 'text/html'}, 'x'.repeat(4096))})
    const result = await runHttpsRedirectArm({fetchImpl: impl, probes: [ROOT]})
    expect(result.measured).toBe(1)
    expect(result.findings.map((f: {id: string}) => f.id)).toEqual(['headers-http-not-redirected', 'headers-http-ssr-data', 'headers-http-body'])
  })

  it('a network error is UNMEASURED: a fail finding and no count, never a pass', async () => {
    const {impl} = fakeFetch({[ROOT.url]: () => answer(301, {location: 'https://jonathanlloyd.me/'})})
    const result = await runHttpsRedirectArm({fetchImpl: impl, probes: [ROOT, DEEP]})
    expect(result.measured).toBe(1)
    expect(result.findings).toHaveLength(1)
    expect(result.findings[0].id).toBe('headers-http-unmeasured')
    expect(result.findings[0].severity).toBe('fail')
    expect(result.findings[0].message).toContain(DEEP.url)
  })

  it('every probe failing on the network measures 0', async () => {
    const {impl} = fakeFetch({})
    const result = await runHttpsRedirectArm({fetchImpl: impl, probes: [ROOT, DEEP]})
    expect(result.measured).toBe(0)
    expect(result.findings.map((f: {id: string}) => f.id)).toEqual(['headers-http-unmeasured', 'headers-http-unmeasured'])
  })
})
