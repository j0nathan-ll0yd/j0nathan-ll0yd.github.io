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
import {afterEach, beforeEach, describe, expect, it} from 'vitest'
import {checkSteps, parseJobs} from './audit-web-steps.ts'
import {ISSUE_OUTCOMES, MEASURED_DEFERRED, publishIssueOutcome, publishMeasured} from '../lib/measurement.mjs'
import {report} from '../lib/http.mjs'

// $GITHUB_OUTPUT IS SET WHEN THIS SUITE RUNS UNDER ACTIONS, and unset on a workstation. Any
// assertion that reads it implicitly therefore measures a different thing in the two places. The
// original "no-op outside Actions" case passed locally for exactly that wrong reason and failed in
// CI, which also surfaced a real defect: an explicitly passed `outputPath: undefined` used to fall
// through a destructuring default to the environment. Each test now states the environment it
// means.
let savedGithubOutput: string | undefined

beforeEach(() => {
  savedGithubOutput = process.env.GITHUB_OUTPUT
  delete process.env.GITHUB_OUTPUT
})

afterEach(() => {
  if (savedGithubOutput === undefined) {
    delete process.env.GITHUB_OUTPUT
  } else {
    process.env.GITHUB_OUTPUT = savedGithubOutput
  }
})

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
    // No `outputPath` key at all: the caller has not spoken, so the environment decides -- and the
    // beforeEach above has made this the genuine outside-Actions environment.
    expect(publishMeasured(2, {append: (_p: string, line: string) => written.push(line)})).toBe(2)
    expect(written).toEqual([])
  })

  it('treats an EXPLICIT outputPath: undefined as "no path", never as "use $GITHUB_OUTPUT"', () => {
    // The defect CI caught. Under Actions GITHUB_OUTPUT is always set, so a destructuring default
    // turned a caller's explicit "do not write" into a write. Pinned in the environment where it
    // actually differs.
    const written: string[] = []
    process.env.GITHUB_OUTPUT = '/tmp/should-not-be-written'
    expect(publishMeasured(2, {outputPath: undefined, append: (_p: string, line: string) => written.push(line)})).toBe(2)
    expect(written).toEqual([])
  })

  it('falls back to $GITHUB_OUTPUT when the caller supplies no key -- the production path', () => {
    const written: Array<[string, string]> = []
    process.env.GITHUB_OUTPUT = '/tmp/github-output'
    publishMeasured(4, {append: (p: string, line: string) => written.push([p, line])})
    expect(written).toEqual([['/tmp/github-output', 'measured=4\n']])
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

  // THE ONE DECLARATION A RUNNER MAY PUBLISH (atlas decisions 0120 D2, 0142 step 5.4). A step
  // that COULD claim and is blocked on an action outside this repo says so itself, instead of
  // the workflow hard-coding the waived value on its behalf -- a constant is published on every
  // run, including the runs that crashed.
  it('accepts the deferred declaration, so a blocked runner states its own state', () => {
    const written: string[] = []
    expect(publishMeasured(MEASURED_DEFERRED, {outputPath: '/tmp/output', append: (_p: string, line: string) => written.push(line)})).toBe('deferred')
    expect(written).toEqual(['measured=deferred\n'])
  })

  // `n/a` is structural -- a third-party tool run holds no artifact set -- and such a run never
  // executes this repo's code, so a runner claiming it would assert something it cannot observe.
  // Every other string stays a TypeError: the declaration vocabulary is closed, not open.
  it.each(['n/a', 'deferred ', 'DEFERRED', 'unknown'])('rejects %j as a declaration', (value) => {
    expect(() => publishMeasured(value as unknown as number, {outputPath: undefined})).toThrow(TypeError)
  })
})

