import {describe, expect, it, vi} from 'vitest'
import focusSchema from '@j0nathan-ll0yd/portal-contract/raw-schemas/focus-export.schema.json' with {type: 'json'}
import {
  evaluateFocusState,
  HIDING_SINCE_FIELD,
  hidingTransitionAt,
  probeSuppression,
  SUPPRESSION_MAX_AGE_MS,
  suppressionBody,
  suppressionDisposition,
  suppressionMessage
} from '../lib/suppression.mjs'

const NOW = new Date('2026-08-27T12:00:00.000Z')

/** `now` minus `ms`, as the ISO string a producer would write into focus.json. */
function hidingSince(ms: number): string {
  return new Date(NOW.getTime() - ms).toISOString()
}

/** The three console methods suppressionDisposition actually calls. */
function quietLogger(): Console {
  return {log: vi.fn(), warn: vi.fn(), error: vi.fn()} as unknown as Console
}

describe('focus suppression probe', () => {
  it('recognizes the disclosure body exactly enough to avoid treating arbitrary errors as suppression', () => {
    expect(suppressionBody({suppressed: true, reason: 'focus mode active'})).toBe(true)
    expect(suppressionBody({suppressed: true})).toBe(false)
    expect(suppressionBody({reason: 'focus mode active'})).toBe(false)
  })

  it('degrades an unavailable focus probe to indeterminate so callers can run their normal check', async () => {
    const result = await probeSuppression({fetchImpl: vi.fn().mockRejectedValue(new Error('offline'))})
    expect(result).toEqual({status: 'indeterminate', reason: 'focus.json probe failed: offline'})
    expect(suppressionDisposition(result, 'fixture', quietLogger())).toBe('run')
  })

  // The focus signal is meant to be ungated, but the edge suppression response is a shape this
  // probe can meet. Naming it keeps a privacy-gated probe distinguishable from an outage in the
  // evidence, while staying INDETERMINATE: the disclosure body establishes no duration bound.
  it('names the edge suppression disclosure body when the focus probe meets one', async () => {
    const fetchImpl = vi.fn().mockResolvedValue(new Response(JSON.stringify({suppressed: true, reason: 'focus mode active'}), {status: 503}))

    const result = await probeSuppression({fetchImpl})

    expect(result.status).toBe('indeterminate')
    expect(result.reason).toContain('HTTP 503 with the suppression disclosure body (focus mode active)')
    expect(result.reason).toContain('no hiding-transition timestamp')
    expect(suppressionDisposition(result, 'fixture', quietLogger())).toBe('run')
  })

  it('reports a non-disclosure failure body by status alone', async () => {
    const fetchImpl = vi.fn().mockResolvedValue(new Response('<html>gateway</html>', {status: 502}))

    const result = await probeSuppression({fetchImpl})

    expect(result).toEqual({status: 'indeterminate', reason: 'focus.json probe returned HTTP 502'})
  })
})

describe('hiding-transition field', () => {
  // The tether atlas decision 0142 asked for: this repo probed seven transition field names, six
  // of which the contract can never carry. A closed schema means an unknown name is not tolerance,
  // it is a wider set of shapes that can mint a bounded-suppression verdict. If the producer ever
  // adds a second timing field, this reds rather than letting the helper drift behind it.
  it('is the only timing field the portal contract can carry', () => {
    expect(focusSchema.additionalProperties).toBe(false)
    expect(Object.keys(focusSchema.properties)).toEqual(['generatedAt', 'currentFocus', HIDING_SINCE_FIELD])
    expect(HIDING_SINCE_FIELD).toBe('hidingSince')
  })

  it('reads hidingSince and ignores names the contract rejects', () => {
    expect(hidingTransitionAt({hidingSince: '2026-08-26T12:00:00.000Z'})).toBe('2026-08-26T12:00:00.000Z')
    expect(hidingTransitionAt({hidingTransitionAt: '2026-08-26T12:00:00.000Z'})).toBeNull()
    expect(hidingTransitionAt({suppressedAt: '2026-08-26T12:00:00.000Z'})).toBeNull()
    expect(hidingTransitionAt({hidingSince: 'not-a-date'})).toBeNull()
    expect(hidingTransitionAt(null)).toBeNull()
  })
})

