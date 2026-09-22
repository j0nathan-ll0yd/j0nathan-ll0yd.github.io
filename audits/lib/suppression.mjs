import {appendFile} from 'node:fs/promises'
import {CLOUDFRONT_BASE, ENDPOINTS, HIDING_FOCUS_MODES} from '@j0nathan-ll0yd/portal-contract/constants'
import {fetchStable} from './http.mjs'

export const SUPPRESSION_MAX_AGE_MS = 24 * 60 * 60 * 1000
export const FOCUS_URL = `${CLOUDFRONT_BASE}${ENDPOINTS.focus}`

const HIDING_MODES = new Set(HIDING_FOCUS_MODES)

/**
 * The ONE hiding-transition field, and the only one the contract can carry.
 *
 * `@j0nathan-ll0yd/portal-contract/raw-schemas/focus.json` declares exactly three properties
 * (`generatedAt`, `currentFocus`, `hidingSince`) under `additionalProperties: false`, so a
 * producer response carrying `hidingTransitionAt`, `hidingStartedAt`, `suppressionStartedAt` or
 * any of the other four names this list used to hold is a response the contract rejects. Probing
 * for names the wire can never carry read as tolerance and was the opposite: it widened the set
 * of shapes that could mint a bounded-suppression verdict without widening what the producer can
 * actually say. `audits/__tests__/suppression.test.ts` tethers this constant to the packaged
 * schema, so a contract that grows a second field reds here rather than drifting silently.
 */
export const HIDING_SINCE_FIELD = 'hidingSince'

export function suppressionBody(value) {
  return Boolean(value && typeof value === 'object' && value.suppressed === true && typeof value.reason === 'string')
}

/** The contract's hiding-transition timestamp, or null when it is absent or unparseable. */
export function hidingTransitionAt(focus) {
  if (!focus || typeof focus !== 'object') {
    return null
  }
  const value = focus[HIDING_SINCE_FIELD]
  return typeof value === 'string' && !Number.isNaN(Date.parse(value)) ? value : null
}

/**
 * Classify a focus body into the disposition every focus-gated check reads.
 *
 * `suppressed` IS A POSITIVE CLAIM: this hiding period is bounded, and it has run for
 * `hiddenForMs` of its 24-hour limit. Only a parseable, non-future `hidingSince` establishes
 * that. Absent or future timing evidence establishes nothing, so it returns `indeterminate` --
 * the check stays VISIBLE and records unknown evidence.
 *
 * This is the defect atlas decision 0142 named. A missing timestamp granted `suppressed`
 * outright, and a FUTURE timestamp was clamped to zero elapsed time by a `Math.max(0, ...)` and
 * granted it too. Either way the lane stood down on the strength of a duration bound that no
 * evidence in hand could establish, and the stand-down was indistinguishable from a bounded one.
 * Standing down is the one disposition that must never be reachable from absent evidence.
 */
export function evaluateFocusState(focus, now = new Date()) {
  if (!focus || typeof focus !== 'object' || typeof focus.currentFocus !== 'string') {
    return {status: 'indeterminate', reason: 'focus.json did not contain a currentFocus string'}
  }

  if (!HIDING_MODES.has(focus.currentFocus)) {
    return {status: 'visible', currentFocus: focus.currentFocus, reason: 'focus mode is not hiding public data'}
  }

  const transitionAt = hidingTransitionAt(focus)
  if (!transitionAt) {
    return {
      status: 'indeterminate',
      currentFocus: focus.currentFocus,
      transitionAt: null,
      hiddenForMs: null,
      reason: `focus mode ${JSON.stringify(focus.currentFocus)} is active but ${HIDING_SINCE_FIELD} is absent or unparseable, ` +
        'so the 24-hour suppression bound cannot be established'
    }
  }

  const hiddenForMs = now.getTime() - Date.parse(transitionAt)
  if (hiddenForMs < 0) {
    return {
      status: 'indeterminate',
      currentFocus: focus.currentFocus,
      transitionAt,
      hiddenForMs: null,
      reason: `focus mode ${JSON.stringify(focus.currentFocus)} is active but ${HIDING_SINCE_FIELD} ${transitionAt} is in the future, ` +
        'so no elapsed hiding time is established'
    }
  }

  return {
    status: hiddenForMs > SUPPRESSION_MAX_AGE_MS ? 'overdue' : 'suppressed',
    currentFocus: focus.currentFocus,
    transitionAt,
    hiddenForMs,
    reason: hiddenForMs > SUPPRESSION_MAX_AGE_MS
      ? 'focus mode has hidden public data for more than 24 continuous hours'
      : 'focus mode active'
  }
}

export async function probeSuppression({fetchImpl = fetchStable, focusUrl = FOCUS_URL, now = new Date()} = {}) {
  let response
  try {
    response = await fetchImpl(focusUrl, {cache: 'no-store'})
  } catch (error) {
    return {status: 'indeterminate', reason: `focus.json probe failed: ${error instanceof Error ? error.message : String(error)}`}
  }

  if (!response.ok) {
    // The focus signal is meant to be ungated, but the edge suppression response is a real shape
    // this probe can meet (the site plane answers 503 with it, and an origin can answer 403).
    // Naming it separates a privacy-gated probe from an outage in the evidence, and it is still
    // INDETERMINATE: the disclosure body carries no hidingSince, so it establishes no bound.
    let body = null
    try {
      body = await response.json()
    } catch {
      // Non-JSON failures are reported by status below.
    }
    return suppressionBody(body)
      ? {
        status: 'indeterminate',
        reason: `focus.json probe returned HTTP ${response.status} with the suppression disclosure body (${body.reason}); ` +
          'it carries no hiding-transition timestamp, so the 24-hour suppression bound cannot be established'
      }
      : {status: 'indeterminate', reason: `focus.json probe returned HTTP ${response.status}`}
  }

  try {
    return evaluateFocusState(await response.json(), now)
  } catch (error) {
    return {status: 'indeterminate', reason: `focus.json was not valid JSON: ${error instanceof Error ? error.message : String(error)}`}
  }
}

export function suppressionMessage(result, label = 'check') {
  const transition = result.transitionAt ? ` since ${result.transitionAt}` : ''
  if (result.status === 'overdue') {
    return `FAIL: ${label} suppression exceeded 24 hours${transition} (${result.reason})`
  }
  if (result.status === 'suppressed') {
    return `SUPPRESSED: ${label} skipped${transition} (${result.reason})`
  }
  if (result.status === 'indeterminate') {
    // "evidence incomplete", not "probe unavailable": the probe may have answered perfectly and
    // still leave the bound unestablished, which is the missing/future hidingSince case.
    return `INDETERMINATE: suppression evidence incomplete (${result.reason}); running ${label}`
  }
  return `VISIBLE: ${label} is not focus-mode-conditioned`
}

export function suppressionDisposition(result, label = 'check', logger = console) {
  const message = suppressionMessage(result, label)
  if (result.status === 'overdue') {
    logger.error(message)
    return 'fail'
  }
  if (result.status === 'suppressed') {
    logger.log(message)
    return 'skip'
  }
  if (result.status === 'indeterminate') {
    logger.warn(message)
  }
  return 'run'
}

export async function writeGithubOutputs(result, outputPath) {
  if (!outputPath) {
    return
  }
  const suppressed = result.status === 'suppressed' || result.status === 'overdue'
  await appendFile(outputPath, [
    `status=${result.status}`,
    `suppressed=${suppressed}`,
    `run_check=${!suppressed}`,
    `reason=${String(result.reason).replace(/[\r\n]+/g, ' ')}`,
    ''
  ].join('\n'))
}
