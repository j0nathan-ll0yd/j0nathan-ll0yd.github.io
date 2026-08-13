// tests/audit/validate-llms-txt.property.test.ts -- the llms.txt structural
// convention stated as four executable invariants over generated documents,
// instead of as hand-written example files (Phoenix eval right-sizing pilot).
//
// The rule catalog under scripts/audit/specs/llms-txt/ stays as the normative
// spec: it carries the llmstxt.org citations, severities, and provenance that a
// property cannot express. What this file replaces is the EVALUATION side --
// one fixture file per rule, each pinning one hand-picked example.
//
// Two halves:
//   1. Soundness. A document that satisfies all four invariants by construction
//      produces no findings.
//   2. Discrimination. For each invariant, a targeted mutation of that same
//      generated document breaks exactly that invariant, and the validator
//      answers with exactly that rule id. This is the part a fixture corpus
//      gets wrong most often: a fixture proves the rule fires, not that it
//      fires ALONE.

import {describe, expect, it} from 'vitest'
import fc from 'fast-check'
import {validateLlmsTxt} from '../../scripts/audit/validate-llms-txt.mjs'
import {wellFormedLlmsTxtArb} from './llms-txt-arbitraries'

const H1_RE = /^#\s+\S/
const H2_RE = /^##\s+\S/
const BLOCKQUOTE_RE = /^>\s+\S/
const LIST_ITEM_RE = /^[-*]\s+/
const LINK_ITEM_RE = /^[-*]\s+\[[^\]]+\]\([^)]+\)(:\s*.*)?$/

const linesOf = (text: string) => text.split(/\r\n|\r|\n/)
const nonBlankOf = (text: string) => linesOf(text).filter((line) => line.trim() !== '')

// The four structural invariants, stated over raw text and derived from
// llmstxt.org -- deliberately independent of the validator they check.
const invariants = {
  h1First: (text: string) => H1_RE.test(nonBlankOf(text)[0] ?? ''),
  blockquoteNext: (text: string) => {
    const nonBlank = nonBlankOf(text)
    const h1Index = nonBlank.findIndex((line) => H1_RE.test(line))
    return h1Index !== -1 && BLOCKQUOTE_RE.test(nonBlank[h1Index + 1] ?? '')
  },
  linkListItems: (text: string) => {
    let sawH2 = false
    for (const line of linesOf(text)) {
      if (H2_RE.test(line)) {
        sawH2 = true
        continue
      }
      if (sawH2 && LIST_ITEM_RE.test(line) && !LINK_ITEM_RE.test(line)) {
        return false
      }
    }
    return true
  },
  singleH1: (text: string) => linesOf(text).filter((line) => H1_RE.test(line)).length === 1
}

type InvariantName = keyof typeof invariants
const INVARIANT_NAMES = Object.keys(invariants) as InvariantName[]

// One mutation per invariant. Each breaks its own invariant and leaves the
// other three intact -- the test below asserts that, so a mutation that grows
// a side effect fails rather than silently weakening the discrimination claim.
const mutations: Record<InvariantName, {ruleId: string; mutate: (text: string) => string}> = {
  h1First: {ruleId: 'llms-txt-h1', mutate: (text) => `prose before the title\n\n${text}`},
  blockquoteNext: {ruleId: 'llms-txt-blockquote', mutate: (text) => linesOf(text).filter((line) => !BLOCKQUOTE_RE.test(line)).join('\n')},
  linkListItems: {
    ruleId: 'llms-txt-non-link-list-item',
    mutate: (text) => {
      const lines = linesOf(text)
      const index = lines.findIndex((line) => LINK_ITEM_RE.test(line))
      lines[index] = '- https://example.com/bare'
      return lines.join('\n')
    }
  },
  singleH1: {ruleId: 'llms-txt-second-h1', mutate: (text) => `${text}\n# Second Title\n`}
}

const ids = (text: string) => validateLlmsTxt(text).map((finding: {id: string}) => finding.id)

const PROPERTY_OPTIONS = {numRuns: 500, seed: 42}

describe('validateLlmsTxt structural invariants', () => {
  it('accepts every document that satisfies all four invariants', () => {
    fc.assert(fc.property(wellFormedLlmsTxtArb, (text) => {
      expect(INVARIANT_NAMES.filter((name) => !invariants[name](text))).toEqual([])
      expect(validateLlmsTxt(text)).toEqual([])
    }), PROPERTY_OPTIONS)
  })

  for (const name of INVARIANT_NAMES) {
    const {ruleId, mutate} = mutations[name]

    it(`rejects a document that breaks ${name}, and only via ${ruleId}`, () => {
      fc.assert(fc.property(wellFormedLlmsTxtArb, (text) => {
        const mutated = mutate(text)

        // The mutation breaks its own invariant and no other.
        expect(invariants[name](mutated)).toBe(false)
        expect(INVARIANT_NAMES.filter((other) => other !== name && !invariants[other](mutated))).toEqual([])

        // The validator answers with exactly the one rule that invariant maps to.
        expect(ids(mutated)).toEqual([ruleId])
      }), PROPERTY_OPTIONS)
    })
  }
})