describe('bounded-suppression evidence', () => {
  it('passes through a non-hiding focus mode untouched', () => {
    expect(evaluateFocusState({currentFocus: 'Personal', hidingSince: hidingSince(0)}, NOW)).toEqual({
      status: 'visible',
      currentFocus: 'Personal',
      reason: 'focus mode is not hiding public data'
    })
  })

  it('escalates only past the 24-hour bound', () => {
    expect(evaluateFocusState({currentFocus: 'Work', hidingSince: hidingSince(SUPPRESSION_MAX_AGE_MS)}, NOW).status).toBe('suppressed')
    expect(evaluateFocusState({currentFocus: 'Work', hidingSince: hidingSince(SUPPRESSION_MAX_AGE_MS + 1)}, NOW).status).toBe('overdue')
  })

  it('treats a hidingSince equal to now as a bounded window of zero elapsed time', () => {
    const result = evaluateFocusState({currentFocus: 'Do Not Disturb', hidingSince: hidingSince(0)}, NOW)
    expect(result.status).toBe('suppressed')
    expect(result.hiddenForMs).toBe(0)
  })

  // THE DEFECT atlas decision 0142 named. `suppressed` is a positive claim -- this window is
  // bounded and has run for hiddenForMs of its limit. A missing timestamp used to grant it
  // outright, and a FUTURE timestamp was clamped to zero elapsed time by a Math.max(0, ...) and
  // granted it too. Both stood the lane down on a bound no evidence in hand could establish.
  it('refuses to grant bounded suppression without a hidingSince', () => {
    const result = evaluateFocusState({currentFocus: 'Do Not Disturb'}, NOW)

    expect(result.status).toBe('indeterminate')
    expect(result.currentFocus).toBe('Do Not Disturb')
    expect(result.transitionAt).toBeNull()
    expect(result.hiddenForMs).toBeNull()
    expect(result.reason).toContain('hidingSince is absent or unparseable')
    expect(suppressionDisposition(result, 'fixture', quietLogger())).toBe('run')
  })

  it('refuses to grant bounded suppression from a future hidingSince, at the boundary and beyond', () => {
    const oneMillisecondAhead = evaluateFocusState({currentFocus: 'Work', hidingSince: hidingSince(-1)}, NOW)
    const anHourAhead = evaluateFocusState({currentFocus: 'Work', hidingSince: hidingSince(-60 * 60 * 1000)}, NOW)

    for (const result of [oneMillisecondAhead, anHourAhead]) {
      expect(result.status).toBe('indeterminate')
      expect(result.hiddenForMs).toBeNull()
      expect(result.reason).toContain('is in the future')
      expect(suppressionDisposition(result, 'fixture', quietLogger())).toBe('run')
    }
    expect(oneMillisecondAhead.transitionAt).toBe(hidingSince(-1))
  })

  it('reports incomplete evidence as evidence, not as an unavailable probe', () => {
    const message = suppressionMessage(evaluateFocusState({currentFocus: 'Work'}, NOW), 'fixture')
    expect(message).toContain('INDETERMINATE: suppression evidence incomplete')
    expect(message).toContain('running fixture')
  })

  it('still skips and still escalates when the evidence IS complete', () => {
    const logger = quietLogger()
    const bounded = evaluateFocusState({currentFocus: 'Work', hidingSince: hidingSince(60_000)}, NOW)
    const overdue = evaluateFocusState({currentFocus: 'Work', hidingSince: hidingSince(SUPPRESSION_MAX_AGE_MS + 1)}, NOW)

    expect(suppressionDisposition(bounded, 'fixture', logger)).toBe('skip')
    expect(suppressionDisposition(overdue, 'fixture', logger)).toBe('fail')
  })
})
