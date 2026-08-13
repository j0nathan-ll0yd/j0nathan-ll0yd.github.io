// tests/audit/spec-drift.test.ts -- B2 spec/eval pilot, ADR 0011 follow-up
// (b). Three halves:
//   1. The live catalog's INTEGRITY is green (offline, no network).
//   2. checkQuoteIntegrity CAN FAIL -- a quote edited after authoring, and the
//      anti-truncation floor that stops a drift red being "fixed" by cutting
//      the citation down to a fragment.
//   3. checkSourceDrift CAN FAIL, with an INJECTED fetch so this suite never
//      touches the network. ADR 0010/0011's core lesson is that a gate never
//      observed to fail is indistinguishable from no gate, and the headline
//      case here is the one every EXISTING gate misses: a normative MUST
//      silently downgraded to SHOULD, with content_sha256 dutifully re-run so
//      integrity and check-spec-verification both go green.
//
// The live DRIFT half is deliberately NOT asserted here. It depends on two
// third-party hosts, and this suite runs on every pull request; that check is
// the weekly report-only audit-web.yml job's business (the tier split in
// check-spec-drift.mjs's header).

import {createHash} from 'node:crypto'
import {describe, expect, it, vi} from 'vitest'
import {checkIntegrityOnly, checkQuoteIntegrity, checkSourceDrift, MIN_SEGMENT_CHARS, quoteSegments} from '../../scripts/audit/check-spec-drift.mjs'

const RFC_URL = 'https://www.rfc-editor.org/rfc/rfc9116.txt'

const QUOTE = 'This field MUST always be present in a "security.txt" file.'

interface SpecFields {
  normative_quote?: string
  content_sha256?: string
  verified_against_source?: boolean
  verification_url?: string
}
interface SyntheticRule {
  rel: string
  rule: {id: string; spec: SpecFields}
}

function sha256(s: string): string {
  return createHash('sha256').update(s, 'utf-8').digest('hex')
}

function ruleWith(spec: SpecFields): SyntheticRule {
  return {rel: 'security-txt/example.rule.json', rule: {id: 'example', spec}}
}

/** An integrity-clean, verified rule pointing at a pinned source. */
function verifiedRule(quote = QUOTE): SyntheticRule {
  return ruleWith({normative_quote: quote, content_sha256: sha256(quote), verified_against_source: true, verification_url: RFC_URL})
}

describe('check-spec-drift: the live catalog', () => {
  it('has zero integrity violations (every content_sha256 matches its own quote)', () => {
    expect(checkIntegrityOnly()).toEqual([])
  })
})

describe('check-spec-drift: quoteSegments', () => {
  it('splits a spliced quote on an ellipsis, preserving order', () => {
    expect(quoteSegments('first passage... second passage')).toEqual(['first passage', 'second passage'])
  })

  it('treats a unicode ellipsis identically', () => {
    expect(quoteSegments('first passage… second passage')).toEqual(['first passage', 'second passage'])
  })

  // Splicing after a sentence yields FOUR dots. Consuming only three would
  // leave a stray '.' leading the next segment, which occurs nowhere in the
  // source -- misreporting an ordering problem as a missing passage.
  it('absorbs the full dot run when a splice follows a sentence-ending period', () => {
    expect(quoteSegments('ends a sentence.... starts the next')).toEqual(['ends a sentence', 'starts the next'])
  })
})

