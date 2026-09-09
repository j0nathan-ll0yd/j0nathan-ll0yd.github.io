// The measurement channel: audits/lib/measurement.mjs plus the `report()` seam that
// carries it (atlas decisions 0083, 0107, 0122).
//
// WHAT THESE PIN. A check that runs, reaches nothing, and exits nonzero has its
// failure swallowed by `continue-on-error: true`, so `job.status` reads `success` --
// byte-identical to a healthy run. `measured` is the only signal that separates them,
// and a check that forgets to publish it leaves the field empty, which
// audits/healthchecks-ping.sh treats as "not claimed", never as a pass. So the census
// at the bottom is not stylistic: an unpublished count is a hole in the tier's tile.

import {existsSync, globSync, mkdtempSync, readFileSync} from 'node:fs'
import {tmpdir} from 'node:os'
import path from 'node:path'
import {describe, expect, it} from 'vitest'
import {checkSteps, parseJobs} from './audit-web-steps.ts'
import {publishMeasured} from '../lib/measurement.mjs'
import {report} from '../lib/http.mjs'

describe('publishMeasured', () => {
  it('appends measured=<n> to the supplied output path', () => {
    const written: string[] = []
    publishMeasured(3, {outputPath: '/tmp/output', append: (_p: string, line: string) => written.push(line)})
    expect(written).toEqual(['measured=3\n'])
  })

  it('publishes a literal zero rather than omitting it -- zero is the whole signal', () => {
    const written: string[] = []
    publishMeasured(0, {outputPath: '/tmp/output', append: (_p: string, line: string) => written.push(line)})
    expect(written).toEqual(['measured=0\n'])
  })

  it('is a no-op outside Actions, where there is no $GITHUB_OUTPUT to write', () => {
    const written: string[] = []
    expect(publishMeasured(2, {outputPath: undefined, append: (_p: string, line: string) => written.push(line)})).toBe(2)
    expect(written).toEqual([])
  })

  it('returns the count so callers can pass it straight through', () => {
    expect(publishMeasured(7, {outputPath: undefined})).toBe(7)
  })

  // A negative or fractional "count" is not a measurement, and silently writing it
  // would hand the shell a value it classifies as unrecognized -- a wedge with a
  // confusing cause instead of a defect at its source.
  it.each([[-1], [1.5], [Number.NaN]])('rejects %s as a count', (value) => {
    expect(() => publishMeasured(value, {outputPath: undefined})).toThrow(TypeError)
  })

  it('rejects a non-numeric count', () => {
    expect(() => publishMeasured('3' as unknown as number, {outputPath: undefined})).toThrow(TypeError)
  })
})

describe('report() carries the measurement channel', () => {
  it('throws when a check reports findings without stating what it measured', () => {
    // Forgetting the count must be loud AT THE EXIT, not a silently empty channel that
    // pings a green tile. This is the "half-wired is not wired" rule at the call site.
    expect(() => report('check-x', [], undefined as unknown as number)).toThrow(TypeError)
  })

  it('returns 0 when there are no fail-severity findings', () => {
    expect(report('check-x', [{severity: 'warn', id: 'w', message: 'm'}], 1)).toBe(0)
  })

  it('returns 1 when any finding is fail-severity', () => {
    expect(report('check-x', [{severity: 'fail', id: 'f', message: 'm'}], 1)).toBe(1)
  })

  it('publishes the count a measured-nothing run reached, alongside its findings', () => {
    const outputPath = path.join(mkdtempSync(path.join(tmpdir(), 'measured-')), 'github-output')
    const previous = process.env.GITHUB_OUTPUT
    process.env.GITHUB_OUTPUT = outputPath
    try {
      report('check-x', [{severity: 'fail', id: 'f', message: 'm'}], 0)
    } finally {
      if (previous === undefined) {
        delete process.env.GITHUB_OUTPUT
      } else {
        process.env.GITHUB_OUTPUT = previous
      }
    }
    expect(existsSync(outputPath) ? readFileSync(outputPath, 'utf8') : '').toBe('measured=0\n')
  })
})

/**
 * Split the top-level arguments of the first `report(` call starting at `from`.
 * Tracks nesting and string literals so a comma inside a nested call or a message
 * string is not mistaken for an argument separator.
 */
