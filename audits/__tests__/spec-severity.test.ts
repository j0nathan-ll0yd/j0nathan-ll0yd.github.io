// audits/__tests__/spec-severity.test.ts -- the severity/params ratchet, ADR 0011 REVERSAL 1
// and N6, plus the completeness arm added by atlas decision 0142 step 5.3.
//
// WHY THIS FILE EXISTS. `b2-check-spec-severity.mjs` is the PR-BLOCKING watcher
// (.github/workflows/static-checks.yml, the "Spec severity ratchet" step) and until now it was
// the only one of the four with no automated can-fail coverage: a repo-wide grep found no test
// importing it, and its can-fail evidence was a one-time manual rehearsal through
// SEVERITY_BASELINE_SHOW_ARG. Its three sibling watchers each open by reciting ADR 0010/0011's
// lesson -- a gate never observed to fail is indistinguishable from no gate -- and this one did
// not hold itself to it. An edit inverting the RANK comparison, or dropping arm (c), or dropping
// the params_pending ratchet, would have reddened nothing.
//
// EVERY CASE INJECTS ITS SNAPSHOT. `checkSpecSeverity` takes `{baselineHead, baselineMain, live}`,
// so each arm is exercised against a synthetic three-way disagreement without touching disk, git
// or the on-disk rule files. The live catalog is asserted separately, at the bottom, because
// "the ratchet can fail" and "the ratchet is currently satisfied" are different claims.

import {describe, expect, it, vi} from 'vitest'
import {checkSpecSeverity, loadSeveritySnapshot, readBaselineAtMain} from '../checks/b2-check-spec-severity.mjs'

type Severity = 'fail' | 'warn'
type Baseline = {severities: Record<string, Severity>; params_pending_count: number; unavailable?: string}
type Snapshot = {baselineHead: Baseline; baselineMain: Baseline; live: {severities: Record<string, Severity>; paramsPendingCount: number}}

function baseline(severities: Record<string, Severity>, params_pending_count = 0): Baseline {
  return {severities, params_pending_count}
}

/** A three-way-agreeing snapshot: one id recorded at `fail` everywhere, nothing pending. */
function agreeing(): Snapshot {
  return {
    baselineHead: baseline({'example-rule': 'fail'}),
    baselineMain: baseline({'example-rule': 'fail'}),
    live: {severities: {'example-rule': 'fail'}, paramsPendingCount: 0}
  }
}

const check = (snapshot: Snapshot) => checkSpecSeverity(snapshot) as string[]

describe('checkSpecSeverity: the accept path', () => {
  it('passes when the baseline, origin/main and the live catalog all agree', () => {
    expect(check(agreeing())).toEqual([])
  })

  // The ratchet is one-directional BY CONSTRUCTION: every comparison is RANK[a] < RANK[b], so a
  // strengthening is admitted everywhere a weakening is refused. Pinned so an edit that makes it
  // symmetric -- which would block legitimate promotions -- is visible here.
  it('admits a strengthening in the baseline and in the live rule alike', () => {
    const snapshot = agreeing()
    snapshot.baselineMain = baseline({'example-rule': 'warn'})
    expect(check(snapshot)).toEqual([])
  })

  it('accepts an id retired from BOTH the baseline and the live catalog', () => {
    const snapshot = agreeing()
    snapshot.baselineMain = baseline({'example-rule': 'fail', 'retired-rule': 'fail'})
    expect(check(snapshot)).toEqual([])
  })
})

describe('checkSpecSeverity: arm (a) -- the baseline may not weaken against origin/main', () => {
  it('fails when this branch records a weaker severity than origin/main did', () => {
    const snapshot = agreeing()
    snapshot.baselineHead = baseline({'example-rule': 'warn'})
    snapshot.live = {severities: {'example-rule': 'warn'}, paramsPendingCount: 0}

    const violations = check(snapshot)
    expect(violations).toHaveLength(1)
    expect(violations[0]).toContain('severity-baseline.json weakened for "example-rule"')
    expect(violations[0]).toContain('origin/main recorded "fail"')
  })
})

describe('checkSpecSeverity: arm (b) -- a rule file may not emit weaker than the baseline records', () => {
  it('fails when the live rule downgrades under an unchanged baseline', () => {
    const snapshot = agreeing()
    snapshot.live = {severities: {'example-rule': 'warn'}, paramsPendingCount: 0}

    const violations = check(snapshot)
    expect(violations).toHaveLength(1)
    expect(violations[0]).toContain('rule "example-rule" emits severity "warn", weaker than the baseline\'s recorded "fail"')
  })
})

