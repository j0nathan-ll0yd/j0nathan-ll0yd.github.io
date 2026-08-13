// tests/audit/llms-differential.test.ts -- the reusable differential harness,
// used three times: to pin atlas decision 0036 forever, to prove the v2
// relaxation changed exactly what it claims, and to prove the v3 tightening did.
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
// All three suites below are one call each to scripts/audit/lib/differential.mjs.
//
// Each suite compares against a FROZEN reference, never a moving one. The 0036
// regeneration is a v1-era artifact, so pointing it at the live reference would
// stop reproducing 0036 the moment a rule relaxed -- which v2 then did, and v3
// did again. fixtures/llms-structure.v1.mjs and fixtures/llms-structure.v2.mjs
// are those pins.
//
// REPRODUCIBILITY (adversarial review, MEDIUM finding #6). The claim these
// suites make is quantitative -- "N inputs, these classes, zero unattributed" --
// and a quantitative claim that cannot be re-run is an anecdote. Four things fix
// the run, all pinned as constants below and asserted before any count is:
//   - the input SPACE: LINE_POOLS, pinned by sha256. Appending one line to a
//     pool shifts every sample after it.
//   - the input COUNT: RUNS, passed explicitly rather than left to the harness
//     default.
//   - the input STREAM: SEED, likewise, plus the fast-check version that turns
//     a seed into a sample. A major bump can re-order the stream.
//   - the ANSWER: exact divergent totals and per-class counts, not "> 0".
// A count that moves now names which of the four changed instead of quietly
// re-baselining. TO RE-PIN: change one input at a time, re-run, and record the
// new numbers with the reason in the same commit.

import {describe, expect, it} from 'vitest'
import {createHash} from 'node:crypto'
import {readFileSync} from 'node:fs'
import {dirname, resolve} from 'node:path'
import {fileURLToPath} from 'node:url'
import {differential} from '../../scripts/audit/lib/differential.mjs'
import {checkLlmsStructure as current} from '../../scripts/audit/lib/llms-structure.mjs'
import {checkLlmsStructure as v1} from './fixtures/llms-structure.v1.mjs'
import {checkLlmsStructure as v2} from './fixtures/llms-structure.v2.mjs'
import {validateLlmsTxt as regenerated} from './fixtures/validate-llms-txt.regenerated.mjs'
import {LINE_POOLS, llmsTxtBodyArb, llmsTxtV2BodyArb, llmsTxtV3BodyArb} from './llms-txt-arbitraries'

type Finding = {id: string}

const H1_RE = /^#\s+\S/
const SECOND_H1 = 'llms-txt-second-h1'
const NON_LINK = 'llms-txt-non-link-list-item'
const NO_FILE_LIST = 'llms-txt-h2-no-file-list'
// The three rules v2 did not touch. h2-no-file-list and non-link-list-item are
// the two it did.
const UNTOUCHED_BY_V2 = ['llms-txt-h1', 'llms-txt-blockquote', SECOND_H1]
// v3 touched ONE rule. Everything else, h2-no-file-list included, is untouched.
const UNTOUCHED_BY_V3 = [...UNTOUCHED_BY_V2, NO_FILE_LIST]

// --- the pinned run (see REPRODUCIBILITY above) ---------------------------

/** Inputs sampled per differential run. Explicit: the harness default is not a decision. */
const RUNS = 20_000
/** fast-check PRNG seed. Explicit for the same reason. */
const SEED = 42
/** The sampler that turns SEED into a stream. Pinned exactly in package.json. */
const FAST_CHECK_VERSION = '4.9.0'
/** sha256 of JSON.stringify(pool) for each line pool the suites sample from. */
const POOL_SHA256 = {
  v1: 'b8e0e31534790b0f4e94f44edabdded15b42ab291b4ce3b6ea689c15bd3a86e2',
  v2: '319bb13c41dd68f94866f27c127f4ae08ae29fb6aeb640df4063c3c7f68fa8e4',
  v3: '7af42c369136e38310baa0574f7d000bc046179e9f7ea62f9a4a7b534e11dcff'
}

const PACKAGE_JSON_PATH = resolve(dirname(fileURLToPath(import.meta.url)), '../../package.json')

const RUN_OPTIONS = {runs: RUNS, seed: SEED}

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

