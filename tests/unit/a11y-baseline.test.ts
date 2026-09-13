// Structural gate on the per-widget a11y ratchet's own input (atlas phoenix-eval GAP 4 / W16).
//
// The scan helper in tests/behavioral/a11y.ts can only judge the keys it is asked about. Nothing
// there notices a baseline entry for a scan key that no longer exists -- and a grandfathering for
// a deleted state READS AS COVERED, which is exactly the failure the DS component-catalog ratchet
// blocks on for a deleted widget. These checks are cheap and run in the normal `pnpm test:unit`
// lane, so a stale baseline is caught without booting a browser.

import {describe, expect, it} from 'vitest'
import {A11Y_SCAN_TARGETS, loadA11yBaseline, parseA11yBaseline, parseA11yScanTargets, TARGET_BY_KEY} from '../behavioral/a11y-scan-targets'

const baseline = loadA11yBaseline()
const declaredKeys = new Set(A11Y_SCAN_TARGETS.map((target) => target.key))

describe('a11y baseline', () => {
  it('parses and is self-documenting', () => {
    expect(baseline.description).toContain('Grandfathered')
    expect(baseline.generatedBy).toBe('pnpm run a11y:update-baseline')
    // The ceiling statement is load-bearing: it is the only place a reader of the committed
    // artifact is told that a green gate is a floor and not WCAG conformance.
    expect(baseline.automationCeiling).toMatch(/57%/)
    expect(baseline.automationCeiling).toMatch(/32%/)
    expect(baseline.automationCeiling).toMatch(/2\.4\.3/)
    expect(baseline.automationCeiling).toMatch(/2\.4\.7/)
  })

  it('grandfathers only declared scan keys', () => {
    const stale = Object.keys(baseline.grandfathered).filter((key) => !declaredKeys.has(key))
    expect(stale, 'baseline keys that name no scan target -- prune them with `pnpm run a11y:update-baseline`').toEqual([])
  })

  it('lists rule ids sorted and unique, and never an empty array', () => {
    for (const [key, ruleIds] of Object.entries(baseline.grandfathered)) {
      expect([...ruleIds], `${key} must be sorted`).toEqual([...ruleIds].sort())
      expect(new Set(ruleIds).size, `${key} must not repeat a rule id`).toBe(ruleIds.length)
      // An empty array is indistinguishable from an absent key at the gate, but it reads as
      // "we looked and grandfathered nothing" -- omit the key instead.
      expect(ruleIds.length, `${key} carries an empty list; omit the key`).toBeGreaterThan(0)
    }
  })
})

describe('a11y scan targets', () => {
  it('declares a unique key per scanned state', () => {
    expect(new Set(A11Y_SCAN_TARGETS.map((target) => target.key)).size).toBe(A11Y_SCAN_TARGETS.length)
    expect(TARGET_BY_KEY.size).toBe(A11Y_SCAN_TARGETS.length)
  })

  it('scopes every scan to a single widget card, never the page', () => {
    for (const {key, selector} of A11Y_SCAN_TARGETS) {
      expect(selector, `${key} must target one card id`).toMatch(/^#card[A-Za-z]+$/)
    }
  })

  // The waiver turns off the "axe reached this card" guard, which is the only thing standing
  // between a card that stopped rendering and a clean-looking scan of nothing. Keep it rare and
  // keep it deliberate: every waived state is listed here by name, so adding one is a diff a
  // reviewer sees rather than a default that spreads.
  it('waives the applicable-node guard only for states measured to be WCAG-sparse', () => {
    const waived = A11Y_SCAN_TARGETS.filter((target) => !target.expectsWcagApplicableNodes)
    // Every entry here was measured, not assumed: each of these cards renders only headings and
    // text in the listed state -- no link, image, control or landmark -- so the WCAG-tagged rule
    // set legitimately matches nothing. The populated sibling state of each widget is deliberately
    // NOT waived (articles/baseline, devlog/baseline, health/workoutsBranded all render anchors),
    // so every widget keeps at least one state where the "axe reached this card" guard is live.
    expect(waived.map((target) => target.key)).toEqual([
      'bookshelf/empty',
      'health/hydrationZero',
      'health/hydrationMax',
      'health/sleepBaseline',
      'health/sleepDeepDominant',
      'health/sleepEmpty',
      'health/workoutsMulti',
      'articles/empty',
      'devlog/empty'
    ])
    for (const target of waived) {
      expect(target.sparseReason, `${target.key} must state a measured reason`).toMatch(/Measured/)
    }
  })
})

describe('parseA11yScanTargets', () => {
  const target = {key: 'w/s', selector: '#cardBooks', expectsWcagApplicableNodes: true}
  const wrap = (...targets: unknown[]) => JSON.stringify({targets})

  it('accepts a well-formed declaration', () => {
    expect(parseA11yScanTargets(wrap(target))).toEqual([target])
  })

  it('keeps a stated sparseReason', () => {
    const sparse = {...target, expectsWcagApplicableNodes: false, sparseReason: 'Measured: nothing applies'}
    expect(parseA11yScanTargets(wrap(sparse))[0]?.sparseReason).toBe('Measured: nothing applies')
  })

  it.each([
    ['a non-object root', '{}'],
    ['an empty target list', wrap()],
    ['a missing key', wrap({selector: '#cardBooks', expectsWcagApplicableNodes: true})],
    // A page-wide or multi-element selector would silently duplicate the whole-page pa11y lane.
    ['a page-wide selector', wrap({...target, selector: 'body'})],
    ['a multi-element selector', wrap({...target, selector: '.tri-card'})],
    ['a non-boolean guard flag', wrap({...target, expectsWcagApplicableNodes: 'yes'})],
    ['a waiver with no reason', wrap({...target, expectsWcagApplicableNodes: false})],
    ['a waiver with a blank reason', wrap({...target, expectsWcagApplicableNodes: false, sparseReason: '   '})],
    ['a duplicate key', wrap(target, target)]
  ])('throws on %s', (_label, raw) => {
    expect(() => parseA11yScanTargets(raw)).toThrow()
  })
})

describe('parseA11yBaseline', () => {
  const valid = JSON.stringify({
    description: 'Grandfathered ...',
    generatedBy: 'pnpm run a11y:update-baseline',
    automationCeiling: '57% / 32%, 2.4.3 and 2.4.7 manual',
    grandfathered: {'bookshelf/baseline': ['color-contrast']}
  })

  it('accepts a well-formed baseline', () => {
    expect(parseA11yBaseline(valid).grandfathered['bookshelf/baseline']).toEqual(['color-contrast'])
  })

  // A gate that greens when its own input is missing or malformed is not a gate.
  it.each([
    ['not JSON at all', '{'],
    ['a JSON array', '[]'],
    ['a JSON scalar', '"nope"'],
    ['a missing ceiling statement', JSON.stringify({description: 'a', generatedBy: 'b', grandfathered: {}})],
    ['a non-object grandfathered', JSON.stringify({description: 'a', generatedBy: 'b', automationCeiling: 'c', grandfathered: []})],
    ['a non-string rule id', JSON.stringify({description: 'a', generatedBy: 'b', automationCeiling: 'c', grandfathered: {'x/y': [1]}})]
  ])('throws on %s', (_label, raw) => {
    expect(() => parseA11yBaseline(raw)).toThrow()
  })
})