describe('publishIssueOutcome', () => {
  it('appends issue_outcome=<value> for each value the reconciler accepts', () => {
    for (const outcome of ISSUE_OUTCOMES) {
      const written: string[] = []
      expect(publishIssueOutcome(outcome, {outputPath: '/tmp/output', append: (_p: string, line: string) => written.push(line)})).toBe(outcome)
      expect(written).toEqual([`issue_outcome=${outcome}\n`])
    }
  })

  it.each(['', 'skipped', 'cancelled', undefined, 'SUCCESS'])('rejects %j -- a value outside the tri-state is a TypeError, not a silent unknown',
    (value) => {
      expect(() => publishIssueOutcome(value as unknown as 'success', {outputPath: undefined})).toThrow(TypeError)
    })

  it('treats an EXPLICIT outputPath: undefined as "no path", never as "use $GITHUB_OUTPUT"', () => {
    const written: string[] = []
    process.env.GITHUB_OUTPUT = '/tmp/should-not-be-written'
    publishIssueOutcome('failure', {outputPath: undefined, append: (_p: string, line: string) => written.push(line)})
    expect(written).toEqual([])
  })

  it('falls back to $GITHUB_OUTPUT when the caller supplies no key -- the production path', () => {
    const written: Array<[string, string]> = []
    process.env.GITHUB_OUTPUT = '/tmp/github-output'
    publishIssueOutcome('indeterminate', {append: (p: string, line: string) => written.push([p, line])})
    expect(written).toEqual([['/tmp/github-output', 'issue_outcome=indeterminate\n']])
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
 * THE ALLOWLIST IS NOW EMPTY, and that is the finding (atlas decision 0142 step 5.4).
 *
 * `llms_cache_rules` used to sit here. Its runner published nothing and its workflow
 * record hard-coded the literal `deferred`, on the reasoning that all five Cloudflare
 * reads have returned 403 for its whole observable life (weekly run 34086625518 recorded
 * `status: unknown`) and that atlas decision 0120 D2 corrects the read permissions BEFORE
 * the channel lands, so the tile does not go permanently red on a known-open owner action.
 *
 * The owner rejected the waiver. The runner now publishes its real count
 * (`measurementDeclaration` in audits/checks/b2-check-cloudflare-llms-cache-rules.mjs): 0
 * when every read is refused, which wedges the tier. It is an ordinary member of the census
 * below, and its workflow record carries no reason and no `until=` field.
 *
 * Kept as an empty set rather than deleted: it is the seam a future exemption would have
 * to reopen, with its reason, in review.
 */
const DEFERRED_CHANNEL_STEP_IDS = new Set<string>()

describe('every audit check publishes a measurement', () => {
  const jobs = parseJobs()
  const steps = jobs.flatMap((job) => checkSteps(job).map((step) => ({job: job.key, step})))
  // Runners reachable from a check step, minus any whose channel is exempt.
  const censusRunners = [...new Set(steps.filter(({step}) => !DEFERRED_CHANNEL_STEP_IDS.has(step.id!)).flatMap(({step}) => step.runners))].sort()

  it('exempts no runner from the census', () => {
    // The exemption that existed was the laundering channel, not a permanent property.
    expect([...DEFERRED_CHANNEL_STEP_IDS]).toEqual([])
    expect(censusRunners).toContain('audits/checks/b2-check-cloudflare-llms-cache-rules.mjs')
  })

  it('censuses the check steps the workflow actually declares', () => {
    // Guards the census itself: a parser that matched nothing would pass every
    // assertion below while proving nothing -- the silent-empty-population shape this
    // whole channel exists to end. 16 report-only check steps across the three tiers:
    // 3 daily, 11 weekly, 2 monthly. The weekly count moved from 10 with
    // `spec_currency` (atlas decision 0129 C6), which measures CURRENT upstream blobs
    // where its `spec_drift` sibling measures PINNED ones. The daily count moved from 2
    // when B6 split into `analytics_beacons` and `analytics_ingestion` (owner decision
    // 2026-10-13, option A), so a dark SA ingestion arm publishes its own 0.
    expect(steps.map(({job}) => job).filter((j) => j === 'daily')).toHaveLength(3)
    expect(steps.map(({job}) => job).filter((j) => j === 'weekly')).toHaveLength(11)
    expect(steps.map(({job}) => job).filter((j) => j === 'monthly')).toHaveLength(2)
    expect(steps).toHaveLength(16)
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
  // two-argument call is the same defect wherever it lives.
  //
  // THE SCAN IS RAW AND CANNOT TELL A COMMENT FROM A CALL. Writing the helper's name followed
  // by an open parenthesis in a docblock reds this test (observed while documenting b2-llms.mjs
  // under atlas decision 0142 step 5.2). That is deliberate rather than tolerated: teaching the
  // scanner to strip comments means parsing `.mjs` well enough to tell a real `//` from one
  // inside a string literal, and a parser that over-strips would silently stop watching real
  // call sites. A false red a author fixes in one edit is cheaper than a gate that quietly
  // narrows, so prose refers to the helper by name without its parentheses.
  const allRunners: string[] = globSync('audits/checks/*.mjs').sort()
  it.each(allRunners)('%s passes a count at every report() call site', (file: string) => {
    const source = readFileSync(file, 'utf8')
    for (const match of source.matchAll(/\breport\(/g)) {
      const args = reportCallArgs(source, match.index + 'report'.length)
      expect({file, call: match.index, args: args.length}).toEqual({file, call: match.index, args: 3})
    }
  })
})
