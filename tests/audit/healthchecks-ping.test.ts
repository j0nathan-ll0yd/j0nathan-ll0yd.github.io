// Behavioural tests for scripts/audit/healthchecks-ping.sh, the D6 dead-man's
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

const SCRIPT = path.resolve('scripts/audit/healthchecks-ping.sh')
const PING_URL = 'https://hc-ping.com/00000000-0000-0000-0000-000000000000'

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
    expect(runPing({HC_URL: PING_URL, JOB_STATUS: 'success'}).status).toBe(0)
    expect(pingedUrls()).toEqual([PING_URL])
  })

  it('pings /fail when the job failed, so a wedged lane marks the check down', () => {
    stubCurl()
    expect(runPing({HC_URL: PING_URL, JOB_STATUS: 'failure'}).status).toBe(0)
    expect(pingedUrls()).toEqual([`${PING_URL}/fail`])
  })

  it('does not emit a double slash when the secret carries a trailing slash', () => {
    stubCurl()
    runPing({HC_URL: `${PING_URL}/`, JOB_STATUS: 'failure'})
    expect(pingedUrls()).toEqual([`${PING_URL}/fail`])
  })

  it('defaults to the success endpoint when JOB_STATUS is unset', () => {
    stubCurl()
    runPing({HC_URL: PING_URL, JOB_STATUS: ''})
    expect(pingedUrls()).toEqual([PING_URL])
  })

  it('stays silent on a cancelled job rather than asserting success or failure', () => {
    stubCurl()
    const {status, stdout} = runPing({HC_URL: PING_URL, JOB_STATUS: 'cancelled'})
    expect(status).toBe(0)
    expect(pingedUrls()).toEqual([])
    expect(stdout).toContain('not pinging')
  })

  it('skips the ping when the secret is not configured', () => {
    stubCurl()
    const {status, stdout} = runPing({HC_URL: '', JOB_STATUS: 'success'})
    expect(status).toBe(0)
    expect(pingedUrls()).toEqual([])
    expect(stdout).toContain('skipping')
  })
})

describe('healthchecks-ping.sh failure handling', () => {
  // Run 31999694781 failed the whole job here on curl exit 28 during a total
  // runner-egress outage. An unreachable collector must not red a good lane.
  it('warns but exits 0 when the collector is unreachable', () => {
    stubCurl(28)
    const {status, stdout} = runPing({HC_URL: PING_URL, JOB_STATUS: 'success'})
    expect(status).toBe(0)
    expect(stdout).toContain('::warning title=Healthchecks.io ping failed::')
  })

  it('still exits 0 when the /fail ping itself cannot be delivered', () => {
    stubCurl(28)
    expect(runPing({HC_URL: PING_URL, JOB_STATUS: 'failure'}).status).toBe(0)
    expect(pingedUrls()).toEqual([`${PING_URL}/fail`])
  })
})
