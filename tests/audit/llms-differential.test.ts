// tests/audit/llms-differential.test.ts -- the reusable differential harness,
// used twice: to pin atlas decision 0036 forever, and to prove the v2
// relaxation changed exactly what it claims.
//
// 0036 asked the Deletion Test question: the declared rule cases all pass
// against a blind regeneration of validateLlmsTxt, so does that green mean
// CORRECT? It does not. Three behaviours diverge between the original and the
// regeneration, and the rule catalog of the day could not see any of them:
//   1. missing H1        the original returns early and stops; the regeneration
//                        keeps checking the section rules.
//   2. second H1         the original emits one finding PER offending line; the
//                        regeneration emits one per body.
//   3. bare trailing colon  "- [n](u):" passes the original and fails the
//                        regeneration.
//
// 0036 found them with 406 lines of one-off fuzz, classify, and diff drivers.
// Both suites below are one call each to scripts/audit/lib/differential.mjs.
//
// The 0036 suite compares the FROZEN v1 reference, not the live one. The
// regeneration is a v1-era artifact, so pointing it at a moving reference would
// stop reproducing 0036 the moment a rule relaxed -- which v2 then did.

import {describe, expect, it} from 'vitest'
import {differential} from '../../scripts/audit/lib/differential.mjs'
import {checkLlmsStructure as v2} from '../../scripts/audit/lib/llms-structure.mjs'
import {checkLlmsStructure as v1} from './fixtures/llms-structure.v1.mjs'
import {validateLlmsTxt as regenerated} from './fixtures/validate-llms-txt.regenerated.mjs'
import {llmsTxtBodyArb, llmsTxtV2BodyArb} from './llms-txt-arbitraries'

type Finding = {id: string}

const H1_RE = /^#\s+\S/
const SECOND_H1 = 'llms-txt-second-h1'
const NON_LINK = 'llms-txt-non-link-list-item'
const NO_FILE_LIST = 'llms-txt-h2-no-file-list'
// The three rules v2 did not touch. h2-no-file-list and non-link-list-item are
// the two it did.
const UNTOUCHED_BY_V2 = ['llms-txt-h1', 'llms-txt-blockquote', SECOND_H1]

// Findings compare as a MULTISET of ids: emission order is not behaviour, but
// the COUNT is -- 0036's divergence class 2 is a count difference and nothing
// else. Severity is excluded deliberately; both sides read it from the same
// rule catalog, so it can never be the thing that differs.
const bag = (findings: Finding[], only?: string[]) => {
  const counts: Record<string, number> = {}
  for (const finding of findings) {
    if (only && !only.includes(finding.id)) {
      continue
    }
    counts[finding.id] = (counts[finding.id] ?? 0) + 1
  }
  return counts
}

const eqOn = (only?: string[]) => (a: Finding[], b: Finding[]) =>
  JSON.stringify(Object.entries(bag(a, only)).sort()) === JSON.stringify(Object.entries(bag(b, only)).sort())

const sameBag = eqOn()

const hasValidH1 = (input: string) => {
  const firstNonBlank = input.split(/\r\n|\r|\n/).find((line) => line.trim() !== '')
  return firstNonBlank !== undefined && H1_RE.test(firstNonBlank)
}

const differingIds = (a: Finding[], b: Finding[]) => {
  const [left, right] = [bag(a), bag(b)]
  return [...new Set([...Object.keys(left), ...Object.keys(right)])].filter((id) => (left[id] ?? 0) !== (right[id] ?? 0))
}

describe('differential: frozen v1 reference against its blind regeneration (atlas decision 0036)', () => {
  const classify = (input: string, a: Finding[], b: Finding[]) => {
    if (!hasValidH1(input)) {
      return 'missing-h1-early-return'
    }
    const differing = differingIds(a, b)
    if (differing.every((id) => id === SECOND_H1)) {
      return 'second-h1-per-line-vs-per-body'
    }
    if (differing.every((id) => id === SECOND_H1 || id === NON_LINK)) {
      return 'bare-trailing-colon-accepted'
    }
    return null
  }

  const result = differential(v1, regenerated, llmsTxtBodyArb, {eq: sameBag, classify})

  it('finds the three divergence classes decision 0036 reported', () => {
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
    // The catalog of the day declared no case with a bare trailing colon, so
    // this witness is exactly the behaviour those rule files could not see.
    expect(result.minimalPerClass['bare-trailing-colon-accepted']).toContain('):')
  })
})

describe('differential: v2 reference against frozen v1 (the relaxation)', () => {
  const classify = (_input: string, a: Finding[], b: Finding[]) => {
    const differing = differingIds(a, b)
    if (differing.length === 0) {
      return null
    }
    if (differing.every((id) => id === NO_FILE_LIST)) {
      return 'prose-section-now-legal'
    }
    if (differing.every((id) => id === NON_LINK)) {
      // v2 emits FEWER for a descriptive item, MORE for an unlinked URL in the
      // notes tail -- the one place v2 tightened rather than relaxed.
      return (bag(a)[NON_LINK] ?? 0) < (bag(b)[NON_LINK] ?? 0) ? 'descriptive-item-now-legal' : 'unlinked-url-in-notes-now-fires'
    }
    if (differing.every((id) => id === NO_FILE_LIST || id === NON_LINK)) {
      return 'both-section-rules-diverge'
    }
    return null
  }

  const result = differential(v2, v1, llmsTxtV2BodyArb, {eq: sameBag, classify})

  it('changes only the two section rules, never the other three', () => {
    // The strong claim. Compared on llms-txt-h1, llms-txt-blockquote and
    // llms-txt-second-h1 alone, v2 and v1 are indistinguishable -- so the
    // relaxation cannot have disturbed the three behaviours 0036 pinned.
    const scoped = differential(v2, v1, llmsTxtV2BodyArb, {eq: eqOn(UNTOUCHED_BY_V2)})
    expect(scoped.divergent).toBe(0)
  })

  it('relaxes prose sections and descriptive items, and tightens unlinked URLs in notes', () => {
    expect(result.divergent).toBeGreaterThan(0)
    expect(Object.keys(result.byClass).sort()).toEqual([
      'both-section-rules-diverge',
      'descriptive-item-now-legal',
      'prose-section-now-legal',
      'unlinked-url-in-notes-now-fires'
    ])
  })

  it('attributes every divergence to a known class', () => {
    expect(result.unclassifiedCount).toBe(0)
  })

  it('keeps the three behaviours decision 0036 pinned', () => {
    const body = (text: string) => v2(text).map((finding) => finding.id)
    // 1. No valid H1: return early, emit only llms-txt-h1.
    expect(body('## Links\n\n- https://example.com/bare\n')).toEqual(['llms-txt-h1'])
    // 2. second-h1 per offending line, not per body.
    expect(body('# S\n\n> Sum\n\n# Two\n# Three\n')).toEqual([SECOND_H1, SECOND_H1])
    // 3. A bare trailing colon passes.
    expect(body('# S\n\n> Sum\n\n## Links\n\n- [Name](https://example.com):\n')).toEqual([])
  })
})
