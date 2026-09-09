// Behavioural tests for audits/healthchecks-ping.sh, the D6 dead-man's
// switch. The bug these lock down: a job that crashed before measuring anything
// still pinged plain SUCCESS, so the Healthchecks tile stayed green while three
// consecutive weekly runs died and B2 went dark for 15 days.
//
// `curl` is stubbed on PATH so the assertions cover the real script -- endpoint
// selection and exit codes -- without touching the network.

import {execFileSync} from 'node:child_process'
import {chmodSync, mkdtempSync, readFileSync, writeFileSync} from 'node:fs'
import {existsSync} from 'node:fs'
import {tmpdir} from 'node:os'
import path from 'node:path'
import {beforeEach, describe, expect, it} from 'vitest'

const SCRIPT = path.resolve('audits/healthchecks-ping.sh')
const PING_URL = 'https://hc-ping.com/00000000-0000-0000-0000-000000000000'

// A healthy tier: two steps, both claiming a real count. Every endpoint-selection
// case below supplies this so it exercises the STATUS rungs rather than tripping the
// no-records wedge, which is its own test.
const HEALTHY_STEPS = 'sitemap|success|2\nrobots|success|1\n'

let scratch: string
let curlLog: string

beforeEach(() => {
  scratch = mkdtempSync(path.join(tmpdir(), 'hc-ping-'))
  curlLog = path.join(scratch, 'curl.log')
})

/** Install a fake `curl` that records the URL it was handed and exits `exitCode`. */
function stubCurl(exitCode = 0): void {
  const shim = path.join(scratch, 'curl')
  writeFileSync(shim, `#!/usr/bin/env bash\nfor arg in "$@"; do :; done\necho "$arg" >> ${JSON.stringify(curlLog)}\nexit ${exitCode}\n`)
  chmodSync(shim, 0o755)
}

function runPing(env: Record<string, string>): {status: number; stdout: string} {
  try {
    const stdout = execFileSync('bash', [SCRIPT], {encoding: 'utf8', env: {...process.env, PATH: `${scratch}:${process.env.PATH}`, ...env}})
    return {status: 0, stdout}
  } catch (err) {
    const e = err as {status: number; stdout: string}
    return {status: e.status, stdout: e.stdout}
  }
}

function pingedUrls(): string[] {
  return existsSync(curlLog) ? readFileSync(curlLog, 'utf8').trim().split('\n').filter(Boolean) : []
}

describe('healthchecks-ping.sh endpoint selection', () => {
  it('pings the plain URL when the job succeeded', () => {
    stubCurl()
    expect(runPing({HC_URL: PING_URL, JOB_STATUS: 'success', MEASURED_STEPS: HEALTHY_STEPS}).status).toBe(0)
    expect(pingedUrls()).toEqual([PING_URL])
  })

  it('pings /fail when the job failed, so a wedged lane marks the check down', () => {
    stubCurl()
    expect(runPing({HC_URL: PING_URL, JOB_STATUS: 'failure', MEASURED_STEPS: HEALTHY_STEPS}).status).toBe(0)
    expect(pingedUrls()).toEqual([`${PING_URL}/fail`])
  })

  it('does not emit a double slash when the secret carries a trailing slash', () => {
    stubCurl()
    runPing({HC_URL: `${PING_URL}/`, JOB_STATUS: 'failure', MEASURED_STEPS: HEALTHY_STEPS})
    expect(pingedUrls()).toEqual([`${PING_URL}/fail`])
  })

  it('defaults to the success endpoint when JOB_STATUS is unset', () => {
    stubCurl()
    runPing({HC_URL: PING_URL, JOB_STATUS: '', MEASURED_STEPS: HEALTHY_STEPS})
    expect(pingedUrls()).toEqual([PING_URL])
  })

  it('stays silent on a cancelled job rather than asserting success or failure', () => {
    stubCurl()
    const {status, stdout} = runPing({HC_URL: PING_URL, JOB_STATUS: 'cancelled', MEASURED_STEPS: HEALTHY_STEPS})
    expect(status).toBe(0)
    expect(pingedUrls()).toEqual([])
    expect(stdout).toContain('not pinging')
  })

  it('skips the ping when the secret is not configured', () => {
    stubCurl()
    const {status, stdout} = runPing({HC_URL: '', JOB_STATUS: 'success', MEASURED_STEPS: HEALTHY_STEPS})
    expect(status).toBe(0)
    expect(pingedUrls()).toEqual([])
    expect(stdout).toContain('skipping')
    // Names the daily secret when the workflow passes no HC_SECRET_NAME.
    expect(stdout).toContain('HC_PING_AUDIT_WEB secret not set')
  })

  it('names the per-tier secret in the skip, and an unarmed tier never pings any tile', () => {
    // Ruling R9a (atlas decision 0116): weekly/monthly ping their own tiles via
    // HC_PING_AUDIT_WEB_WEEKLY / _MONTHLY. Until the owner creates those
    // secrets the lane must skip loudly -- naming the RIGHT secret to create --
    // without redding the lane and without checking in against another tier's
    // tile, even when the job itself failed.
    stubCurl()
    const {status, stdout} = runPing({HC_URL: '', JOB_STATUS: 'failure', HC_SECRET_NAME: 'HC_PING_AUDIT_WEB_WEEKLY', MEASURED_STEPS: HEALTHY_STEPS})
    expect(status).toBe(0)
    expect(pingedUrls()).toEqual([])
    expect(stdout).toContain('HC_PING_AUDIT_WEB_WEEKLY secret not set')
  })
})

