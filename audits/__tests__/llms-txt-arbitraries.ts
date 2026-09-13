// audits/__tests__/llms-txt-arbitraries.ts -- input generators for the llms.txt
// property and differential tests (Phoenix eval right-sizing pilot).
//
// Four arbitraries, two jobs:
//   wellFormedLlmsTxtArb  builds a document that satisfies every structural
//                         invariant by construction. The property test mutates
//                         it to break exactly one invariant at a time.
//   llmsTxtBodyArb        composes random llms.txt-SHAPED lines, most of them
//                         malformed. This is the corpus shape atlas decision
//                         0036 used to find the divergence classes the declared
//                         rule cases cannot see.
//   llmsTxtV2BodyArb      that pool plus the lines v2 changed its answer on.
//   llmsTxtV3BodyArb      that pool plus the lines v3 changed its answer on.
// Each pool is ADDITIVE and frozen once its version ships: a differential run
// reproduces only if its input space does. LINE_POOLS below exports all three
// so the differential suite can pin them by digest.

import fc from 'fast-check'

const word = fc.stringMatching(/^[A-Za-z][A-Za-z0-9]{0,7}$/)
const phrase = fc.array(word, {minLength: 1, maxLength: 3}).map((parts) => parts.join(' '))

// Built from parts rather than fc.webUrl(): the validator's link regex forbids
// ")" inside the URL, and a generated URL carrying one would be a generator
// artefact, not a finding.
const url = fc.array(fc.stringMatching(/^[a-z0-9-]{1,8}$/), {minLength: 1, maxLength: 3}).map((segments) => `https://example.com/${segments.join('/')}`)

const linkItem = fc.record({name: phrase, url, notes: fc.option(phrase, {nil: null}), bullet: fc.constantFrom('-', '*')})

const section = fc.record({name: phrase, items: fc.array(linkItem, {minLength: 1, maxLength: 4})})

const renderItem = (item: {name: string; url: string; notes: string | null; bullet: string}) =>
  `${item.bullet} [${item.name}](${item.url})${item.notes === null ? '' : `: ${item.notes}`}`

/** A document that satisfies h1First, blockquoteNext, linkListItems and singleH1 by construction. */
export const wellFormedLlmsTxtArb: fc.Arbitrary<string> = fc.record({
  title: phrase,
  summary: phrase,
  sections: fc.array(section, {minLength: 1, maxLength: 3})
}).map((doc) => {
  const blocks = [`# ${doc.title}`, `> ${doc.summary}`]
  for (const s of doc.sections) {
    blocks.push(`## ${s.name}`, s.items.map(renderItem).join('\n'))
  }
  return `${blocks.join('\n\n')}\n`
})

// The exact line pool from atlas decision 0036's posture-3 fuzz driver, so the
// differential test samples the same input space that surfaced the three
// divergence classes.
const LINES = [
  '# Site',
  '# Second',
  '> Summary',
  '>Summary',
  '## Links',
  '## Optional',
  '##NoSpace',
  '### Sub',
  '- [Name](https://example.com)',
  '- [Name](https://example.com): notes',
  '- [Name](https://example.com):',
  '- https://example.com/bare',
  '* [Star](https://example.com)',
  '+ [Plus](https://example.com)',
  '  - [Indented](https://example.com)',
  'plain prose line',
  '',
  '   ',
  '```',
  'Setext',
  '======'
]

/** Random compositions of llms.txt-shaped lines: mostly malformed, deliberately. */
export const llmsTxtBodyArb: fc.Arbitrary<string> = fc.array(fc.constantFrom(...LINES), {minLength: 1, maxLength: 9}).map((lines) => `${lines.join('\n')}\n`)

// v2 added two relaxations and one tightening that the 0036 pool cannot reach:
// it holds no list item without a URL, and no link item whose notes carry a
// second, unlinked URL. Kept as a SEPARATE pool so llmsTxtBodyArb above stays
// byte-faithful to the 0036 evidence.
const V2_LINES = [
  ...LINES,
  '- Framework: Astro (static site generation, 0 KB JS by default)',
  '- Hosting: Cloudflare Pages via GitHub Actions',
  '- Site: https://example.com',
  '- [Name](https://example.com): mirror at https://mirror.example.com',
  '## Expertise',
  'Backend Engineering, Go, AWS'
]

/** The 0036 pool plus the lines v2's section rules changed their answer on. */
export const llmsTxtV2BodyArb: fc.Arbitrary<string> = fc.array(fc.constantFrom(...V2_LINES), {minLength: 1, maxLength: 9}).map((lines) =>
  `${lines.join('\n')}\n`
)

// v3 tightened one thing: a markdown link needs a nonempty label AND a nonempty
// destination. Neither pool above holds a line that can show it -- v2 stripped
// "[](url)" and "[name]()" as if they were real links, so the v2 pool cannot
// reach the divergence. Kept as a THIRD pool so the two above stay byte-faithful
// to the evidence they were built for.
const V3_LINES = [
  ...V2_LINES,
  '- [](https://x.com)',
  '- [name]()',
  '- [Docs](https://example.com/docs',
  '- [ok](https://ok.com)'
]

/** The v2 pool plus the lines v3's link rule changed its answer on. */
export const llmsTxtV3BodyArb: fc.Arbitrary<string> = fc.array(fc.constantFrom(...V3_LINES), {minLength: 1, maxLength: 9}).map((lines) =>
  `${lines.join('\n')}\n`
)

// The three pools, exported so the differential suite can pin them by digest.
// An exact divergence count is only reproducible if the input SPACE is fixed as
// well as the seed and the run count: appending one line here shifts every
// sample that follows it. The pin turns "someone edited the pool" from a silent
// count change into a named failure.
export const LINE_POOLS: Record<'v1' | 'v2' | 'v3', readonly string[]> = {v1: LINES, v2: V2_LINES, v3: V3_LINES}
