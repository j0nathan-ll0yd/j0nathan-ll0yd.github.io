// tests/audit/validate-llms-txt.property.test.ts -- the llms.txt structural
// convention stated as five executable invariants over generated documents,
// instead of as hand-written example files (Phoenix eval right-sizing pilot).
//
// The rule catalog under scripts/audit/specs/llms-txt/ stays as the normative
// spec: it carries the llmstxt.org citations, severities, and provenance that a
// property cannot express. What this file replaces is the EVALUATION side --
// one fixture file per rule, each pinning one hand-picked example.
//
// Two halves:
//   1. Soundness. A document that satisfies all five invariants by construction
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
// v3: a WELL-FORMED markdown link needs a nonempty label and a nonempty
// destination. ANY_LINK_SHAPE_RE matches the loose shape v2 accepted, so the
// invariant can tell an empty part from a real link.
const MARKDOWN_LINK_RE = /\[[^\]]+\]\([^)]+\)/g
const ANY_LINK_SHAPE_RE = /\[[^\]]*\]\([^)]*\)/g
const WELL_FORMED_LINK_RE = /^\[[^\]]+\]\([^)]+\)$/
const BARE_URL_RE = /https?:\/\//

const linesOf = (text: string) => text.split(/\r\n|\r|\n/)
const nonBlankOf = (text: string) => linesOf(text).filter((line) => line.trim() !== '')

// The five structural invariants, stated over raw text and derived from
// llmstxt.org -- deliberately independent of the validator they check.
//
// Two of them state the LIFEGAMES PROFILE of the convention rather than a
// strict reading of it (atlas decision 0040): linkListItems allows a
// descriptive item with no URL, and h2NoFileList asks only that a section is
// not dangling. Each rule file's policy_note carries the divergence; these
// properties check the validator against the profile it actually implements.
const invariants = {
  h1First: (text: string) => H1_RE.test(nonBlankOf(text)[0] ?? ''),
  blockquoteNext: (text: string) => {
    const nonBlank = nonBlankOf(text)
    const h1Index = nonBlank.findIndex((line) => H1_RE.test(line))
    return h1Index !== -1 && BLOCKQUOTE_RE.test(nonBlank[h1Index + 1] ?? '')
  },
  // v3 (LLMS_STRUCTURE_SPEC_VERSION = 3): a list item may be descriptive prose.
  // What it may NOT do is carry a URL the author failed to wrap in a markdown
  // link, or a link shape with an empty label or an empty destination. Strip
  // every WELL-FORMED [text](url) and no http(s) URL may survive; no loose
  // [..](..) shape on the line may have an empty part.
  linkListItems: (text: string) => {
    let sawH2 = false
    for (const line of linesOf(text)) {
      if (H2_RE.test(line)) {
        sawH2 = true
        continue
      }
      if (!sawH2 || !LIST_ITEM_RE.test(line)) {
        continue
      }
      const malformed = (line.match(ANY_LINK_SHAPE_RE) ?? []).some((shape) => !WELL_FORMED_LINK_RE.test(shape))
      if (malformed || BARE_URL_RE.test(line.replace(MARKDOWN_LINK_RE, ''))) {
        return false
      }
    }
    return true
  },
  singleH1: (text: string) => linesOf(text).filter((line) => H1_RE.test(line)).length === 1,
  // The fifth invariant, added by the adversarial review (MEDIUM finding #6):
  // the property suite stated four of the five rules the catalog declares, so
  // llms-txt-h2-no-file-list rested on its hand-written case alone. Every H2
  // heading has at least one non-blank line under it, up to the next H2 or end
  // of file. Profile wording, deliberately -- it asks for content, not a file
  // list (atlas decision 0040).
  h2NoFileList: (text: string) => {
    let openSection = false
    for (const line of linesOf(text)) {
      if (H2_RE.test(line)) {
        if (openSection) {
          return false
        }
        openSection = true
        continue
      }
      if (openSection && line.trim() !== '') {
        openSection = false
      }
    }
    return !openSection
  }
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
  singleH1: {ruleId: 'llms-txt-second-h1', mutate: (text) => `${text}\n# Second Title\n`},
  // A heading appended with nothing under it. Chosen over emptying an existing
  // section because removing a section's items would also change linkListItems'
  // subject matter; appending touches one invariant and no other.
  h2NoFileList: {ruleId: 'llms-txt-h2-no-file-list', mutate: (text) => `${text}\n## Dangling\n`}
}

const ids = (text: string) => validateLlmsTxt(text).map((finding: {id: string}) => finding.id)

const PROPERTY_OPTIONS = {numRuns: 500, seed: 42}

// covers: llms-txt#Served llms.txt conforms to the Lifegames llms.txt profile
describe('validateLlmsTxt structural invariants', () => {
  it('accepts every document that satisfies all five invariants', () => {
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
