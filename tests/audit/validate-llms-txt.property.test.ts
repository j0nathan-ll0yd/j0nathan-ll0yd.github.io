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
//
// THE MIRROR IS GONE (atlas decision 0099 phase 4). This file used to restate
// the convention as eight local regexes -- H1_RE, H2_RE, BLOCKQUOTE_RE,
// LIST_ITEM_RE, MARKDOWN_LINK_RE, ANY_LINK_SHAPE_RE, WELL_FORMED_LINK_RE,
// BARE_URL_RE -- plus its own line walkers. Those were a second, hand-kept copy
// of the rule the shared contract already owns, and a copy is a thing that
// drifts. `@j0nathan-ll0yd/estate-contracts@0.5.0` ships the decision-0099
// codec, so the invariants are now stated over the PARSED MODEL that
// `parseLlmsTxt` returns, and the mutations are built in model space and
// rendered by `encodeLlmsTxt` wherever that is expressible.
//
// Independence survives the collapse, which is the point of the exercise: the
// subject under test is `checkLlmsStructure` (through this repo's catalog
// wrapper `validateLlmsTxt`), and the oracle is `parseLlmsTxt` /
// `encodeLlmsTxt`. Those are separate functions with separate code paths in the
// contract -- the codec never calls the checker -- so an invariant stated over
// the model is not the checker grading its own homework.

import {describe, expect, it} from 'vitest'
import fc from 'fast-check'
import {decodeLlmsTxt, encodeLlmsTxt, parseLlmsTxt} from '@j0nathan-ll0yd/estate-contracts/llms-structure'
import {validateLlmsTxt} from '../../scripts/audit/validate-llms-txt.mjs'
import {wellFormedLlmsTxtArb} from './llms-txt-arbitraries'

// The contract ships JSDoc types, not a .d.ts, and tests/** is outside the
// tsconfig include, so the model shape is restated here as a local alias for
// readability. It is a NAME for the contract's LlmsTxtDoc, not a second
// definition of it -- nothing here decides what is structurally valid.
type LlmsTxtLink = {label: string; url: string; notes?: string}
type LlmsTxtSection = {name: string; prose: string[]; links: LlmsTxtLink[]}
type LlmsTxtDoc = {title: string | null; summary: string | null; body: string[]; sections: LlmsTxtSection[]}

const parse = (text: string): LlmsTxtDoc => parseLlmsTxt(text) as LlmsTxtDoc
const encode = (doc: LlmsTxtDoc): string => encodeLlmsTxt(doc) as string

// Markdown list TOKENIZATION, deliberately not a rule: it answers "is this line a
// bullet at all", nothing more. Which bullets are acceptable is no longer decided
// here -- `parseLlmsTxt` decides it, by putting a well-formed `[label](url)` item
// in `section.links` and everything else in `section.prose`. So "a bullet line
// survives in prose" IS "a list item that is not a well-formed link", read off
// the model rather than re-derived from BARE_URL_RE and friends.
const LIST_ITEM_RE = /^[-*]\s+/

// "Would the codec reparse this line as a heading?" answered by the contract's own
// encode-time boundary check instead of by a local H1_RE. `encodeLlmsTxt` throws on
// a body line that would come back as a heading; that throw is exactly the question.
const reparsesAsHeading = (line: string) => {
  try {
    encode({title: 'probe', summary: 'probe', body: [line], sections: []})
    return false
  } catch {
    return true
  }
}

