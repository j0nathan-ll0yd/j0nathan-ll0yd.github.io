// Per-widget accessibility scanning for the behavioral matrices (atlas phoenix-eval GAP 4 / W16).
//
// WHAT THIS IS
// Every state a behavioral matrix already renders also gets a scoped axe-core scan of that
// widget's own card. The scan is scoped to ONE card, never to the page: the whole-page verdict
// belongs to the weekly B4 pa11y-ci lane (.github/workflows/audit-web.yml), and a page-scoped scan
// here would refile B4's findings against every widget that happens to share the dashboard.
//
// WHAT THIS IS NOT -- THE HONEST CEILING. READ THIS BEFORE CITING A GREEN RUN AS EVIDENCE.
// Automated scanning catches roughly 57% of accessibility ISSUE VOLUME and maps to about 32% of
// WCAG success criteria. Focus Order (WCAG 2.4.3) and Focus Visible (WCAG 2.4.7) are 100% manual
// and nothing in this file touches them. Screen-reader comprehensibility, meaningful alt text,
// logical heading order in context, and keyboard operability of custom widgets are all outside
// what axe can decide. A green run here is evidence that a SPECIFIC CLASS of defect is absent.
// It is an automated FLOOR. It is NOT WCAG conformance and must never be reported as such.
//
// SEVERITY SCOPE. The gate asserts on axe impact `serious` and `critical` only. `moderate` and
// `minor` findings are out of its scope by design -- they are the whole-page lane's business, and
// blocking on them would have grandfathered a much larger baseline without changing what the gate
// can actually prove.
//
// CONTRAST IS NOT COVERED -- MEASURED, NOT ASSUMED (2026-08-31, playwright noble image,
// axe-core 4.13). `color-contrast` returns INAPPLICABLE for every card-scoped scan here and
// INCOMPLETE for a whole-page scan of the same DOM. The dashboard's cards are translucent over an
// animated gradient, so axe cannot resolve a background colour and declines to rule either way.
// Neither this lane nor the B4 pa11y lane can therefore report a contrast defect on this site, and
// contrast is the single highest-volume defect class. Treat it as a MANUAL check, alongside Focus
// Order and Focus Visible. Do not read a green run as evidence of adequate contrast.
//
// THE RATCHET. Most of these widgets had never been a11y-tested, so the first run found
// pre-existing violations. They are grandfathered into a11y-baseline.json, in the estate ratchet
// shape (mantle-LifegamesPortal/openspec/covers-baseline.json,
// design-system-Lifegames/contracts/component-catalog/conformance-baseline.json). A NEW violation,
// or any violation not listed for that exact scan key, FAILS. A grandfathered one PASSES and is
// carried as recorded debt. Fixing a violation prunes its id in the same PR
// (`pnpm run a11y:update-baseline`). Widget-level fixes land in design-system-Lifegames -- this
// repo renders no widget source -- and never by narrowing AXE_TAGS or excluding a node.

import {appendFileSync, mkdirSync} from 'node:fs'
import {dirname} from 'node:path'
import AxeBuilder from '@axe-core/playwright'
import {expect, type Page} from '@playwright/test'
import {AXE_TAGS, isBlockingImpact, loadA11yBaseline, OBSERVED_PATH, TARGET_BY_KEY} from './a11y-scan-targets'

const baseline = loadA11yBaseline()

const isUpdatingBaseline = process.env.A11Y_UPDATE_BASELINE === '1'

function recordObserved(key: string, ruleIds: readonly string[], allViolations: readonly string[], counts: Readonly<Record<string, number>>): void {
  mkdirSync(dirname(OBSERVED_PATH), {recursive: true})
  // `allViolations` carries every impact, including the moderate/minor findings the gate does not
  // block on, and `counts` records how much axe actually evaluated. Only `ruleIds` reaches the
  // baseline; the rest is there so a regeneration leaves a readable record of what was seen and
  // deliberately not gated.
  appendFileSync(OBSERVED_PATH, `${JSON.stringify({key, ruleIds, allViolations, counts})}\n`)
}

/**
 * Scan ONE widget card in ONE state and fail on any serious/critical violation that is not
 * grandfathered for this exact scan key.
 *
 * @param page the page under test, already in the state being asserted
 * @param key a key declared in `A11Y_SCAN_TARGETS`
 */
export async function expectNoNewAxeViolations(page: Page, key: string): Promise<void> {
  const target = TARGET_BY_KEY.get(key)
  if (target === undefined) {
    throw new Error(`a11y scan key "${key}" is not declared in A11Y_SCAN_TARGETS (tests/behavioral/a11y-scan-targets.ts)`)
  }
  const {selector} = target
  // Fail loud rather than scanning nothing: axe with an unmatched include reports no violations,
  // which would silently turn a per-widget gate into a permanent pass.
  await expect(page.locator(selector), `a11y scan target ${selector} must exist for ${key}`).toHaveCount(1)

  const results = await new AxeBuilder({page}).include(selector).withTags([...AXE_TAGS]).analyze()
  const {violations, passes, incomplete, inapplicable} = results

  const blocking = violations.filter((violation) => isBlockingImpact(violation.impact))
  const observed = [...new Set(blocking.map((violation) => violation.id))].sort()

  if (isUpdatingBaseline) {
    recordObserved(key, observed, violations.map((violation) => `${violation.impact}: ${violation.id}`).sort(), {
      passes: passes.length,
      violations: violations.length,
      incomplete: incomplete.length,
      inapplicable: inapplicable.length
    })
  }

  // A scan that evaluated nothing reports zero violations, which reads exactly like a clean
  // widget. That is the failure mode this whole gate would die of silently, so prove work
  // happened. Two separate facts, because they fail differently:
  //   1. axe RAN at all -- a blocked injection (the site is CSP `script-src 'self'`) or a tag set
  //      matching no rules leaves every list empty, `inapplicable` included.
  expect(passes.length + violations.length + incomplete.length + inapplicable.length, `axe produced no result at all for ${key}; it did not run`)
    .toBeGreaterThan(0)
  //   2. axe REACHED nodes in THIS card -- a card that stopped rendering leaves `inapplicable`
  //      full (rules ran, against nothing here) while every node-level list is empty. Waived only
  //      for states declared WCAG-sparse, each with a measured reason at its declaration site.
  if (target.expectsWcagApplicableNodes) {
    expect(passes.length + violations.length + incomplete.length,
      `axe evaluated no node inside ${selector} for ${key}; the scan proved nothing about this widget`).toBeGreaterThan(0)
  }

  if (isUpdatingBaseline) {
    return
  }

  const allowed = new Set(baseline.grandfathered[key] ?? [])

  const stale = [...allowed].filter((ruleId) => !observed.includes(ruleId))
  if (stale.length > 0) {
    // Reported, not blocking -- the same PRUNABLE semantics the covers ratchet uses. Prune with
    // `pnpm run a11y:update-baseline` in the PR that fixed the rule.
    console.warn(`[a11y ratchet] PRUNABLE ${key}: grandfathered rules no longer firing: ${stale.join(', ')}`)
  }

  const unexpected = blocking.filter((violation) => !allowed.has(violation.id)).map((violation) =>
    `${violation.impact}: ${violation.id} -- ${violation.help} (${violation.nodes.length} node(s))`
  ).sort()

  // Assert on the mapped strings, not the raw result objects, so a failure names the rule instead
  // of dumping a serialized DOM.
  expect(unexpected,
    `New serious/critical axe violations in ${key} (${selector}). Fix them at the widget in ` +
      'design-system-Lifegames; grandfather only with a stated reason via `pnpm run a11y:update-baseline`.').toEqual([])
}