describe('checkSpecSeverity: arm (c) -- delete-then-downgrade (REVERSAL 1)', () => {
  // The coordinated edit the ratchet exists to refuse: drop the id from the baseline so arm (b)
  // has nothing to compare against, then weaken the rule. Each half is self-consistent; only the
  // origin/main record proves the id was ever watched.
  it('fails when an id leaves the baseline while the live catalog still emits it', () => {
    const snapshot = agreeing()
    snapshot.baselineHead = baseline({})
    snapshot.live = {severities: {'example-rule': 'warn'}, paramsPendingCount: 0}

    const violations = check(snapshot)
    expect(violations.some((v) => v.includes('this is delete-then-downgrade'))).toBe(true)
    expect(violations.some((v) => v.includes('was removed from severity-baseline.json but is still emitted'))).toBe(true)
  })
})

describe('checkSpecSeverity: arm (d) -- completeness (atlas decision 0142 step 5.3)', () => {
  // THE SYMMETRIC HALF OF (c). Arms (a)-(c) iterate ids a baseline already holds, so before this
  // arm an id that never entered the baseline was outside the ratchet forever.
  it('fails when a live id has no baseline entry at all', () => {
    const snapshot = agreeing()
    snapshot.live = {severities: {'example-rule': 'fail', 'brand-new-rule': 'warn'}, paramsPendingCount: 0}

    const violations = check(snapshot)
    expect(violations).toHaveLength(1)
    expect(violations[0]).toContain('rule "brand-new-rule" is emitted by the live catalog at severity "warn" but has no entry')
    expect(violations[0]).toContain('record it at birth')
  })

  // The never-add-then-downgrade escape, end to end. Both commits were green before arm (d).
  it('closes never-add-then-downgrade: PR1 adds unrecorded, PR2 weakens, and now PR1 reds', () => {
    const afterPr1: Snapshot = {baselineHead: baseline({}), baselineMain: baseline({}), live: {severities: {'new-rule': 'fail'}, paramsPendingCount: 0}}
    const afterPr2: Snapshot = {baselineHead: baseline({}), baselineMain: baseline({}), live: {severities: {'new-rule': 'warn'}, paramsPendingCount: 0}}

    // Arms (a)-(c) are silent on both, which is the defect: the downgrade is invisible to them.
    for (const snapshot of [afterPr1, afterPr2]) {
      const armsAbc = check(snapshot).filter((v) => !v.includes('has no entry in severity-baseline.json'))
      expect(armsAbc).toEqual([])
    }
    // Arm (d) reds at PR1, before there is anything to downgrade.
    expect(check(afterPr1)).toHaveLength(1)
    expect(check(afterPr2)).toHaveLength(1)
  })

  it('distinguishes "not watched" from "no regression": an unrecorded id is never silently clean', () => {
    const unrecorded: Snapshot = {
      baselineHead: baseline({}),
      baselineMain: baseline({}),
      live: {severities: {'unwatched-rule': 'fail'}, paramsPendingCount: 0}
    }
    expect(check(unrecorded)).not.toEqual([])
  })
})

describe('checkSpecSeverity: the params_pending ratchet (N6)', () => {
  it('fails when the live count exceeds the committed count', () => {
    const snapshot = agreeing()
    snapshot.live = {severities: {'example-rule': 'fail'}, paramsPendingCount: 1}

    const violations = check(snapshot)
    expect(violations).toHaveLength(1)
    expect(violations[0]).toContain('params_pending count rose from 0 (committed) to 1 (live)')
  })

  it('admits a count that falls -- deriving a threshold is the direction the ratchet wants', () => {
    const snapshot = agreeing()
    snapshot.baselineHead = baseline({'example-rule': 'fail'}, 2)
    expect(check(snapshot)).toEqual([])
  })
})

describe('checkSpecSeverity: arm (0) -- an unreadable origin/main baseline is INDETERMINATE', () => {
  it('reports that arms (a) and (c) did not run, rather than passing them vacuously', () => {
    const snapshot = agreeing()
    snapshot.baselineMain = {severities: {}, params_pending_count: 0, unavailable: 'the ref "origin/main" does not resolve in this clone'}

    const violations = check(snapshot)
    expect(violations).toHaveLength(1)
    expect(violations[0]).toContain('INDETERMINATE')
    expect(violations[0]).toContain('does not resolve in this clone')
    expect(violations[0]).toContain('so they did not run')
  })

  // The regression this guards: before atlas decision 0142 step 5.3 the same input produced an
  // empty baseline and ZERO violations, so a fetchless clone silently ran half the gate.
  it('would otherwise be indistinguishable from a clean first run', () => {
    const firstRun = agreeing()
    firstRun.baselineMain = baseline({})
    expect(check(firstRun)).toEqual([])
  })
})