// The five structural invariants, stated over the parsed model and derived from
// llmstxt.org.
//
// Two of them state the LIFEGAMES PROFILE of the convention rather than a
// strict reading of it (atlas decision 0040): linkListItems allows a
// descriptive item with no URL, and h2NoFileList asks only that a section is
// not dangling. Each rule file's policy_note carries the divergence; these
// properties check the validator against the profile it actually implements.
const invariants = {
  // `parseLlmsTxt` returns a title only when the first non-blank line is a valid
  // H1, mirroring the checker's "structure is unrecoverable past this point".
  h1First: (doc: LlmsTxtDoc) => doc.title !== null,
  // Conditional on a title, deliberately: with no valid H1 the parse is degenerate
  // by design, so an unconditional reading would make the h1First mutation break
  // this invariant too and destroy the one-mutation-one-invariant claim. The
  // h1First case asserts its own surgicality through `restore` below instead.
  blockquoteNext: (doc: LlmsTxtDoc) => doc.title === null || doc.summary !== null,
  linkListItems: (doc: LlmsTxtDoc) => doc.sections.every((section) => section.prose.every((line) => !LIST_ITEM_RE.test(line))),
  // A second H1 is not a heading to the parser -- only the FIRST one is the title
  // -- so an extra one lands in `body` or in a section's `prose`. Any such line is
  // heading-shaped, and the codec refuses to re-encode it.
  singleH1: (doc: LlmsTxtDoc) => ![...doc.body, ...doc.sections.flatMap((section) => section.prose)].some(reparsesAsHeading),
  // The fifth invariant, added by the adversarial review (MEDIUM finding #6):
  // the property suite stated four of the five rules the catalog declares, so
  // llms-txt-h2-no-file-list rested on its hand-written case alone. Every H2
  // section carries at least one prose line or one link. Profile wording,
  // deliberately -- it asks for content, not a file list (atlas decision 0040).
  h2NoFileList: (doc: LlmsTxtDoc) => doc.sections.every((section) => section.prose.length + section.links.length > 0)
}

type InvariantName = keyof typeof invariants
const INVARIANT_NAMES = Object.keys(invariants) as InvariantName[]

const PREPENDED_PROSE = 'prose before the title'
const BARE_URL_ITEM = '- https://example.com/bare'

type Mutation = {
  ruleId: string
  mutate: (text: string) => string
  /**
   * Undo the framing a mutation added, for the one mutation whose damage the parse
   * cannot see past. Present only on h1First.
   */
  restore?: (mutated: string) => string
}

// One mutation per invariant. Each breaks its own invariant and leaves the
// other four intact -- the test below asserts that, so a mutation that grows
// a side effect fails rather than silently weakening the discrimination claim.
const mutations: Record<InvariantName, Mutation> = {
  // Not expressible in model space: `encodeLlmsTxt` always emits the title first,
  // which is the whole reason a document CAN fail this rule only at the text level.
  h1First: {ruleId: 'llms-txt-h1', mutate: (text) => `${PREPENDED_PROSE}\n\n${text}`, restore: (mutated) => mutated.slice(`${PREPENDED_PROSE}\n\n`.length)},
  // Model space: drop the summary and re-encode. The old text-level version
  // filtered lines by BLOCKQUOTE_RE, which is one of the mirrors this change
  // deletes, and left a stray blank line behind where the blockquote had been.
  blockquoteNext: {ruleId: 'llms-txt-blockquote', mutate: (text) => encode({...parse(text), summary: null})},
  // Model space: demote the first section's first link to a bare-URL bullet. It
  // renders as prose because it is not a well-formed link -- which is exactly the
  // condition the rule names.
  linkListItems: {
    ruleId: 'llms-txt-non-link-list-item',
    mutate: (text) => {
      const doc = parse(text)
      const [section, ...rest] = doc.sections
      const [, ...remainingLinks] = section.links
      return encode({...doc, sections: [{...section, prose: [...section.prose, BARE_URL_ITEM], links: remainingLinks}, ...rest]})
    }
  },
  // Text level, deliberately: `encodeLlmsTxt` REFUSES to render a second H1, so the
  // only way to build this document is to append the line the codec would reject.
  singleH1: {ruleId: 'llms-txt-second-h1', mutate: (text) => `${text}\n# Second Title\n`},
  // A heading appended with nothing under it. Chosen over emptying an existing
  // section because removing a section's items would also change linkListItems'
  // subject matter; appending touches one invariant and no other. Text level for
  // the same reason as singleH1: encode refuses to render an empty section.
  h2NoFileList: {ruleId: 'llms-txt-h2-no-file-list', mutate: (text) => `${text}\n## Dangling\n`}
}

