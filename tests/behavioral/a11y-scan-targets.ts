// Declarations and baseline I/O for the per-widget accessibility gate (atlas phoenix-eval GAP 4 /
// W16). Read tests/behavioral/a11y.ts for what the gate does and, more importantly, for the honest
// statement of what automated scanning can and cannot prove.
//
// This module is deliberately free of any Playwright or axe import so the structural baseline
// checks can run under Vitest (tests/unit/a11y-baseline.test.ts) without booting a browser.

import {readFileSync} from 'node:fs'
import {dirname, join} from 'node:path'
import {fileURLToPath} from 'node:url'

const HERE = dirname(fileURLToPath(import.meta.url))

export const BASELINE_PATH = join(HERE, 'a11y-baseline.json')

/** Where an `A11Y_UPDATE_BASELINE=1` run records what it observed, for scripts/update-a11y-baseline.mjs. */
export const OBSERVED_PATH = join(HERE, '..', '..', 'test-results', 'a11y-observed.jsonl')

/**
 * WCAG-only rule set. Axe also ships best-practice rules (`best-practice` tag) that encode
 * opinions rather than success criteria; including them would make the gate argue about style.
 */
export const AXE_TAGS: readonly string[] = ['wcag2a', 'wcag2aa', 'wcag21a', 'wcag21aa']

/** The only impacts this gate blocks on. See the SEVERITY SCOPE note in a11y.ts. */
export const BLOCKING_IMPACTS: readonly string[] = ['serious', 'critical']

/** `impact` is `ImpactValue | null | undefined` in the axe types; a null impact never blocks. */
export function isBlockingImpact(impact: string | null | undefined): boolean {
  return typeof impact === 'string' && BLOCKING_IMPACTS.includes(impact)
}

export const TARGETS_PATH = join(HERE, 'a11y-scan-targets.json')

/**
 * One declared scan: a widget card, in one state a behavioral matrix renders.
 *
 * The list lives in a11y-scan-targets.json rather than in this file so that
 * scripts/update-a11y-baseline.mjs reads the SAME declarations without parsing TypeScript.
 */
export interface A11yScanTarget {
  /** Stable key: `<widget>/<state>`. Also the baseline key. */
  readonly key: string
  /** The widget card selector the scan is scoped to. */
  readonly selector: string
  /**
   * Whether at least one WCAG-tagged axe rule is expected to reach a node inside this card in this
   * state. True for every state that renders real content; the gate asserts it, so a card that
   * silently stops rendering reds instead of reporting a clean scan of nothing. False requires a
   * measured `sparseReason`.
   */
  readonly expectsWcagApplicableNodes: boolean
  /** Why this state matches no WCAG-tagged rule. Required when the guard is waived. */
  readonly sparseReason?: string
}

function parseTarget(value: unknown, index: number): A11yScanTarget {
  const at = `a11y-scan-targets.json: targets[${index}]`
  if (typeof value !== 'object' || value === null || Array.isArray(value)) {
    throw new Error(`${at} must be an object`)
  }
  const record: Record<string, unknown> = {...value}
  const {key, selector, expectsWcagApplicableNodes, sparseReason} = record
  if (typeof key !== 'string' || key === '') {
    throw new Error(`${at}.key must be a non-empty string`)
  }
  // A page-wide or multi-element selector would silently turn this into a duplicate of the
  // whole-page pa11y lane, refiling one finding against every widget on the dashboard.
  if (typeof selector !== 'string' || !/^#card[A-Za-z]+$/.test(selector)) {
    throw new Error(`${at}.selector must be a single widget card id, got ${JSON.stringify(selector)}`)
  }
  if (typeof expectsWcagApplicableNodes !== 'boolean') {
    throw new Error(`${at}.expectsWcagApplicableNodes must be a boolean`)
  }
  if (sparseReason !== undefined && typeof sparseReason !== 'string') {
    throw new Error(`${at}.sparseReason must be a string when present`)
  }
  // Waiving the guard without saying why is how a measured exception decays into a default.
  if (!expectsWcagApplicableNodes && (sparseReason === undefined || sparseReason.trim() === '')) {
    throw new Error(`${at} waives expectsWcagApplicableNodes without a sparseReason`)
  }
  return sparseReason === undefined
    ? {key, selector, expectsWcagApplicableNodes}
    : {key, selector, expectsWcagApplicableNodes, sparseReason}
}

export function parseA11yScanTargets(raw: string): readonly A11yScanTarget[] {
  const parsed: unknown = JSON.parse(raw)
  if (typeof parsed !== 'object' || parsed === null || Array.isArray(parsed)) {
    throw new Error('a11y-scan-targets.json: expected a JSON object')
  }
  const record: Record<string, unknown> = {...parsed}
  const {targets} = record
  if (!Array.isArray(targets) || targets.length === 0) {
    throw new Error('a11y-scan-targets.json: targets must be a non-empty array')
  }
  const declared = targets.map(parseTarget)
  const keys = new Set(declared.map((target) => target.key))
  if (keys.size !== declared.length) {
    throw new Error('a11y-scan-targets.json: every target key must be unique')
  }
  return declared
}

export const A11Y_SCAN_TARGETS: readonly A11yScanTarget[] = parseA11yScanTargets(readFileSync(TARGETS_PATH, 'utf8'))

export const TARGET_BY_KEY: ReadonlyMap<string, A11yScanTarget> = new Map(A11Y_SCAN_TARGETS.map((target) => [target.key, target]))

export interface A11yBaseline {
  readonly description: string
  readonly generatedBy: string
  readonly automationCeiling: string
  /** scan key -> sorted, unique axe rule ids grandfathered for that key. */
  readonly grandfathered: Readonly<Record<string, readonly string[]>>
}

function isStringArray(value: unknown): value is string[] {
  return Array.isArray(value) && value.every((entry) => typeof entry === 'string')
}

/**
 * Structural validation of the committed baseline. A missing or unparseable baseline is a hard
 * RED, never a pass -- a gate that greens when its own input is missing is not a gate.
 */
export function parseA11yBaseline(raw: string): A11yBaseline {
  const parsed: unknown = JSON.parse(raw)
  if (typeof parsed !== 'object' || parsed === null || Array.isArray(parsed)) {
    throw new Error('a11y-baseline.json: expected a JSON object')
  }
  const record: Record<string, unknown> = {...parsed}
  const {description, generatedBy, automationCeiling, grandfathered} = record
  if (typeof description !== 'string' || typeof generatedBy !== 'string' || typeof automationCeiling !== 'string') {
    throw new Error('a11y-baseline.json: description, generatedBy and automationCeiling must be strings')
  }
  if (typeof grandfathered !== 'object' || grandfathered === null || Array.isArray(grandfathered)) {
    throw new Error('a11y-baseline.json: grandfathered must be an object keyed by scan key')
  }
  const entries: Record<string, readonly string[]> = {}
  for (const [key, value] of Object.entries({...grandfathered})) {
    if (!isStringArray(value)) {
      throw new Error(`a11y-baseline.json: grandfathered["${key}"] must be an array of axe rule ids`)
    }
    entries[key] = value
  }
  return {description, generatedBy, automationCeiling, grandfathered: entries}
}

export function loadA11yBaseline(): A11yBaseline {
  return parseA11yBaseline(readFileSync(BASELINE_PATH, 'utf8'))
}
