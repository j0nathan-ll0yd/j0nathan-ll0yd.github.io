import {appendFileSync, mkdtempSync, readFileSync} from 'node:fs'
import {tmpdir} from 'node:os'
import path from 'node:path'
import {afterEach, beforeEach, describe, expect, it, vi} from 'vitest'
import {
  checkSaIngestion,
  classifyStatsReadError,
  concludeIngestion,
  evaluateBeacons,
  evaluateIngestion,
  eventTotal,
  INGESTION_OBSERVED_TAIL_MS,
  issueOutcome,
  readEventTotal,
  runAnalyticsCheck,
  saEventsQueryUrl,
  syntheticEventPayload
} from '../checks/b6-check-analytics.mjs'

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

  it('an unmeasured error becomes a warn that keeps unmeasured: true', () => {
    const findings = evaluateIngestion({...base, error: {id: 'x', message: 'UNMEASURED: y', unmeasured: true}})
    expect(findings).toEqual([{severity: 'warn', id: 'x', message: 'UNMEASURED: y', unmeasured: true}])
  })
})

/** A fetch failure shaped like undici's: `TypeError: fetch failed` with the reason on `cause`. */
function fetchFailed(code: string, message = 'fetch failed', causeMessage = `connect ${code}`) {
  return Object.assign(new TypeError(message), {cause: Object.assign(new Error(causeMessage), {code})})
}

describe('classifyStatsReadError (M1: forgive only transport loss)', () => {
  it('reconstructed: the run 38356590370 shape (reset, cause ECONNRESET) reads UNMEASURED', () => {
    // Reconstructed, not captured: the run logged only `fetch failed`. ECONNRESET is what the
    // runner's tcp-reset REJECT floor produces.
    const error = classifyStatsReadError(fetchFailed('ECONNRESET'))
    expect(error).toEqual(expect.objectContaining({id: 'analytics-sa-stats-api-unreachable', unmeasured: true}))
    expect(error.message).toMatch(/^UNMEASURED: /)
    expect(error.message).toContain('cause: ECONNRESET')
  })

  it.each([
    'ECONNREFUSED',
    'ENOTFOUND',
    'EAI_AGAIN',
    'ETIMEDOUT',
    'EHOSTUNREACH',
    'ENETUNREACH',
    'EPIPE',
    'UND_ERR_SOCKET',
    'UND_ERR_CONNECT_TIMEOUT',
    'UND_ERR_HEADERS_TIMEOUT',
    'UND_ERR_BODY_TIMEOUT'
  ])('%s is a transport outage -> UNMEASURED', (code) => {
    expect(classifyStatsReadError(fetchFailed(code)).unmeasured).toBe(true)
  })

  it('a budget TimeoutError reads UNMEASURED and names its reason', () => {
    const error = classifyStatsReadError(Object.assign(new Error('The operation was aborted due to timeout'), {name: 'TimeoutError'}))
    expect(error.unmeasured).toBe(true)
    expect(error.message).toContain('cause: TimeoutError')
  })

  it('an empty cause message falls through to the error name (|| not ??)', () => {
    const error = classifyStatsReadError(Object.assign(new Error('aborted'), {name: 'TimeoutError', cause: {message: ''}}))
    expect(error.message).toContain('cause: TimeoutError')
  })

  it.each([
    ['an invalid Api-Key header byte', new TypeError('Headers.append: "k\u0000" is an invalid header value.')],
    [
      'an invalid URL',
      Object.assign(new TypeError('Failed to parse URL from nope'), {cause: Object.assign(new TypeError('Invalid URL'), {code: 'ERR_INVALID_URL'})})
    ],
    ['a TLS certificate mismatch', fetchFailed('ERR_TLS_CERT_ALTNAME_INVALID')],
    ['a client our own code closed', fetchFailed('UND_ERR_CLOSED')]
  ])('%s is a defect -> fail under analytics-sa-stats-api-fetch', (_label, err) => {
    const error = classifyStatsReadError(err)
    expect(error.id).toBe('analytics-sa-stats-api-fetch')
    expect(error).not.toHaveProperty('unmeasured')
  })
})

describe('issueOutcome (the reconciler tri-state)', () => {
  const beaconFail = {severity: 'fail', id: 'analytics-beacon-missing', message: 'x'}
  const unmeasured = {severity: 'warn', id: 'analytics-sa-stats-api-unreachable', message: 'UNMEASURED: x', unmeasured: true}
  const skipped = {severity: 'info', id: 'analytics-sa-ingestion-skipped', message: 'SKIPPED'}
  const confirmed = {severity: 'info', id: 'analytics-sa-ingestion-confirmed', message: 'ok'}

  it('any fail -> failure, even beside an unmeasured arm', () => {
    expect(issueOutcome([unmeasured, beaconFail])).toBe('failure')
  })
  it('an unmeasured arm -> indeterminate (never success)', () => {
    expect(issueOutcome([unmeasured])).toBe('indeterminate')
  })
  it('a skipped ingestion arm (no SA_API_KEY) -> indeterminate', () => {
    expect(issueOutcome([skipped])).toBe('indeterminate')
  })
  it('everything judged and green -> success', () => {
    expect(issueOutcome([confirmed])).toBe('success')
  })
})