describe('healthchecks-ping.sh failure handling', () => {
  // Run 31999694781 failed the whole job here on curl exit 28 during a total
  // runner-egress outage. An unreachable collector must not red a good lane.
  it('warns but exits 0 when the collector is unreachable', () => {
    stubCurl(28)
    const {status, stdout} = runPing({HC_URL: PING_URL, JOB_STATUS: 'success', MEASURED_STEPS: HEALTHY_STEPS})
    expect(status).toBe(0)
    expect(stdout).toContain('::warning title=Healthchecks.io ping failed::')
  })

  it('still exits 0 when the /fail ping itself cannot be delivered', () => {
    stubCurl(28)
    expect(runPing({HC_URL: PING_URL, JOB_STATUS: 'failure', MEASURED_STEPS: HEALTHY_STEPS}).status).toBe(0)
    expect(pingedUrls()).toEqual([`${PING_URL}/fail`])
  })
})

// THE MEASUREMENT CHANNEL (atlas decision 0122), as one record per CHECK STEP. Before
// this rung existed, a check that ran, reached nothing, and was swallowed by
// `continue-on-error` left the job at `success` and pinged a GREEN tile. Weekly run
// 34086625518 is the measured receipt: it concluded success while its Cloudflare arm
// recorded `status: unknown` with five 403s.
describe('healthchecks-ping.sh measurement channel', () => {
  it('pings /fail when a step measured nothing, even though the job succeeded', () => {
    stubCurl()
    const {status, stdout} = runPing({HC_URL: PING_URL, JOB_STATUS: 'success', MEASURED_STEPS: 'sitemap|success|0\n'})
    expect(status).toBe(0)
    expect(pingedUrls()).toEqual([`${PING_URL}/fail`])
    expect(stdout).toContain('sitemap(measured-nothing)')
  })

  // ORDER IS LOAD-BEARING. The measured rungs must be evaluated BEFORE the status rungs; if the
  // status arm ran first, `success` would match and the wedge would never be reported.
  //
  // A failed job pings /fail down EITHER path, so the endpoint alone cannot prove the
  // order here -- the assertion that discriminates is the REPORTED CAUSE. A status-first
  // script reaches /fail without ever naming the unmeasured step, and a reader chasing a
  // wedged infrastructure step would never learn the lane also measured nothing.
  it('pings /fail on measured=0 regardless of job status, and names the measurement as the cause', () => {
    stubCurl()
    const {status, stdout} = runPing({HC_URL: PING_URL, JOB_STATUS: 'failure', MEASURED_STEPS: 'sitemap|failure|0\n'})
    expect(status).toBe(0)
    expect(pingedUrls()).toEqual([`${PING_URL}/fail`])
    expect(stdout).toContain('sitemap(measured-nothing)')
  })

  it('pings the success endpoint when every claiming step measured something', () => {
    stubCurl()
    expect(runPing({HC_URL: PING_URL, JOB_STATUS: 'success', MEASURED_STEPS: 'llms|success|3\nheaders|success|2\n'}).status).toBe(0)
    expect(pingedUrls()).toEqual([PING_URL])
  })

  // THE AGGREGATION RULE, and the reason a single number was never enough. One tile
  // covers a whole tier of steps. A SUM hides the dark one: 3 + 0 + 2 exceeds zero.
  it('wedges the tier when ONE step of many measured nothing', () => {
    stubCurl()
    const {stdout} = runPing({HC_URL: PING_URL, JOB_STATUS: 'success', MEASURED_STEPS: 'llms|success|3\nsitemap|success|0\nheaders|success|2\n'})
    expect(pingedUrls()).toEqual([`${PING_URL}/fail`])
    expect(stdout).toContain('sitemap(measured-nothing)')
    // Named, so the operator does not have to diff three tiers to find the dark step.
    expect(stdout).not.toContain('llms(measured-nothing)')
  })

  // An EMPTY field is "not claimed": the step published no count. When it SUCCEEDED
  // that is merely silence, and atlas A19 arm 2 is the static gate that reds a step
  // which should claim and does not -- a different gate, in a different repo.
  it('falls through to job status when a successful step publishes no count', () => {
    stubCurl()
    expect(runPing({HC_URL: PING_URL, JOB_STATUS: 'success', MEASURED_STEPS: 'sitemap|success|\n'}).status).toBe(0)
    expect(pingedUrls()).toEqual([PING_URL])
  })

  // ...but a step that CONCLUDED FAILURE with no count died before writing one. That
  // is the crashed-before-measuring shape, and `continue-on-error: true` would
  // otherwise launder it into a green tile.
  it('wedges when a step concluded failure without publishing a count', () => {
    stubCurl()
    const {stdout} = runPing({HC_URL: PING_URL, JOB_STATUS: 'success', MEASURED_STEPS: 'sitemap|failure|\n'})
    expect(pingedUrls()).toEqual([`${PING_URL}/fail`])
    expect(stdout).toContain('sitemap(crashed-before-measuring)')
  })

  // A focus-mode `if:` stands a step down. It never ran, so it cannot have measured,
  // and a deliberate stand-down is not a wedge.
  it('does not wedge on a skipped step with no count', () => {
    stubCurl()
    expect(runPing({HC_URL: PING_URL, JOB_STATUS: 'success', MEASURED_STEPS: 'feeds|skipped|\nrobots|success|1\n'}).status).toBe(0)
    expect(pingedUrls()).toEqual([PING_URL])
  })

  it('still reports a wedged lane when the /fail ping itself cannot be delivered', () => {
    stubCurl(28)
    const {status, stdout} = runPing({HC_URL: PING_URL, JOB_STATUS: 'success', MEASURED_STEPS: 'sitemap|success|0\n'})
    expect(status).toBe(0)
    expect(pingedUrls()).toEqual([`${PING_URL}/fail`])
    expect(stdout).toContain('::warning title=Healthchecks.io ping failed::')
  })
})

