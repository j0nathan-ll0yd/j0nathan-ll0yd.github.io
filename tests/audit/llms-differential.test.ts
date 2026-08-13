// tests/audit/llms-differential.test.ts -- the reusable differential harness
// reproducing atlas decision 0036 (posture 3, llms.txt).
//
// 0036 asked the Deletion Test question: the declared rule cases all pass
// against a blind regeneration of validateLlmsTxt, so does that green mean
// CORRECT? It does not. Three behaviours diverge between the original and the
// regeneration, and the 12-rule catalog cannot see any of them:
//   1. missing H1        the original returns early and stops; the regeneration
//                        keeps checking the section rules.
//   2. second H1         the original emits one finding PER offending line; the
//                        regeneration emits one per body.
//   3. bare trailing colon  "- [n](u):" passes the original and fails the
//                        regeneration.
//
// 0036 found them with 406 lines of one-off fuzz, classify, and diff drivers.
// This file is the same finding expressed as one call to
// scripts/audit/lib/differential.mjs.

import {describe, expect, it} from 'vitest'
import {differential} from '../../scripts/audit/lib/differential.mjs'
import {validateLlmsTxt} from '../../scripts/audit/validate-llms-txt.mjs'
import {validateLlmsTxt as regenerated} from './fixtures/validate-llms-txt.regenerated.mjs'
import {llmsTxtBodyArb} from './llms-txt-arbitraries'

type Finding = {id: string; severity: string}

const H1_RE = /^#\s+\S/

// Findings are compared as a MULTISET: emission order is not behaviour, but the
// COUNT is -- divergence class 2 is a count difference and nothing else.
const bag = (findings: Finding[]) => {
  const counts: Record<string, number> = {}
  for (const finding of findings) {
    const key = `${finding.id}::${finding.severity}`
    counts[key] = (counts[key] ?? 0) + 1
  }
  return counts
}

const sameBag = (a: Finding[], b: Finding[]) => JSON.stringify(Object.entries(bag(a)).sort()) === JSON.stringify(Object.entries(bag(b)).sort())

const classify = (input: string, a: Finding[], b: Finding[]) => {
  const firstNonBlank = input.split(/\r\n|\r|\n/).find((line) => line.trim() !== '')
  if (firstNonBlank === undefined || !H1_RE.test(firstNonBlank)) {
    return 'missing-h1-early-return'
  }
  const [left, right] = [bag(a), bag(b)]
  const differing = [...new Set([...Object.keys(left), ...Object.keys(right)])].filter((key) => (left[key] ?? 0) !== (right[key] ?? 0))
  if (differing.every((key) => key.startsWith('llms-txt-second-h1'))) {
    return 'second-h1-per-line-vs-per-body'
  }
  if (differing.every((key) => key.startsWith('llms-txt-second-h1') || key.startsWith('llms-txt-non-link-list-item'))) {
    return 'bare-trailing-colon-accepted'
  }
  return null
}

describe('differential: validateLlmsTxt against its blind regeneration', () => {
  const result = differential(validateLlmsTxt, regenerated, llmsTxtBodyArb, {eq: sameBag, classify})

  it('finds the three divergence classes atlas decision 0036 reported', () => {
    expect(result.divergent).toBeGreaterThan(0)
    expect(Object.keys(result.byClass).sort()).toEqual(['bare-trailing-colon-accepted', 'missing-h1-early-return', 'second-h1-per-line-vs-per-body'])
  })

  it('attributes every divergence to a known class', () => {
    expect(result.unclassifiedCount).toBe(0)
  })

  it('reports a minimal reproducing input per class', () => {
    for (const label of Object.keys(result.byClass)) {
      expect(result.minimalPerClass[label]).toBeTruthy()
    }
    // The catalog declares no case with a bare trailing colon, so this witness
    // is exactly the behaviour the 12 rule files cannot see.
    expect(result.minimalPerClass['bare-trailing-colon-accepted']).toContain('):')
  })
})
