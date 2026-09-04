import {describe, expect, it, vi} from 'vitest'
import {evaluateFocusState, probeSuppression, suppressionBody, suppressionDisposition} from '../lib/suppression.mjs'

const NOW = new Date('2026-08-27T12:00:00.000Z')

describe('focus suppression probe', () => {
  it('recognizes the disclosure body exactly enough to avoid treating arbitrary errors as suppression', () => {
    expect(suppressionBody({suppressed: true, reason: 'focus mode active'})).toBe(true)
    expect(suppressionBody({suppressed: true})).toBe(false)
    expect(suppressionBody({reason: 'focus mode active'})).toBe(false)
  })

  it('skips a current hiding period without a transition timestamp', () => {
    expect(evaluateFocusState({currentFocus: 'Do Not Disturb'}, NOW)).toEqual(expect.objectContaining({status: 'suppressed', transitionAt: null}))
  })

  it('reads the producer hiding-transition timestamp and escalates only after 24 hours', () => {
    expect(evaluateFocusState({currentFocus: 'Work', hidingTransitionAt: '2026-08-26T12:00:00.000Z'}, NOW).status).toBe('suppressed')
    expect(evaluateFocusState({currentFocus: 'Work', hidingTransitionAt: '2026-08-26T11:59:59.999Z'}, NOW).status).toBe('overdue')
  })

  it('degrades an unavailable focus probe to indeterminate so callers can run their normal check', async () => {
    const result = await probeSuppression({fetchImpl: vi.fn().mockRejectedValue(new Error('offline'))})
    expect(result).toEqual({status: 'indeterminate', reason: 'focus.json probe failed: offline'})
    expect(suppressionDisposition(result, 'fixture', {log: vi.fn(), warn: vi.fn(), error: vi.fn()})).toBe('run')
  })
})
