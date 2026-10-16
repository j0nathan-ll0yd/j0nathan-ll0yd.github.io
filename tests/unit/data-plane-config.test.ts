// @vitest-environment node
//
// The server render's configuration and test seams (atlas decision 0160, PR B): the data-plane origin
// (plan Step 4.1), the Step 6.10 fault injection and the render clock, and the deploy guard that keeps
// both test variables off production.
import {describe, expect, it} from 'vitest'
import {CLOUDFRONT_BASE} from '@j0nathan-ll0yd/portal-contract/constants'
import {dataPlaneBase} from '../../src/lib/data-plane/config'
import {faultableHost, faultyFetch, parseFault, requestClock, requestFault, SSR_CLOCK_HEADER, SSR_FAULT_HEADER} from '../../src/lib/data-plane/faults'
import {FORBIDDEN_DEPLOY_VARS, forbiddenVars} from '../../scripts/check-deploy-vars.mjs'

describe('dataPlaneBase', () => {
  it('is CloudFront when unset or empty', () => {
    expect(dataPlaneBase(undefined)).toBe(CLOUDFRONT_BASE)
    expect(dataPlaneBase('')).toBe(CLOUDFRONT_BASE)
    expect(dataPlaneBase(null)).toBe(CLOUDFRONT_BASE)
  })

  it('takes an http(s) origin and drops the trailing slash', () => {
    expect(dataPlaneBase('http://127.0.0.1:4400/')).toBe('http://127.0.0.1:4400')
    expect(dataPlaneBase('https://fixtures.test/base')).toBe('https://fixtures.test/base')
  })

  it.each(['not a url', 'ftp://host', 'https://host/?q=1', 'https://user:pw@host', 42])('throws on %s, never reads elsewhere silently', (value) => {
    expect(() => dataPlaneBase(value)).toThrow(TypeError)
  })
})

describe('fault injection (Step 6.10)', () => {
  const preview = (headers: Record<string, string>) => new Request('https://abc123-human-datastream.example.workers.dev/', {headers})

  it('parses each documented fault, and nothing else', () => {
    expect(parseFault('slow:1500')).toEqual({kind: 'slow', ms: 1500})
    expect(parseFault('stall')).toEqual({kind: 'stall'})
    expect(parseFault('status:503')).toEqual({kind: 'status', status: 503})
    expect(parseFault('suppress')).toEqual({kind: 'suppress'})
    expect(parseFault('focus-stall')).toEqual({kind: 'focus-stall'})
    for (const value of [null, '', 'slow:0', 'slow:99999', 'slow:x', 'status:200', 'status:403', 'leak', 'now:2026-01-01']) {
      expect(parseFault(value), String(value)).toBeNull()
    }
  })

  it('needs both locks: the Worker variable AND a preview or loopback host', () => {
    expect(requestFault(preview({[SSR_FAULT_HEADER]: 'stall'}), '1')).toEqual({kind: 'stall'})
    expect(requestFault(preview({[SSR_FAULT_HEADER]: 'stall'}), undefined)).toBeNull()
    expect(requestFault(preview({[SSR_FAULT_HEADER]: 'stall'}), 'true')).toBeNull()
    const production = new Request('https://jonathanlloyd.me/', {headers: {[SSR_FAULT_HEADER]: 'stall'}})
    expect(requestFault(production, '1')).toBeNull()
    expect(faultableHost('jonathanlloyd.me')).toBe(false)
    expect(faultableHost('workers.dev.jonathanlloyd.me')).toBe(false)
    expect(faultableHost('localhost')).toBe(true)
  })

  it('fixes the render clock under the same locks, from a strict ISO instant only', () => {
    const clock = (value: string, enabled: unknown = '1', host = 'http://localhost:4321/') =>
      requestClock(new Request(host, {headers: {[SSR_CLOCK_HEADER]: value}}), enabled)
    expect(clock('2026-03-18T12:00:00.000Z')).toBe(Date.parse('2026-03-18T12:00:00.000Z'))
    expect(clock('2026-03-18T12:00:00+02:00')).toBe(Date.parse('2026-03-18T10:00:00.000Z'))
    expect(clock('2026-03-18')).toBeNull()
    expect(clock('1')).toBeNull()
    expect(clock('2026-03-18T12:00:00.000Z', 'off')).toBeNull()
    expect(clock('2026-03-18T12:00:00.000Z', '1', 'https://jonathanlloyd.me/')).toBeNull()
  })

  it('answers a status or suppression fault as a gate answer, and leaves the focus read alone', async () => {
    const real: typeof fetch = async () => new Response('{"real":true}', {status: 200, headers: {'x-amz-cf-id': 'real'}})
    const status = faultyFetch({kind: 'status', status: 503}, real)
    expect((await status('https://cf.test/health.json')).status).toBe(503)
    expect((await status('https://cf.test/focus.json')).status).toBe(200)
    const suppress = await faultyFetch({kind: 'suppress'}, real)('https://cf.test/books.json')
    expect(suppress.status).toBe(403)
    expect(suppress.headers.get('x-amz-cf-id')).toBeTruthy()
    expect(JSON.parse(await suppress.text())).toMatchObject({suppressed: true})
  })

  it('holds a slow body for its delay, and a stalled body until the read is aborted', async () => {
    const real: typeof fetch = async () => new Response('{"real":true}', {status: 200, headers: {'x-amz-cf-id': 'real'}})
    const started = Date.now()
    const slow = await faultyFetch({kind: 'slow', ms: 80}, real)('https://cf.test/health.json')
    expect(await slow.text()).toBe('{"real":true}')
    expect(Date.now() - started).toBeGreaterThanOrEqual(75)

    const controller = new AbortController()
    const stalled = await faultyFetch({kind: 'stall'}, real)('https://cf.test/health.json', {signal: controller.signal})
    const read = stalled.text()
    controller.abort()
    await expect(read).rejects.toThrow()
  })
})

describe('check-deploy-vars (the production deploy guard)', () => {
  it('names DATA_PLANE_BASE and SSR_FAULT_INJECTION', () => {
    expect([...FORBIDDEN_DEPLOY_VARS].sort()).toEqual(['DATA_PLANE_BASE', 'SSR_FAULT_INJECTION'])
  })

  it('fails on either variable in the Worker config or the deploy environment, and passes on neither', () => {
    expect(forbiddenVars({vars: {DATA_PLANE_BASE: 'http://x'}}, {})).toEqual(['DATA_PLANE_BASE (wrangler.json vars)'])
    expect(forbiddenVars({}, {SSR_FAULT_INJECTION: '1'})).toEqual(['SSR_FAULT_INJECTION (deploy environment)'])
    expect(forbiddenVars({vars: {OTHER: 'x'}}, {SSR_FAULT_INJECTION: ''})).toEqual([])
    expect(forbiddenVars({name: 'human-datastream'}, {})).toEqual([])
  })
})