describe('concludeIngestion (M2: "not observed" needs a read near the deadline)', () => {
  const base = {
    eventName: 'audit_ingestion_probe',
    before: 4,
    after: 4,
    startedAt: 0,
    endedAt: 180_000,
    deadline: 180_000,
    definiteError: null,
    unmeasuredError: null
  }

  it('a successful read inside the tail tolerance supports "not observed"', () => {
    const findings = concludeIngestion({...base, lastReadAt: 180_000 - INGESTION_OBSERVED_TAIL_MS})
    expect(findings[0].id).toBe('analytics-sa-ingestion-not-observed')
  })

  it('the last successful read just outside the tail tolerance -> UNMEASURED', () => {
    const findings = concludeIngestion({...base, lastReadAt: 180_000 - INGESTION_OBSERVED_TAIL_MS - 1})
    expect(findings[0]).toEqual(expect.objectContaining({severity: 'warn', id: 'analytics-sa-ingestion-unobserved', unmeasured: true}))
  })

  it('a definite error outranks a later unmeasured one', () => {
    const findings = concludeIngestion({
      ...base,
      lastReadAt: null,
      definiteError: {id: 'analytics-sa-stats-api-error', message: 'HTTP 401'},
      unmeasuredError: {id: 'analytics-sa-stats-api-unreachable', message: 'UNMEASURED: reset', unmeasured: true}
    })
    expect(findings[0]).toEqual(expect.objectContaining({severity: 'fail', id: 'analytics-sa-stats-api-error'}))
  })

  it('a rise in the count outranks an earlier definite error', () => {
    const findings = concludeIngestion({...base, after: 5, lastReadAt: 30_000, definiteError: {id: 'e', message: 'm'}})
    expect(findings[0].id).toBe('analytics-sa-ingestion-confirmed')
  })
})

// ---- The real paths: readEventTotal, checkSaIngestion, runAnalyticsCheck ----

const QUERY = 'https://simpleanalytics.com/jonathanlloyd.me.json?x=1'
const json = (body: unknown, status = 200) => new Response(JSON.stringify(body), {status})
const count = (total: number) => json({ok: true, events: [{name: 'audit_ingestion_probe', total}]})
const reset = () => fetchFailed('ECONNRESET')

/** A fetchImpl that plays a script: each step returns a Response or throws an Error. */
function scripted(steps: Array<Response | Error | (() => Response)>) {
  let i = 0
  return vi.fn(async () => {
    const step = steps[Math.min(i++, steps.length - 1)]
    if (step instanceof Error) {
      throw step
    }
    return typeof step === 'function' ? step() : step.clone()
  })
}

/** A deterministic clock: sleep advances time instead of waiting. */
function fakeClock() {
  let t = 1_000_000
  return {now: () => t, sleep: async (ms: number) => void (t += ms)}
}

const postOk = vi.fn(async () => new Response(null, {status: 202}))

describe('readEventTotal (M3: body failures go through the same classifier)', () => {
  it('a body reset mid-read reads UNMEASURED', async () => {
    const bodyReset = {status: 200, ok: true, json: async () => Promise.reject(fetchFailed('UND_ERR_SOCKET', 'terminated', 'other side closed'))}
    const read = await readEventTotal(QUERY, 'k', 'audit_ingestion_probe', {fetchImpl: async () => bodyReset as unknown as Response})
    expect(read).toEqual({ok: false, error: expect.objectContaining({id: 'analytics-sa-stats-api-unreachable', unmeasured: true})})
  })

  it('invalid JSON on a 200 stays the parse fail', async () => {
    const read = await readEventTotal(QUERY, 'k', 'audit_ingestion_probe', {fetchImpl: async () => new Response('<html>', {status: 200})})
    expect(read).toEqual({ok: false, error: expect.objectContaining({id: 'analytics-sa-stats-api-parse'})})
    expect(read.ok || read.error).not.toHaveProperty('unmeasured')
  })

  it('I5: an SA 5xx after retries is an SA outage -> UNMEASURED, like a reset', async () => {
    const read = await readEventTotal(QUERY, 'k', 'audit_ingestion_probe', {fetchImpl: async () => new Response('<html>bad gateway', {status: 502})})
    expect(read).toEqual({ok: false, error: expect.objectContaining({id: 'analytics-sa-stats-api-unavailable', unmeasured: true})})
  })

  it('an HTTP 401 is a measurement about our key -> fail', async () => {
    const read = await readEventTotal(QUERY, 'k', 'audit_ingestion_probe', {fetchImpl: async () => json({ok: false, error: 'Invalid API key'}, 401)})
    expect(read).toEqual({ok: false, error: expect.objectContaining({id: 'analytics-sa-stats-api-error'})})
  })
})