// DECLARING SCOPE WITHOUT LAUNDERING A PASS (atlas decision 0107's not-applicable
// versus indeterminate split, and atlas A19's `lane-unmeasured-scope-unreasoned`
// rung). A step that cannot count says so, with a reason a reviewer reads.
describe('healthchecks-ping.sh measurement declarations', () => {
  it('accepts n/a with a reason: a tool run holds no artifact set to count', () => {
    stubCurl()
    expect(
      runPing({HC_URL: PING_URL, JOB_STATUS: 'success', MEASURED_STEPS: 'lychee|success|n/a|third-party action exposing only exit_code\nrobots|success|1\n'})
        .status
    ).toBe(0)
    expect(pingedUrls()).toEqual([PING_URL])
  })

  it('accepts deferred with a reason: the channel is blocked on an external action', () => {
    stubCurl()
    expect(
      runPing({HC_URL: PING_URL, JOB_STATUS: 'success', MEASURED_STEPS: 'llms_cache_rules|failure|deferred|atlas 0120 D2 owner action\nrobots|success|1\n'})
        .status
    ).toBe(0)
    expect(pingedUrls()).toEqual([PING_URL])
  })

  it('wedges on an UNREASONED declaration, so the opt-out cannot become a quiet escape hatch', () => {
    stubCurl()
    const {stdout} = runPing({HC_URL: PING_URL, JOB_STATUS: 'success', MEASURED_STEPS: 'lychee|success|n/a\n'})
    expect(pingedUrls()).toEqual([`${PING_URL}/fail`])
    expect(stdout).toContain('lychee(unreasoned-n/a)')
  })

  it('wedges on an unreasoned deferral for the same reason', () => {
    stubCurl()
    const {stdout} = runPing({HC_URL: PING_URL, JOB_STATUS: 'success', MEASURED_STEPS: 'llms_cache_rules|failure|deferred\n'})
    expect(pingedUrls()).toEqual([`${PING_URL}/fail`])
    expect(stdout).toContain('llms_cache_rules(unreasoned-deferred)')
  })

  // Fail-safe: a value the script cannot classify is a wedge, never a claim. A false
  // /fail costs one investigated alert; a false plain ping cost 15 dark days once.
  it('wedges on a measured value it cannot classify', () => {
    stubCurl()
    const {stdout} = runPing({HC_URL: PING_URL, JOB_STATUS: 'success', MEASURED_STEPS: 'sitemap|success|maybe\n'})
    expect(pingedUrls()).toEqual([`${PING_URL}/fail`])
    expect(stdout).toContain('sitemap(unrecognized-measured:maybe)')
  })

  // An UNWIRED TIER is exactly the pre-0122 state this channel exists to end, and it
  // must not read as health.
  it('wedges when the tier forwards no records at all', () => {
    stubCurl()
    const {stdout} = runPing({HC_URL: PING_URL, JOB_STATUS: 'success', MEASURED_STEPS: ''})
    expect(pingedUrls()).toEqual([`${PING_URL}/fail`])
    expect(stdout).toContain('no-step-measurements-reported')
  })
})
