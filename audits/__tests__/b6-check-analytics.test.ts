import {execFileSync} from 'node:child_process'
import {appendFileSync, chmodSync, existsSync, mkdtempSync, readFileSync, writeFileSync} from 'node:fs'
import {tmpdir} from 'node:os'
import path from 'node:path'
import {afterEach, beforeEach, describe, expect, it, vi} from 'vitest'
import {parseJobs} from './audit-web-steps.ts'
import {bucketOutcome} from '../lib/file-check-issues.mjs'
import {
  ARMS,
  checkSaIngestion,
  classifyStatsReadError,
  concludeIngestion,
  evaluateBeacons,
  evaluateIngestion,
  eventTotal,
  INGESTION_OBSERVED_TAIL_MS,
  ingestionMeasured,
  issueOutcome,
  parseArm,
  readEventTotal,
  runBeaconsArm,
  runIngestionArm,
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

// ---- The real paths: readEventTotal, checkSaIngestion, runIngestionArm ----

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

describe('ingestionMeasured (the ingestion step count: 1 judged, 0 not judged)', () => {
  const fail = {severity: 'fail', id: 'analytics-sa-stats-api-error', message: 'HTTP 401'}
  const unmeasured = {severity: 'warn', id: 'analytics-sa-stats-api-unreachable', message: 'UNMEASURED: x', unmeasured: true}
  const skipped = {severity: 'info', id: 'analytics-sa-ingestion-skipped', message: 'SKIPPED'}
  const confirmed = {severity: 'info', id: 'analytics-sa-ingestion-confirmed', message: 'ok'}

  it.each([
    ['confirmed', 1, [confirmed]],
    ['a definite fail (401)', 1, [fail]],
    ['a fail beside an unmeasured read', 1, [unmeasured, fail]],
    ['an unmeasured read', 0, [unmeasured]],
    ['a skipped arm (no SA_API_KEY)', 0, [skipped]]
  ])('%s -> %i', (_label, expected, findings) => {
    expect(ingestionMeasured(findings)).toBe(expected)
  })

  it('0 exactly when the arm reads indeterminate, so the tile and the issue never disagree', () => {
    for (const findings of [[confirmed], [fail], [unmeasured], [skipped], [unmeasured, fail]]) {
      expect(ingestionMeasured(findings) === 0).toBe(issueOutcome(findings) === 'indeterminate')
    }
  })
})

describe('parseArm (each workflow step names its arm)', () => {
  it.each([
    [['--arm', 'beacons'], 'beacons'],
    [['--arm=ingestion'], 'ingestion'],
    [[], null],
    [['--arm'], null],
    [['--arm', 'both'], null],
    [['--arm', 'toString'], null]
  ])('%j -> %j', (argv, expected) => {
    expect(parseArm(argv)).toBe(expected)
  })

  it('maps exactly the two arms', () => {
    expect(Object.keys(ARMS).sort()).toEqual(['beacons', 'ingestion'])
  })
})

// ---- The arms end to end: exit code + measured + issue_outcome + visibility ----

/** Read a GITHUB_OUTPUT file into key -> value. A missing file is an empty map. */
function readOutputs(file: string): Record<string, string> {
  if (!existsSync(file)) {
    return {}
  }
  return Object.fromEntries(readFileSync(file, 'utf8').trim().split('\n').filter(Boolean).map((line) => line.split('=') as [string, string]))
}

const readText = (file: string) => (existsSync(file) ? readFileSync(file, 'utf8') : '')

describe('the two B6 arms end to end', () => {
  let dir: string

  beforeEach(() => {
    dir = mkdtempSync(path.join(tmpdir(), 'b6split-run-'))
  })
  afterEach(() => {
    vi.unstubAllEnvs()
  })

  /** Run one arm the way its workflow step does: its own GITHUB_OUTPUT, its own exit code. */
  async function runArm(
    arm: 'beacons' | 'ingestion',
    opts: {env?: Record<string, string>; fetchImpl?: ReturnType<typeof scripted>; seen?: Map<string, {status: number; url: string}>} = {}
  ) {
    const outputPath = path.join(dir, `${arm}.output`)
    const summaryPath = path.join(dir, `${arm}.summary`)
    // The shared report helper writes `measured=` to process.env.GITHUB_OUTPUT. Pin it to this
    // arm's scratch file, as Actions gives each step its own output file.
    vi.stubEnv('GITHUB_OUTPUT', outputPath)
    const logger = {log: vi.fn()}
    const env = {GITHUB_OUTPUT: outputPath, GITHUB_STEP_SUMMARY: summaryPath, ...opts.env}
    const exitCode = arm === 'beacons'
      ? await runBeaconsArm({env, collectBeacons: async () => opts.seen ?? fullSeen()})
      : await runIngestionArm({env, fetchImpl: opts.fetchImpl ?? scripted([count(4)]), postImpl: postOk, ...fakeClock(), logger, append: appendFileSync})
    vi.unstubAllEnvs()
    return {
      exitCode,
      outcome: exitCode === 0 ? 'success' : 'failure',
      outputs: readOutputs(outputPath),
      summary: readText(summaryPath),
      annotations: logger.log.mock.calls.map((c) => c[0])
    }
  }

  it('beacons arm: all four seen -> measured=4, issue_outcome=success', async () => {
    const r = await runArm('beacons')
    expect(r.exitCode).toBe(0)
    expect(r.outputs).toEqual({measured: '4', issue_outcome: 'success'})
  })

  it('beacons arm: a missing beacon -> measured=3, issue_outcome=failure', async () => {
    const seen = fullSeen()
    seen.delete('cf-rum')
    const r = await runArm('beacons', {seen})
    expect(r.exitCode).toBe(1)
    expect(r.outputs).toEqual({measured: '3', issue_outcome: 'failure'})
  })

  it('beacons arm: the page never loads -> measured=0, issue_outcome=failure', async () => {
    const outputPath = path.join(dir, 'crash.output')
    vi.stubEnv('GITHUB_OUTPUT', outputPath)
    const exitCode = await runBeaconsArm({env: {GITHUB_OUTPUT: outputPath}, collectBeacons: async () => Promise.reject(new Error('net::ERR_FAILED'))})
    expect(exitCode).toBe(1)
    expect(readOutputs(outputPath)).toEqual({measured: '0', issue_outcome: 'failure'})
  })

  it('beacons arm never reads SA_API_KEY or the Stats API', async () => {
    const r = await runArm('beacons', {env: {SA_API_KEY: 'k'}})
    expect(r.outputs).toEqual({measured: '4', issue_outcome: 'success'})
  })

  it('ingestion arm: SA reset -> measured=0 AND issue_outcome=indeterminate, exit 0, with a warning and a summary line', async () => {
    const r = await runArm('ingestion', {env: {SA_API_KEY: 'k'}, fetchImpl: scripted([reset()])})
    expect(r.exitCode).toBe(0)
    expect(r.outputs).toEqual({measured: '0', issue_outcome: 'indeterminate'})
    expect(r.annotations).toEqual([expect.stringMatching(/^::warning title=B6 SA Stats API UNMEASURED::UNMEASURED: .*ECONNRESET/)])
    expect(r.summary).toMatch(/^- B6 SA ingestion: UNMEASURED \(measured=0\) -- .*ECONNRESET.*\n$/)
  })

  it('ingestion arm: the poll window goes dark mid-way -> measured=0 AND indeterminate', async () => {
    const r = await runArm('ingestion', {env: {SA_API_KEY: 'k'}, fetchImpl: scripted([count(4), count(4), reset()])})
    expect(r.outputs).toEqual({measured: '0', issue_outcome: 'indeterminate'})
  })

  it('ingestion arm: HTTP 401 -> measured=1 AND issue_outcome=failure, exit 1', async () => {
    const r = await runArm('ingestion', {env: {SA_API_KEY: 'k'}, fetchImpl: scripted([json({ok: false, error: 'Invalid API key'}, 401)])})
    expect(r.exitCode).toBe(1)
    expect(r.outputs).toEqual({measured: '1', issue_outcome: 'failure'})
    expect(r.annotations).toEqual([])
  })

  it('ingestion arm: confirmed -> measured=1 AND issue_outcome=success, no warning', async () => {
    const r = await runArm('ingestion', {env: {SA_API_KEY: 'k'}, fetchImpl: scripted([count(4), count(5)])})
    expect(r.exitCode).toBe(0)
    expect(r.outputs).toEqual({measured: '1', issue_outcome: 'success'})
    expect(r.summary).toBe('')
  })

  it('ingestion arm: not observed to the end of the window -> measured=1 AND failure', async () => {
    const r = await runArm('ingestion', {env: {SA_API_KEY: 'k'}, fetchImpl: scripted([count(4)])})
    expect(r.exitCode).toBe(1)
    expect(r.outputs).toEqual({measured: '1', issue_outcome: 'failure'})
  })

  // CHOICE: a missing key publishes 0. The key is a provisioned secret, so under Actions its
  // absence is a lost secret and the arm is dark -- the same rule as an unreadable Stats API.
  it('ingestion arm: no SA_API_KEY -> measured=0 AND issue_outcome=indeterminate, exit 0, with a SKIPPED warning', async () => {
    const fetchImpl = scripted([count(4)])
    const r = await runArm('ingestion', {fetchImpl})
    expect(r.exitCode).toBe(0)
    expect(r.outputs).toEqual({measured: '0', issue_outcome: 'indeterminate'})
    expect(r.annotations).toEqual([expect.stringMatching(/^::warning title=B6 SA ingestion SKIPPED::SKIPPED/)])
    expect(r.summary).toMatch(/^- B6 SA ingestion: SKIPPED \(measured=0\) -- SKIPPED/)
    expect(fetchImpl).not.toHaveBeenCalled()
  })

  it('ingestion arm: a summary file that cannot be written never turns an unjudged run into a filed failure', async () => {
    const outputPath = path.join(dir, 'append-fails.output')
    vi.stubEnv('GITHUB_OUTPUT', outputPath)
    const exitCode = await runIngestionArm({
      env: {GITHUB_OUTPUT: outputPath, GITHUB_STEP_SUMMARY: path.join(dir, 'summary'), SA_API_KEY: 'k'},
      fetchImpl: scripted([reset()]),
      postImpl: postOk,
      ...fakeClock(),
      logger: {log: () => undefined},
      append: () => {
        throw Object.assign(new Error('ENOSPC: no space left on device'), {code: 'ENOSPC'})
      }
    })
    expect(exitCode).toBe(0)
    expect(readOutputs(outputPath)).toEqual({measured: '0', issue_outcome: 'indeterminate'})
  })
})

// ---- The whole daily tier: both arms -> the real dead-man ping and the real issue fold ----

const PING_SCRIPT = path.resolve('audits/healthchecks-ping.sh')
const PING_URL = 'https://hc-ping.com/00000000-0000-0000-0000-000000000000'

/**
 * Render the daily tier's MEASURED_STEPS exactly as Actions would: take the block from the real
 * workflow and substitute each `${{ steps.<id>.outcome }}` / `${{ steps.<id>.outputs.measured }}`.
 * An unset value renders empty, as Actions renders it.
 */
function renderMeasuredSteps(steps: Record<string, {outcome: string; outputs: Record<string, string>}>): string {
  const daily = parseJobs().find((job) => job.key === 'daily')!
  const ping = daily.steps.find((s) => s.name === 'Healthchecks.io ping')!
  const block = /^ {10}MEASURED_STEPS: \|\n((?: {12}.+\n)+)/m.exec(ping.body)![1]
  return block.replace(/\$\{\{ steps\.([a-z0-9_]+)\.(outcome|outputs\.([a-z_]+)) \}\}/g, (_m, id: string, _f, output?: string) => {
    const step = steps[id]
    if (!step) {
      return ''
    }
    return output ? (step.outputs[output] ?? '') : step.outcome
  }).replace(/^ {12}/gm, '')
}

/** Run the real ping script with a stubbed curl; returns the URLs it pinged. */
function ping(measuredSteps: string): string[] {
  const scratch = mkdtempSync(path.join(tmpdir(), 'b6split-ping-'))
  const log = path.join(scratch, 'curl.log')
  const shim = path.join(scratch, 'curl')
  writeFileSync(shim, `#!/usr/bin/env bash\nfor arg in "$@"; do :; done\necho "$arg" >> ${JSON.stringify(log)}\nexit 0\n`)
  chmodSync(shim, 0o755)
  execFileSync('bash', [PING_SCRIPT], {
    encoding: 'utf8',
    env: {...process.env, PATH: `${scratch}:${process.env.PATH}`, HC_URL: PING_URL, JOB_STATUS: 'success', MEASURED_STEPS: measuredSteps}
  })
  return readText(log).trim().split('\n').filter(Boolean)
}

/** The daily reconciler rows for bucket `analytics`, read from the workflow's own env bindings. */
function analyticsBucket(outputs: Record<string, Record<string, string>>) {
  const daily = parseJobs().find((job) => job.key === 'daily')!
  const reconciler = daily.steps.find((s) => s.name === 'Reconcile managed audit issues')!
  const bindings = Object.fromEntries(
    [...reconciler.body.matchAll(/^ {10}([A-Z0-9_]+): \$\{\{ steps\.([a-z0-9_]+)\.outputs\.issue_outcome \}\}$/gm)].map((m) => [m[1], m[2]])
  )
  const rows = [...reconciler.body.matchAll(/\{id: 'analytics', title: '([^']+)', outcome: process\.env\.([A-Z0-9_]+)\}/g)]
  return rows.map((m) => ({id: 'analytics', title: m[1], outcome: outputs[bindings[m[2]]]?.issue_outcome ?? ''}))
}

describe('the daily tier with both B6 arms (owner decision 2026-10-13, option A)', () => {
  afterEach(() => {
    vi.unstubAllEnvs()
  })

  async function day(
    ingestionFetch: ReturnType<typeof scripted>,
    ingestionEnv: Record<string, string> = {SA_API_KEY: 'k'},
    collectBeacons: () => Promise<Map<string, {status: number; url: string}>> = async () => fullSeen()
  ) {
    const dir = mkdtempSync(path.join(tmpdir(), 'b6split-day-'))
    const beaconsOut = path.join(dir, 'beacons')
    const ingestionOut = path.join(dir, 'ingestion')
    vi.stubEnv('GITHUB_OUTPUT', beaconsOut)
    const beaconsExit = await runBeaconsArm({env: {GITHUB_OUTPUT: beaconsOut}, collectBeacons})
    vi.stubEnv('GITHUB_OUTPUT', ingestionOut)
    const ingestionExit = await runIngestionArm({
      env: {GITHUB_OUTPUT: ingestionOut, ...ingestionEnv},
      fetchImpl: ingestionFetch,
      postImpl: postOk,
      ...fakeClock(),
      logger: {log: () => undefined},
      append: () => undefined
    })
    vi.unstubAllEnvs()
    const steps = {
      smoke: {outcome: 'success', outputs: {}},
      analytics_beacons: {outcome: beaconsExit === 0 ? 'success' : 'failure', outputs: readOutputs(beaconsOut)},
      analytics_ingestion: {outcome: ingestionExit === 0 ? 'success' : 'failure', outputs: readOutputs(ingestionOut)}
    }
    const bucket = analyticsBucket({analytics_beacons: steps.analytics_beacons.outputs, analytics_ingestion: steps.analytics_ingestion.outputs})
    return {records: renderMeasuredSteps(steps), pinged: ping(renderMeasuredSteps(steps)), bucket, issue: bucketOutcome(bucket)}
  }

  it('the workflow feeds both arms into ONE bucket under the title issue #149 carries', async () => {
    const {bucket} = await day(scripted([count(4), count(5)]))
    expect(bucket).toHaveLength(2)
    expect(new Set(bucket.map((row) => row.title))).toEqual(new Set(['B6 analytics beacons (CF + SA)']))
  })

  it('a Stats API reset: the tile goes RED that day, the issue stays unchanged, the beacons record is unaffected', async () => {
    const {records, pinged, issue} = await day(scripted([reset()]))
    expect(records).toContain('analytics_beacons|success|4\n')
    expect(records).toContain('analytics_ingestion|success|0\n')
    expect(pinged).toEqual([`${PING_URL}/fail`])
    expect(issue).toBe('indeterminate')
  })

  it('no SA_API_KEY: the tile goes RED, the issue stays unchanged', async () => {
    const {pinged, issue} = await day(scripted([count(4)]), {})
    expect(pinged).toEqual([`${PING_URL}/fail`])
    expect(issue).toBe('indeterminate')
  })

  it('an HTTP 401: the tile stays green (the arm measured) and the issue files', async () => {
    const {records, pinged, issue} = await day(scripted([json({ok: false, error: 'Invalid API key'}, 401)]))
    expect(records).toContain('analytics_ingestion|failure|1\n')
    expect(pinged).toEqual([PING_URL])
    expect(issue).toBe('failure')
  })

  it('a missing beacon beside an UNMEASURED ingestion arm: the issue files, and the ingestion 0 still wedges the tile', async () => {
    const seen = fullSeen()
    seen.delete('sa-script')
    const {records, pinged, issue} = await day(scripted([reset()]), {SA_API_KEY: 'k'}, async () => seen)
    expect(records).toContain('analytics_beacons|failure|3\n')
    expect(records).toContain('analytics_ingestion|success|0\n')
    expect(pinged).toEqual([`${PING_URL}/fail`])
    expect(issue).toBe('failure')
  })

  it('a page that never loads beside a confirmed ingestion: the beacons 0 wedges the tile and the issue files', async () => {
    const {records, pinged, issue} = await day(scripted([count(4), count(5)]), {SA_API_KEY: 'k'}, async () => Promise.reject(new Error('net::ERR_FAILED')))
    expect(records).toContain('analytics_beacons|failure|0\n')
    expect(records).toContain('analytics_ingestion|success|1\n')
    expect(pinged).toEqual([`${PING_URL}/fail`])
    expect(issue).toBe('failure')
  })

  it('confirmed ingestion: the tile stays green and the issue closes', async () => {
    const {pinged, issue} = await day(scripted([count(4), count(5)]))
    expect(pinged).toEqual([PING_URL])
    expect(issue).toBe('success')
  })
})

// ---- The CLI: what each workflow step actually executes ----

const RUNNER = path.resolve('audits/checks/b6-check-analytics.mjs')

/** Run the real runner as its workflow step does, minus the network: no key, no browser. */
function cli(args: string[]) {
  const dir = mkdtempSync(path.join(tmpdir(), 'b6split-cli-'))
  const outputPath = path.join(dir, 'output')
  const env: Record<string, string | undefined> = {...process.env, GITHUB_OUTPUT: outputPath, GITHUB_STEP_SUMMARY: path.join(dir, 'summary')}
  delete env.SA_API_KEY
  let status = 0
  try {
    execFileSync('node', [RUNNER, ...args], {encoding: 'utf8', env, stdio: 'pipe'})
  } catch (err) {
    status = (err as {status: number}).status
  }
  return {status, raw: readText(outputPath)}
}

describe('b6-check-analytics.mjs as a process', () => {
  it('no --arm: exits 1, publishes NO count and issue_outcome=failure, and the dead-man wedges', () => {
    const r = cli([])
    expect(r.status).toBe(1)
    expect(r.raw).toBe('issue_outcome=failure\n')
    expect(ping(`analytics_ingestion|failure|\n`)).toEqual([`${PING_URL}/fail`])
  })

  it('an unknown arm is the same wiring defect', () => {
    expect(cli(['--arm', 'both'])).toEqual({status: 1, raw: 'issue_outcome=failure\n'})
  })

  it('--arm ingestion with no SA_API_KEY: exits 0, publishes measured=0 and indeterminate', () => {
    expect(cli(['--arm', 'ingestion'])).toEqual({status: 0, raw: 'measured=0\nissue_outcome=indeterminate\n'})
  })
})
