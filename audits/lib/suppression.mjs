import {appendFile} from 'node:fs/promises'
import {CLOUDFRONT_BASE, ENDPOINTS, HIDING_FOCUS_MODES} from '@j0nathan-ll0yd/portal-contract/constants'
import {fetchStable} from './http.mjs'

export const SUPPRESSION_MAX_AGE_MS = 24 * 60 * 60 * 1000
export const FOCUS_URL = `${CLOUDFRONT_BASE}${ENDPOINTS.focus}`

const HIDING_MODES = new Set(HIDING_FOCUS_MODES)
const TRANSITION_FIELDS = [
  'hidingTransitionAt',
  'hidingTransitionedAt',
  'hidingTransitionTimestamp',
  'hidingSince',
  'hidingStartedAt',
  'suppressionStartedAt',
  'suppressedAt'
]

export function suppressionBody(value) {
  return Boolean(value && typeof value === 'object' && value.suppressed === true && typeof value.reason === 'string')
}

export function hidingTransitionAt(focus) {
  if (!focus || typeof focus !== 'object') {
    return null
  }
  for (const field of TRANSITION_FIELDS) {
    const value = focus[field]
    if (typeof value === 'string' && !Number.isNaN(Date.parse(value))) {
      return value
    }
  }
  return null
}

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
      status: 'suppressed',
      currentFocus: focus.currentFocus,
      transitionAt: null,
      hiddenForMs: null,
      reason: 'focus mode active; hiding-transition timestamp unavailable'
    }
  }

  const hiddenForMs = Math.max(0, now.getTime() - Date.parse(transitionAt))
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
    return {status: 'indeterminate', reason: `focus.json probe returned HTTP ${response.status}`}
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
    return `INDETERMINATE: suppression probe unavailable (${result.reason}); running ${label}`
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