function reportCallArgs(source: string, from: number): string[] {
  let depth = 0
  let quote: string | null = null
  const args: string[] = []
  let current = ''
  for (let i = from; i < source.length; i++) {
    const ch = source[i]
    if (quote) {
      if (ch === '\\') {
        current += ch + source[++i]
        continue
      }
      if (ch === quote) {
        quote = null
      }
      current += ch
      continue
    }
    if (ch === "'" || ch === '"' || ch === '`') {
      quote = ch
      current += ch
      continue
    }
    if (ch === '(' || ch === '[' || ch === '{') {
      depth++
      if (depth === 1) {
        continue
      }
    }
    if (ch === ')' || ch === ']' || ch === '}') {
      depth--
      if (depth === 0) {
        args.push(current)
        return args
      }
    }
    if (ch === ',' && depth === 1) {
      args.push(current)
      current = ''
      continue
    }
    current += ch
  }
  return args
}

/**
 * The one step whose runner deliberately does NOT publish a count.
 *
 * `llms_cache_rules` COULD claim -- it probes five Cloudflare endpoints and could
 * count the ones that answered. It does not, because all five have returned 403 for
 * its whole observable life (weekly run 34086625518 recorded `status: unknown`), and
 * atlas decision 0120 D2 rules that the read permissions are corrected BEFORE the
 * channel lands, so the tile does not go permanently red on a known-open owner
 * action. Its workflow record therefore says `deferred` with that reason rather than
 * being omitted: the gap is stated, not implied by silence.
 *
 * This is an ALLOWLIST OF ONE, keyed by step id, so a second deferral cannot be added
 * without editing this line and explaining itself here.
 */
const DEFERRED_CHANNEL_STEP_IDS = new Set(['llms_cache_rules'])

describe('every audit check publishes a measurement', () => {
  const jobs = parseJobs()
  const steps = jobs.flatMap((job) => checkSteps(job).map((step) => ({job: job.key, step})))
  // Runners reachable from a check step, minus the one deferred by 0120 D2.
  const censusRunners = [...new Set(steps.filter(({step}) => !DEFERRED_CHANNEL_STEP_IDS.has(step.id!)).flatMap(({step}) => step.runners))].sort()

  it('censuses the check steps the workflow actually declares', () => {
    // Guards the census itself: a parser that matched nothing would pass every
    // assertion below while proving nothing -- the silent-empty-population shape this
    // whole channel exists to end. 14 report-only check steps across the three tiers:
    // 2 daily, 10 weekly, 2 monthly.
    expect(steps.map(({job}) => job).filter((j) => j === 'daily')).toHaveLength(2)
    expect(steps.map(({job}) => job).filter((j) => j === 'weekly')).toHaveLength(10)
    expect(steps.map(({job}) => job).filter((j) => j === 'monthly')).toHaveLength(2)
    expect(steps).toHaveLength(14)
    expect(censusRunners.length).toBeGreaterThanOrEqual(8)
  })

  it.each(censusRunners)('%s states what it measured', (file: string) => {
    const source = readFileSync(file, 'utf8')
    // `report()` carries the count for the artifact probes; `publishMeasured` for the
    // two that exit outside it (feeds' suppression arms, spec-drift's own main);
    // `writeMeasurement` is the merged llms check's own typed writer, reached through
    // an injected `measurementWriter` seam, so the import is what proves it is wired.
    expect(source).toMatch(/publishMeasured\(|writeMeasurement\b|report\(/)
  })

  // THE CALL-SITE GATE. `report()` throws on a missing count at runtime, but a
  // report-only lane swallows that throw, so the tier would learn about it only via
  // the crashed-before-measuring rung. Catching it here makes it a red test instead.
  // Scoped to every runner in the tree, not just the census: a helper that grows a
  // two-argument report() call is the same defect wherever it lives.
  const allRunners: string[] = globSync('audits/checks/*.mjs').sort()
  it.each(allRunners)('%s passes a count at every report() call site', (file: string) => {
    const source = readFileSync(file, 'utf8')
    for (const match of source.matchAll(/\breport\(/g)) {
      const args = reportCallArgs(source, match.index + 'report'.length)
      expect({file, call: match.index, args: args.length}).toEqual({file, call: match.index, args: 3})
    }
  })
})
