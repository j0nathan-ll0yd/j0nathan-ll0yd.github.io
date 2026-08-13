// tests/audit/llms-txt-arbitraries.ts -- input generators for the llms.txt
// property and differential tests (Phoenix eval right-sizing pilot).
//
// Two arbitraries, two jobs:
//   wellFormedLlmsTxtArb  builds a document that satisfies every structural
//                         invariant by construction. The property test mutates
//                         it to break exactly one invariant at a time.
//   llmsTxtBodyArb        composes random llms.txt-SHAPED lines, most of them
//                         malformed. This is the corpus shape atlas decision
//                         0036 used to find the divergence classes the declared
//                         rule cases cannot see.

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