// covers: llms-txt#Served llms.txt conforms to the Lifegames llms.txt profile
describe('differential run provenance: the counts below reproduce only if these do', () => {
  it('samples from the pinned fast-check version', () => {
    const packageJson: {devDependencies: Record<string, string>} = JSON.parse(readFileSync(PACKAGE_JSON_PATH, 'utf-8'))

    expect(packageJson.devDependencies['fast-check'], 'the sampler changed -- re-run the suites and re-pin the counts in the same commit').toBe(
      FAST_CHECK_VERSION
    )
  })

  for (const [version, expected] of Object.entries(POOL_SHA256)) {
    it(`samples from the pinned ${version} line pool`, () => {
      const pool = LINE_POOLS[version as keyof typeof LINE_POOLS]
      const digest = createHash('sha256').update(JSON.stringify(pool), 'utf-8').digest('hex')

      expect(digest, `the ${version} line pool changed -- every sample after the edited line shifted, so re-pin the counts too`).toBe(expected)
    })
  }
})

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

  const result = differential(v1, regenerated, llmsTxtBodyArb, {...RUN_OPTIONS, eq: sameBag, classify})

  it('finds the three divergence classes decision 0036 reported', () => {
    expect(Object.keys(result.byClass).sort()).toEqual(['bare-trailing-colon-accepted', 'missing-h1-early-return', 'second-h1-per-line-vs-per-body'])
  })

  it('reproduces the exact divergence tally for the pinned run', () => {
    // Not "> 0". The whole point of pinning seed, run count and pool is that
    // this number is a fact about the two implementations, re-derivable by
    // anyone who runs the suite.
    expect({runs: result.runs, divergent: result.divergent, byClass: result.byClass}).toEqual({
      runs: RUNS,
      divergent: 5808,
      byClass: {'missing-h1-early-return': 5628, 'second-h1-per-line-vs-per-body': 113, 'bare-trailing-colon-accepted': 67}
    })
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

describe('differential: frozen v2 against frozen v1 (the relaxation)', () => {
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

  const result = differential(v2, v1, llmsTxtV2BodyArb, {...RUN_OPTIONS, eq: sameBag, classify})

  it('changes only the two section rules, never the other three', () => {
    // The strong claim. Compared on llms-txt-h1, llms-txt-blockquote and
    // llms-txt-second-h1 alone, v2 and v1 are indistinguishable -- so the
    // relaxation cannot have disturbed the three behaviours 0036 pinned.
    const scoped = differential(v2, v1, llmsTxtV2BodyArb, {...RUN_OPTIONS, eq: eqOn(UNTOUCHED_BY_V2)})
    expect(scoped.divergent).toBe(0)
  })

  it('relaxes prose sections and descriptive items, and tightens unlinked URLs in notes', () => {
    expect({runs: result.runs, divergent: result.divergent, byClass: result.byClass}).toEqual({
      runs: RUNS,
      divergent: 237,
      byClass: {'prose-section-now-legal': 111, 'descriptive-item-now-legal': 77, 'unlinked-url-in-notes-now-fires': 35, 'both-section-rules-diverge': 14}
    })
  })

  it('attributes every divergence to a known class', () => {
    expect(result.unclassifiedCount).toBe(0)
  })
})

describe('differential: the live reference against frozen v2 (the v3 tightening)', () => {
  // v3 says one thing: a markdown link needs a nonempty label AND a nonempty
  // destination. v2's regex allowed both to be empty, so "- [](url)" and
  // "- [name]()" were stripped as if they were real links and passed. The claim
  // this suite makes is that the delta is EXACTLY that and nothing else.
  const classify = (_input: string, a: Finding[], b: Finding[]) => {
    const differing = differingIds(a, b)
    if (differing.length === 0) {
      return null
    }
    // One direction only: v3 may emit MORE non-link findings, never fewer. A
    // divergence where v3 emits fewer is a relaxation nobody asked for, and
    // falls through to unclassified rather than being absorbed into the class.
    if (differing.every((id) => id === NON_LINK) && (bag(a)[NON_LINK] ?? 0) > (bag(b)[NON_LINK] ?? 0)) {
      return 'empty-link-now-fires'
    }
    return null
  }

  const result = differential(current, v2, llmsTxtV3BodyArb, {...RUN_OPTIONS, eq: sameBag, classify})

  it('changes only the link rule, never the other four', () => {
    const scoped = differential(current, v2, llmsTxtV3BodyArb, {...RUN_OPTIONS, eq: eqOn(UNTOUCHED_BY_V3)})
    expect(scoped.divergent).toBe(0)
  })

  it('diverges in exactly one class, the empty-link tightening', () => {
    expect({runs: result.runs, divergent: result.divergent, byClass: result.byClass}).toEqual({
      runs: RUNS,
      divergent: 73,
      byClass: {'empty-link-now-fires': 73}
    })
  })

  it('attributes every divergence to a known class', () => {
    expect(result.unclassifiedCount).toBe(0)
  })

  it('reports a minimal reproducing input carrying an empty link part', () => {
    const minimal = result.minimalPerClass['empty-link-now-fires']
    expect(minimal).toBeTruthy()
    expect(minimal).toMatch(/\[\]\(|\]\(\)/)
  })

  it('fires on both empty parts and leaves a well-formed link alone', () => {
    const ids = (text: string) => current(text).map((finding: Finding) => finding.id)
    expect(ids('# S\n\n> Sum\n\n## Links\n\n- [](https://x.com)\n')).toEqual([NON_LINK])
    expect(ids('# S\n\n> Sum\n\n## Links\n\n- [name]()\n')).toEqual([NON_LINK])
    expect(ids('# S\n\n> Sum\n\n## Links\n\n- [ok](https://ok.com)\n')).toEqual([])
    // v2 answered [] to both of the first two. This is the regression the
    // vendored bytes now carry, stated as an example rather than a count.
    expect(v2('# S\n\n> Sum\n\n## Links\n\n- [](https://x.com)\n')).toEqual([])
    expect(v2('# S\n\n> Sum\n\n## Links\n\n- [name]()\n')).toEqual([])
  })

  it('keeps the three behaviours decision 0036 pinned', () => {
    const ids = (text: string) => current(text).map((finding: Finding) => finding.id)
    // 1. No valid H1: return early, emit only llms-txt-h1.
    expect(ids('## Links\n\n- https://example.com/bare\n')).toEqual(['llms-txt-h1'])
    // 2. second-h1 per offending line, not per body.
    expect(ids('# S\n\n> Sum\n\n# Two\n# Three\n')).toEqual([SECOND_H1, SECOND_H1])
    // 3. A bare trailing colon passes.
    expect(ids('# S\n\n> Sum\n\n## Links\n\n- [Name](https://example.com):\n')).toEqual([])
  })
})