describe('checkSaIngestion poll phase (M2)', () => {
  it('a transport outage after 15s of a 180s window reads UNMEASURED, not "not observed"', async () => {
    const clock = fakeClock()
    const fetchImpl = scripted([count(4), count(4), reset()])
    const findings = await checkSaIngestion('k', {fetchImpl, postImpl: postOk, ...clock})
    expect(findings).toEqual([expect.objectContaining({severity: 'warn', id: 'analytics-sa-ingestion-unobserved', unmeasured: true})])
    expect(findings[0].message).toContain('first 15s of the 180s')
  })

  it('reads that answer to the end of the window support a real "not observed" fail', async () => {
    const findings = await checkSaIngestion('k', {fetchImpl: scripted([count(4)]), postImpl: postOk, ...fakeClock()})
    expect(findings).toEqual([expect.objectContaining({severity: 'fail', id: 'analytics-sa-ingestion-not-observed'})])
  })

  it('a 401 mid-poll outranks the resets that follow it', async () => {
    const fetchImpl = scripted([count(4), json({ok: false, error: 'Invalid API key'}, 401), reset()])
    const findings = await checkSaIngestion('k', {fetchImpl, postImpl: postOk, ...fakeClock()})
    expect(findings).toEqual([expect.objectContaining({severity: 'fail', id: 'analytics-sa-stats-api-error'})])
  })
})

describe('runAnalyticsCheck end to end (exit code + issue_outcome + visibility)', () => {
  let dir: string
  let outputPath: string
  let summaryPath: string
  const allBeacons = async () => fullSeen()

  beforeEach(() => {
    dir = mkdtempSync(path.join(tmpdir(), 'b6-run-'))
    outputPath = path.join(dir, 'output')
    summaryPath = path.join(dir, 'summary')
    // The shared report helper writes `measured=` to process.env.GITHUB_OUTPUT. Pin it to the
    // scratch file so this suite never writes into a real Actions step output.
    vi.stubEnv('GITHUB_OUTPUT', outputPath)
  })
  afterEach(() => {
    vi.unstubAllEnvs()
  })

  async function run(env: Record<string, string>, fetchImpl = scripted([count(4)])) {
    const logger = {log: vi.fn()}
    const exitCode = await runAnalyticsCheck({
      env: {GITHUB_OUTPUT: outputPath, GITHUB_STEP_SUMMARY: summaryPath, ...env},
      collectBeacons: allBeacons,
      fetchImpl,
      postImpl: postOk,
      ...fakeClock(),
      logger,
      append: appendFileSync
    })
    const read = (p: string) => {
      try {
        return readFileSync(p, 'utf8')
      } catch {
        return ''
      }
    }
    return {exitCode, output: read(outputPath), summary: read(summaryPath), annotations: logger.log.mock.calls.map((c) => c[0])}
  }

  it('H1: SA reset -> exit 0 AND issue_outcome=indeterminate, with a warning and a summary line', async () => {
    const r = await run({SA_API_KEY: 'k'}, scripted([reset()]))
    expect(r.exitCode).toBe(0)
    expect(r.output).toBe('measured=4\nissue_outcome=indeterminate\n')
    expect(r.annotations).toEqual([expect.stringMatching(/^::warning title=B6 SA Stats API UNMEASURED::UNMEASURED: .*ECONNRESET/)])
    expect(r.summary).toMatch(/^- B6 analytics: UNMEASURED -- .*ECONNRESET.*\n$/)
  })

  it('HTTP 401 -> exit 1 AND issue_outcome=failure', async () => {
    const r = await run({SA_API_KEY: 'k'}, scripted([json({ok: false, error: 'Invalid API key'}, 401)]))
    expect(r.exitCode).toBe(1)
    expect(r.output).toBe('measured=4\nissue_outcome=failure\n')
    expect(r.annotations).toEqual([])
  })

  it('confirmed ingestion -> exit 0 AND issue_outcome=success, no warning', async () => {
    const r = await run({SA_API_KEY: 'k'}, scripted([count(4), count(5)]))
    expect(r.exitCode).toBe(0)
    expect(r.output).toBe('measured=4\nissue_outcome=success\n')
    expect(r.summary).toBe('')
  })

  it('no SA_API_KEY -> exit 0 AND issue_outcome=indeterminate (the arm did not run)', async () => {
    const r = await run({})
    expect(r.exitCode).toBe(0)
    expect(r.output).toBe('measured=4\nissue_outcome=indeterminate\n')
  })
})