const ids = (text: string) => validateLlmsTxt(text).map((finding: {id: string}) => finding.id)
const brokenBy = (text: string) => {
  const doc = parse(text)
  return INVARIANT_NAMES.filter((name) => !invariants[name](doc))
}

const PROPERTY_OPTIONS = {numRuns: 500, seed: 42}

// covers: llms-txt#Served llms.txt conforms to the Lifegames llms.txt profile
describe('validateLlmsTxt structural invariants', () => {
  it('accepts every document that satisfies all five invariants', () => {
    fc.assert(fc.property(wellFormedLlmsTxtArb, (text) => {
      expect(brokenBy(text)).toEqual([])
      expect(validateLlmsTxt(text)).toEqual([])
    }), PROPERTY_OPTIONS)
  })

  for (const name of INVARIANT_NAMES) {
    const {ruleId, mutate, restore} = mutations[name]

    it(`rejects a document that breaks ${name}, and only via ${ruleId}`, () => {
      fc.assert(fc.property(wellFormedLlmsTxtArb, (text) => {
        const mutated = mutate(text)

        // The mutation breaks its own invariant and no other.
        expect(brokenBy(mutated)).toEqual([name])

        // h1First's mutation makes the parse degenerate on purpose -- with no valid
        // H1 there is nothing reliable to walk -- so the four other invariants would
        // read vacuously true above. Assert the surgicality directly and more
        // strongly instead: undo the framing and the ORIGINAL model comes back whole.
        if (restore) {
          expect(parse(restore(mutated))).toEqual(parse(text))
        }

        // The validator answers with exactly the one rule that invariant maps to.
        expect(ids(mutated)).toEqual([ruleId])
      }), PROPERTY_OPTIONS)
    })
  }
})

// covers: llms-txt#Served llms.txt conforms to the Lifegames llms.txt profile
describe('the llms-structure codec agrees with the checker it ships beside', () => {
  it('round-trips a parsed document through encode without losing a field', () => {
    fc.assert(fc.property(wellFormedLlmsTxtArb, (text) => {
      const doc = parse(text)

      // The MODEL-level round trip, not the byte-level one: `encodeLlmsTxt` normalizes
      // a `*` bullet to `-`, so parse-then-encode is not byte-identical for every
      // legal input. What must hold is that no field is lost or reinterpreted.
      expect(parse(encode(doc))).toEqual(doc)
    }), PROPERTY_OPTIONS)
  })

  it("encodes a canonical document that this repo's catalog also accepts", () => {
    fc.assert(fc.property(wellFormedLlmsTxtArb, (text) => {
      const canonical = encode(parse(text))

      // The producer-side claim: a document CONSTRUCTED from the model passes the
      // same catalog that validates a document FETCHED from the site. Construct,
      // validate, and test now run off one shape (atlas decision 0099).
      expect(validateLlmsTxt(canonical)).toEqual([])
      expect(brokenBy(canonical)).toEqual([])
      // Canonical form is a fixed point of the codec at the BYTE level.
      expect(encode(parse(canonical))).toBe(canonical)
    }), PROPERTY_OPTIONS)
  })

  it('decodes to the same findings the checker emits, with the model alongside', () => {
    fc.assert(fc.property(wellFormedLlmsTxtArb, (text) => {
      const {doc, findings} = decodeLlmsTxt(text) as {doc: LlmsTxtDoc; findings: {id: string}[]}

      expect(findings).toEqual([])
      expect(doc).toEqual(parse(text))
    }), PROPERTY_OPTIONS)
  })
})