describe('check-spec-drift: checkQuoteIntegrity can fail', () => {
  it('accepts a rule whose hash matches its quote', () => {
    expect(checkQuoteIntegrity([verifiedRule()])).toEqual([])
  })

  it('flags a quote edited after authoring (hash no longer matches)', () => {
    const r = verifiedRule()
    r.rule.spec.normative_quote = QUOTE.replace('MUST', 'SHOULD')
    const violations = checkQuoteIntegrity([r])
    expect(violations).toHaveLength(1)
    expect(violations[0]).toContain('does not match sha256(spec.normative_quote)')
  })

  it('flags a missing normative_quote rather than skipping the rule', () => {
    expect(checkQuoteIntegrity([ruleWith({content_sha256: sha256(QUOTE)})])[0]).toContain('spec.normative_quote is required')
  })

  it('flags a spliced segment truncated below the anti-truncation floor', () => {
    const quote = `${QUOTE}... short bit`
    const violations = checkQuoteIntegrity([ruleWith({normative_quote: quote, content_sha256: sha256(quote)})])
    expect(violations).toHaveLength(1)
    expect(violations[0]).toContain(`shorter than the ${MIN_SEGMENT_CHARS}-character floor`)
  })
})

describe('check-spec-drift: checkSourceDrift can fail', () => {
  const source = `2.5.3.  Contact\n\n   The "Contact" field indicates a method that researchers should use.\n   ${QUOTE}\n`

  function fetchReturning(text: string) {
    return vi.fn().mockResolvedValue(text)
  }

  it('passes when the quote still occurs in the pinned source', async () => {
    expect(await checkSourceDrift([verifiedRule()], {fetchText: fetchReturning(source)})).toEqual([])
  })

  it('matches across a hard-wrapped line break in the source', async () => {
    const wrapped = '   This field MUST always be present in a\n   "security.txt" file.\n'
    expect(await checkSourceDrift([verifiedRule()], {fetchText: fetchReturning(wrapped)})).toEqual([])
  })

  // THE HEADLINE CASE. Integrity and check-spec-verification both go green
  // here (the hash was dutifully re-run); only the drift probe catches that
  // the source never said SHOULD.
  it('catches a normative MUST silently downgraded to SHOULD', async () => {
    const weakened = QUOTE.replace('MUST', 'SHOULD')
    const violations = await checkSourceDrift([verifiedRule(weakened)], {fetchText: fetchReturning(source)})
    expect(violations).toHaveLength(1)
    expect(violations[0]).toContain('no longer occurs in its pinned source')
  })

  it('catches spliced passages that appear OUT OF ORDER in the source', async () => {
    const quote = `${QUOTE}... The "Contact" field indicates a method that researchers should use.`
    const violations = await checkSourceDrift([verifiedRule(quote)], {fetchText: fetchReturning(source)})
    expect(violations).toHaveLength(1)
    expect(violations[0]).toContain('OUT OF ORDER')
  })

  it('reports an unreachable source as INDETERMINATE rather than passing', async () => {
    const failing = vi.fn().mockRejectedValue(new Error('HTTP 503'))
    const violations = await checkSourceDrift([verifiedRule()], {fetchText: failing})
    expect(violations).toHaveLength(1)
    expect(violations[0]).toContain('INDETERMINATE')
    expect(violations[0]).toContain('HTTP 503')
  })

  it('deduplicates fetches -- many rules citing one source fetch it once', async () => {
    const spy = fetchReturning(source)
    await checkSourceDrift([verifiedRule(), verifiedRule(), verifiedRule()], {fetchText: spy})
    expect(spy).toHaveBeenCalledTimes(1)
  })

  it('does not probe a rule that is not verified_against_source', async () => {
    const spy = fetchReturning(source)
    const unverified = ruleWith({normative_quote: QUOTE, content_sha256: sha256(QUOTE), verified_against_source: false})
    expect(await checkSourceDrift([unverified], {fetchText: spy})).toEqual([])
    expect(spy).not.toHaveBeenCalled()
  })

  it('de-marks markdown so a quote from a rendered page matches a raw blob', async () => {
    const quote = 'a required markdown hyperlink name, then optionally a : and notes'
    const raw = 'containing `a required markdown hyperlink [name](url), then optionally a : and notes` about the file.'
    expect(await checkSourceDrift([verifiedRule(quote)], {fetchText: fetchReturning(raw)})).toEqual([])
  })
})