describe('readBaselineAtMain: the three outcomes', () => {
  type GitCall = string[]
  const gitReturning = (handler: (args: GitCall) => {ok: boolean; stdout?: string; error?: string}) => vi.fn(handler)

  it('returns the recorded baseline when the ref resolves and the blob parses', () => {
    const git = gitReturning((args) =>
      args[0] === 'rev-parse' ? {ok: true, stdout: 'abc\n'} : {ok: true, stdout: '{"severities":{"a":"fail"},"params_pending_count":3}'}
    )
    expect(readBaselineAtMain({git, showArg: 'origin/main:audits/specs/severity-baseline.json'})).toEqual({severities: {a: 'fail'}, params_pending_count: 3})
  })

  it('marks the record unavailable when the REF does not resolve', () => {
    const git = gitReturning((args) => args[0] === 'rev-parse' ? {ok: false, error: 'not a ref'} : {ok: true, stdout: '{}'})
    const read = readBaselineAtMain({git, showArg: 'origin/main:audits/specs/severity-baseline.json'}) as Baseline

    expect(read.unavailable).toContain('the ref "origin/main" does not resolve')
    // `git show` is never reached: the ref check answered first.
    expect(git.mock.calls.map(([args]) => args[0])).toEqual(['rev-parse'])
  })

  // The genuine first-run path stays a silent, honest empty: there is no prior record to compare
  // against, which is different from being unable to look for one.
  it('returns an EMPTY baseline, unmarked, when the ref resolves but the path is absent at it', () => {
    const git = gitReturning((args) => args[0] === 'rev-parse' ? {ok: true, stdout: 'abc\n'} : {ok: false, error: 'path does not exist'})
    expect(readBaselineAtMain({git, showArg: 'origin/main:audits/specs/severity-baseline.json'})).toEqual({severities: {}, params_pending_count: 0})
  })

  it('marks a corrupt blob unavailable rather than reading it as absent', () => {
    const git = gitReturning((args) => args[0] === 'rev-parse' ? {ok: true, stdout: 'abc\n'} : {ok: true, stdout: '{ not json'})
    expect((readBaselineAtMain({git, showArg: 'origin/main:x.json'}) as Baseline).unavailable).toContain('is not valid JSON')
  })

  // SEVERITY_BASELINE_SHOW_ARG's rehearsal form: a bare blob hash carries no `<rev>:<path>` colon,
  // so the ref pre-check must be skipped rather than run against a nonexistent ref.
  it('skips the ref pre-check for a bare blob argument', () => {
    const git = gitReturning(() => ({ok: true, stdout: '{"severities":{}}'}))
    readBaselineAtMain({git, showArg: 'deadbeef'})
    expect(git.mock.calls.map(([args]) => args[0])).toEqual(['show'])
  })
})

describe('the live catalog satisfies its own ratchet', () => {
  // Distinct from every case above: those prove the gate CAN fail, this proves the committed
  // corpus currently passes it, reading the real severity-baseline.json and the real rule files.
  //
  // ARM (0) IS A PROPERTY OF THE CHECKOUT, NOT OF THE CORPUS, so it is asserted separately.
  // This suite runs in the `setup` and `spec-cases` CI jobs, which check out at the default
  // `fetch-depth: 1` where `origin/main` genuinely does not resolve -- and the arm correctly
  // reports INDETERMINATE there. Only the `spec-severity-ratchet` job sets `fetch-depth: 0`,
  // with a comment saying it does so precisely so arms (a) and (c) can run; that job runs the
  // check itself and is where the ratchet actually gates. Demanding zero violations here would
  // make the corpus assertion depend on which job happened to run it, which is how a test comes
  // to be "fixed" by weakening the gate it watches.
  it('has zero SUBSTANTIVE violations against the committed severity-baseline.json', () => {
    const substantive = (checkSpecSeverity(loadSeveritySnapshot()) as string[]).filter((v) => !v.startsWith('INDETERMINATE:'))
    expect(substantive).toEqual([])
  })

  it('reports arms (a) and (c) as unmeasured exactly when origin/main is unreachable', () => {
    const snapshot = loadSeveritySnapshot() as Snapshot
    const indeterminate = (checkSpecSeverity(snapshot) as string[]).filter((v) => v.startsWith('INDETERMINATE:'))
    expect(indeterminate.length === 1).toBe(Boolean(snapshot.baselineMain.unavailable))
  })

  it('records every live id, so arm (d) is satisfied by the corpus and not only by synthetics', () => {
    const {baselineHead, live} = loadSeveritySnapshot() as Snapshot
    expect(Object.keys(live.severities).filter((id) => !(id in baselineHead.severities))).toEqual([])
  })
})
