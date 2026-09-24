// audits/__tests__/spec-currency.test.ts -- the B2 spec CURRENCY probe (atlas decision
// 0129 C6). Sibling to spec-drift.test.ts, and the same discipline: every verdict this
// check can reach is exercised with an INJECTED fetch, so the suite runs on every pull
// request without touching the network. The live comparison is the weekly report-only
// audit-web.yml job's business.
//
// WHY EACH VERDICT IS PINNED. ADR 0010/0011's lesson is that a gate never observed to
// fail is indistinguishable from no gate, and this probe's failure mode is subtler than
// most: the states that matter are all "the check ran and said nothing was wrong". A
// not-applicable source, a current source, an unreachable source and a moved source
// whose quote survives ALL exit 0, so only the finding id and the measured count
// separate them. Those are exactly what is asserted below.

import {createHash} from 'node:crypto'
import {describe, expect, it, vi} from 'vitest'
import {
  checkSpecCurrency,
  classifySource,
  fetchCurrencySources,
  judgeCurrency,
  probedRules,
  REPIN_GRACE_MS,
  REPIN_GRACE_RUNS
} from '../checks/b2-check-spec-currency.mjs'
import {citation, pinned, readRawRules} from '../checks/b2-check-spec-drift.mjs'

const PINNED_SHA = 'c7178b9dcdbf696517f52b2d3126e417eb95fd59'
const GITHUB_URL = `https://raw.githubusercontent.com/AnswerDotAI/llms-txt/${PINNED_SHA}/nbs/index.qmd`
const RFC_URL = 'https://www.rfc-editor.org/rfc/rfc9116.txt'
const RSS_URL = 'https://www.rssboard.org/rss-2-0-11'

const QUOTE = 'An H1 with the name of the project or site. This is the only required section'
const PINNED_BODY = `## Format\n\n- An optional byte-order mark (BOM)\n- ${QUOTE}\n`

interface Finding {
  severity: string
  id: string
  message: string
}

interface CitationFields {
  quote: string
  content_sha256?: string
  pinnedAt?: string
  retrieved?: string
}

/** The raw shape readRawRules yields: parsed JSON, deliberately unvalidated. */
interface RawRule {
  rel: string
  rule: {id: string; cites?: CitationFields; derivedFrom?: CitationFields}
}

type FetchText = (url: string) => Promise<string>
type FetchCommit = () => Promise<string | null>

function sha256(s: string): string {
  return createHash('sha256').update(s, 'utf-8').digest('hex')
}

function ruleWith(url: string, quote = QUOTE, rel = 'llms-txt/example.rule.json', arm: 'cites' | 'derivedFrom' = 'derivedFrom'): RawRule {
  // `derivedFrom` by DEFAULT, deliberately: the llms-txt rules this check was built to
  // watch are all rule_class: convention, so the local arm is the realistic case and the
  // one an arm-keyed probed set would have dropped.
  return {rel, rule: {id: 'example', [arm]: {quote, content_sha256: sha256(quote), pinnedAt: url, retrieved: '2026-07-30'}}}
}

/** Serve the pinned URL one body and the HEAD URL another. */
function fetchServing(pinned: string, current: string): FetchText {
  return vi.fn(async (url: string) => (url.includes('/HEAD/') ? current : pinned))
}

const noCommitLookup: FetchCommit = vi.fn(async () => null)

// A fixed clock keeps the escalation arm deterministic: `retrieved` in every synthetic rule is
// 2026-07-30, and NOW is one week later unless a case says otherwise.
const NOW_MS = Date.parse('2026-08-06T00:00:00.000Z')

async function judge(rules: RawRule[], fetchText: FetchText, fetchCommit: FetchCommit = noCommitLookup, nowMs = NOW_MS): Promise<Finding[]> {
  return judgeCurrency(rules, await fetchCurrencySources(rules, {fetchText, fetchCommit}), {nowMs}) as Finding[]
}

const idsOf = (findings: Finding[]) => findings.map((f) => f.id)

describe('check-spec-currency: classifySource', () => {
  it('gives a commit-pinned GitHub blob a current equivalent at the default branch', () => {
    expect(classifySource(GITHUB_URL)).toMatchObject({
      kind: 'github-raw',
      owner: 'AnswerDotAI',
      repo: 'llms-txt',
      pinnedCommit: PINNED_SHA,
      path: 'nbs/index.qmd',
      currentUrl: 'https://raw.githubusercontent.com/AnswerDotAI/llms-txt/HEAD/nbs/index.qmd'
    })
  })

  // THE HONEST-DENOMINATOR RULE (decision 0129 C6 constraint 2). An immutable
  // publication has no current version at the same identity, and saying so is
  // different from filtering it out: one reports 17 rules deliberately out of scope,
  // the other reports 17 rules nobody looked at.
  it.each([[RFC_URL, 'RFC'], [RSS_URL, 'RSS Advisory Board']])('classifies %s as an immutable publication with a stated reason', (url, phrase) => {
    const source = classifySource(url) as {kind: string; reason: string}
    expect(source.kind).toBe('immutable-publication')
    expect(source.reason).toContain(phrase)
  })

  // rule.schema.json's verification_url anyOf and this classifier must stay in step.
  // If the schema widens and nobody teaches the classifier, the new shape is an
  // UNEXAMINED source -- and an unexamined source read as out-of-scope is precisely
  // the silent-skip this check exists to refuse.
  it('refuses to read an unrecognised URL shape as out-of-scope', () => {
    expect(classifySource('https://example.org/some-spec').kind).toBe('unclassified')
  })
})

describe('check-spec-currency: the judged verdicts', () => {
  it('reports a source whose current blob is byte-identical, rather than passing silently', async () => {
    const findings = await judge([ruleWith(GITHUB_URL)], fetchServing(PINNED_BODY, PINNED_BODY))
    expect(idsOf(findings)).toEqual(['spec-currency-current'])
    expect(findings[0].severity).toBe('info')
  })

  // THE HEADLINE CASE, and the measured receipt behind decision 0129 C6: upstream
  // llms-txt shipped a v2 in which the five normative Format bullets are byte-identical
  // and the surrounding prose is rewritten. No rule is falsified, so this must be
  // advisory -- a prompt to re-read, never a defect that reds anything.
  it('warns when the source moved but every dependent quote survives', async () => {
    const revised = `${PINNED_BODY}\nA new paragraph about rel="describedby" that changes no normative bullet.\n`
    const findings = await judge([ruleWith(GITHUB_URL)], fetchServing(PINNED_BODY, revised))
    expect(idsOf(findings)).toEqual(['spec-source-moved'])
    expect(findings[0].severity).toBe('warn')
    expect(findings[0].message).toContain('STILL OCCURS')
  })

  // THE PATIENCE ARM (atlas decision 0142 step 5.3). A warn that never escalates is decoration:
  // it exits 0, and the weekly reconciler reads only the step outcome, so the prompt to re-pin
  // ends in a log line. The receipt is this check's own header -- llms.txt v2 upstream since
  // 2026-08-10 against a pin retrieved 2026-07-30, warned weekly and never acted on.
  it('escalates a surviving-quote revision to fail once the pin has gone un-refreshed past the grace window', async () => {
    const revised = `${PINNED_BODY}\nprose that moves no normative bullet\n`
    const wellPast = Date.parse('2026-07-30T00:00:00.000Z') + REPIN_GRACE_MS + 1
    const findings = await judge([ruleWith(GITHUB_URL)], fetchServing(PINNED_BODY, revised), noCommitLookup, wellPast)

    expect(idsOf(findings)).toEqual(['spec-source-moved-unrepinned'])
    expect(findings[0].severity).toBe('fail')
    // The FACT is unchanged; only the patience for it ran out. Both halves are said out loud.
    expect(findings[0].message).toContain('no rule is falsified')
    expect(findings[0].message).toContain(`${REPIN_GRACE_RUNS}-run grace`)
  })

  it('stays advisory on the run before the window closes, and names how far through it is', async () => {
    const revised = `${PINNED_BODY}\nprose that moves no normative bullet\n`
    const justInside = Date.parse('2026-07-30T00:00:00.000Z') + REPIN_GRACE_MS - 1
    const findings = await judge([ruleWith(GITHUB_URL)], fetchServing(PINNED_BODY, revised), noCommitLookup, justInside)

    expect(idsOf(findings)).toEqual(['spec-source-moved'])
    expect(findings[0].severity).toBe('warn')
    expect(findings[0].message).toContain(`of the ${REPIN_GRACE_RUNS} weekly run(s) this stays advisory for`)
  })

  // Re-pinning ONE dependent means a human re-read the source, so the clock restarts for all of
  // them. The freshest date is what counts, not the oldest.
  it('restarts the clock when any single dependent has been re-pinned recently', async () => {
    const revised = `${PINNED_BODY}\nprose\n`
    const stale = ruleWith(GITHUB_URL, QUOTE, 'llms-txt/a.rule.json') // retrieved 2026-07-30
    const refreshed = ruleWith(GITHUB_URL, QUOTE, 'llms-txt/b.rule.json')
    refreshed.rule.derivedFrom!.retrieved = '2026-09-28'
    // 2026-07-30 plus the eight-week window closes on 2026-09-24, so this clock is past it for
    // `stale` alone and well inside it once `refreshed` is present.
    const wellPast = Date.parse('2026-10-01T00:00:00.000Z')

    expect(idsOf(await judge([stale], fetchServing(PINNED_BODY, revised), noCommitLookup, wellPast))).toEqual(['spec-source-moved-unrepinned'])
    expect(idsOf(await judge([stale, refreshed], fetchServing(PINNED_BODY, revised), noCommitLookup, wellPast))).toEqual(['spec-source-moved'])
  })

  // A citation with no parseable retrieval date cannot be timed, and inventing an age for it
  // would escalate on ignorance. It stays the advisory it always was.
  it('does not escalate a revision it cannot date', async () => {
    const undated = ruleWith(GITHUB_URL)
    delete undated.rule.derivedFrom!.retrieved
    const findings = await judge([undated], fetchServing(PINNED_BODY, `${PINNED_BODY}\nprose\n`), noCommitLookup, Date.parse('2030-01-01T00:00:00.000Z'))

    expect(idsOf(findings)).toEqual(['spec-source-moved'])
    expect(findings[0].message).not.toContain('weekly run(s) this stays advisory for')
  })

  // A GONE quote is a different fact and outranks the timer: it says the rule may now enforce a
  // superseded reading, which is true on the first run, not after eight.
  it('reports an absent quote as the quote-absent failure, not as an un-refreshed pin', async () => {
    const gutted = '## Format\n\n- An optional byte-order mark (BOM)\n- An H1 is now merely encouraged\n'
    const wellPast = Date.parse('2030-01-01T00:00:00.000Z')
    expect(idsOf(await judge([ruleWith(GITHUB_URL)], fetchServing(PINNED_BODY, gutted), noCommitLookup, wellPast))).toEqual([
      'spec-source-moved-quote-absent'
    ])
  })

  // The escalation, and the reason the two verdicts are not one. `fail` is the only
  // severity the managed-issue reconciler can see, so it is what makes a human look.
  it('fails when the source moved AND the cited clause is gone from the current document', async () => {
    const gutted = '## Format\n\n- An optional byte-order mark (BOM)\n- An H1 is now merely encouraged\n'
    const findings = await judge([ruleWith(GITHUB_URL)], fetchServing(PINNED_BODY, gutted))
    expect(idsOf(findings)).toEqual(['spec-source-moved-quote-absent'])
    expect(findings[0].severity).toBe('fail')
  })

  it('names the pinned sha, the current sha and the compared URL, so the report can be acted on', async () => {
    const revised = `${PINNED_BODY}\nrevised prose\n`
    const commit = vi.fn(async () => 'a'.repeat(40))
    const [finding] = await judge([ruleWith(GITHUB_URL)], fetchServing(PINNED_BODY, revised), commit)
    expect(finding.message).toContain(PINNED_SHA)
    expect(finding.message).toContain('a'.repeat(40))
    expect(finding.message).toContain(sha256(PINNED_BODY))
    expect(finding.message).toContain('/HEAD/nbs/index.qmd')
  })

  // ENRICHMENT MUST NOT BECOME A VERDICT. The comparison is decided by bytes; a rate
  // limit on the commit lookup degrades the report and leaves the finding intact.
  it('still reports the revision when the commit lookup is unavailable', async () => {
    const findings = await judge([ruleWith(GITHUB_URL)], fetchServing(PINNED_BODY, `${PINNED_BODY}\nrevised\n`), vi.fn(async () => null))
    expect(idsOf(findings)).toEqual(['spec-source-moved'])
    expect(findings[0].message).toContain('unresolved')
  })

  it('reports an unreachable source as INDETERMINATE rather than current', async () => {
    const findings = await judge([ruleWith(GITHUB_URL)], vi.fn().mockRejectedValue(new Error('HTTP 503')))
    expect(idsOf(findings)).toEqual(['spec-currency-indeterminate'])
    expect(findings[0].severity).toBe('fail')
    expect(findings[0].message).toContain('HTTP 503')
  })

  // Both blobs or no verdict. Holding only the current side cannot answer "did this
  // change", and guessing from one side is how a probe invents a clean run.
  it('is INDETERMINATE when only one of the two blobs arrives', async () => {
    const halfDark = vi.fn(async (url: string) => {
      if (url.includes('/HEAD/')) {
        throw new Error('HTTP 404')
      }
      return PINNED_BODY
    })
    expect(idsOf(await judge([ruleWith(GITHUB_URL)], halfDark))).toEqual(['spec-currency-indeterminate'])
  })

  it('classifies an immutable publication as not-applicable without fetching it', async () => {
    const spy = fetchServing(PINNED_BODY, PINNED_BODY)
    const findings = await judge([ruleWith(RFC_URL, 'This field MUST always be present in a "security.txt" file.')], spy)
    expect(idsOf(findings)).toEqual(['spec-currency-not-applicable'])
    expect(findings[0].severity).toBe('info')
    expect(spy).not.toHaveBeenCalled()
  })

  it('fails an unclassified source instead of reading it as out-of-scope', async () => {
    const findings = await judge([ruleWith('https://example.org/spec')], fetchServing(PINNED_BODY, PINNED_BODY))
    expect(idsOf(findings)).toEqual(['spec-currency-unclassified-source'])
    expect(findings[0].severity).toBe('fail')
  })

  // ONE SOURCE IS ONE FACT. Five rules citing one revised document is one revision,
  // not five; inflating it would bury the count of documents actually examined.
  it('reports per source and names every dependent rule', async () => {
    const rules = ['a', 'b', 'c'].map((n) => ruleWith(GITHUB_URL, QUOTE, `llms-txt/${n}.rule.json`))
    const findings = await judge(rules, fetchServing(PINNED_BODY, `${PINNED_BODY}\nrevised\n`))
    expect(findings).toHaveLength(1)
    for (const n of ['a', 'b', 'c']) {
      expect(findings[0].message).toContain(`llms-txt/${n}.rule.json`)
    }
  })

  it('does not probe a rule that records no pinned source', async () => {
    const spy = fetchServing(PINNED_BODY, PINNED_BODY)
    const unpinned: RawRule = {rel: 'llms-txt/x.rule.json', rule: {id: 'x'}}
    expect(await judge([unpinned], spy)).toEqual([])
    expect(spy).not.toHaveBeenCalled()
  })

  it('probes a cites rule and a derivedFrom rule identically', async () => {
    // Scope is "has a pinned source", not "claims conformance". Both arms fetch.
    const spy = fetchServing(PINNED_BODY, PINNED_BODY)
    await judge([ruleWith(GITHUB_URL, QUOTE, 'llms-txt/a.rule.json', 'cites')], spy)
    expect(spy).toHaveBeenCalled()
    const spy2 = fetchServing(PINNED_BODY, PINNED_BODY)
    await judge([ruleWith(GITHUB_URL, QUOTE, 'llms-txt/b.rule.json', 'derivedFrom')], spy2)
    expect(spy2).toHaveBeenCalled()
  })
})

// THE MEASUREMENT CHANNEL (atlas decisions 0122, 0125). `measured` is the count of
// applicable sources whose BOTH blobs arrived. The exclusion of not-applicable sources
// is the load-bearing part and is asserted directly: today 2 of this repo's 4 pinned
// sources are immutable publications, so counting them would let a total
// raw.githubusercontent outage publish a non-zero count and ping a green tile.
describe('check-spec-currency: the measurement channel', () => {
  const liveRules = readRawRules([])

  it('measures the applicable sources it held', async () => {
    const held = await checkSpecCurrency({fetchText: fetchServing(PINNED_BODY, PINNED_BODY), fetchCommit: noCommitLookup})
    expect(held.measured).toBeGreaterThan(0)
    expect(held.measured).toBe(held.applicableCount)
  })

  it('measures ZERO when every applicable source is unreachable, even though the immutable ones are still classified', async () => {
    const dark = await checkSpecCurrency({fetchText: vi.fn().mockRejectedValue(new Error('HTTP 503')), fetchCommit: noCommitLookup})
    expect(dark.measured).toBe(0)
    // Darkness on BOTH channels: the count says nothing was held, and a finding per
    // unreachable source says why. The not-applicable sources are still reported, and
    // that is exactly why they must not be counted.
    expect(idsOf(dark.findings as Finding[])).toContain('spec-currency-indeterminate')
    expect(idsOf(dark.findings as Finding[])).toContain('spec-currency-not-applicable')
    expect(dark.notApplicableCount).toBeGreaterThan(0)
  })

  it('deduplicates fetches -- many rules citing one source fetch it once per side', async () => {
    const spy = fetchServing(PINNED_BODY, PINNED_BODY)
    await fetchCurrencySources([ruleWith(GITHUB_URL), ruleWith(GITHUB_URL), ruleWith(GITHUB_URL)], {fetchText: spy, fetchCommit: noCommitLookup})
    expect(spy).toHaveBeenCalledTimes(2)
  })

  // COMPARES THE TWO PROBES, NOT ONE PROBE AGAINST ITSELF (atlas decision 0142 step 5.3).
  // This assertion used to restate `probedRules`' own predicate on its right-hand side, using
  // the same imported `citation()` helper -- so it was near-tautological and a drift-side scope
  // change could not fail it, despite that being exactly what its name advertises. `pinned` is
  // now exported from the drift probe and compared directly.
  it('considers exactly the rules the drift probe probes, so the two cannot drift apart on scope', () => {
    expect(probedRules(liveRules).map(({rel}) => rel)).toEqual(pinned(liveRules).map(({rel}: {rel: string}) => rel))
    // Non-empty, so the equality is a real comparison rather than two empty lists agreeing.
    expect(probedRules(liveRules).length).toBeGreaterThan(0)
    // And the membership rule itself, read off the corpus rather than recalled from a comment.
    expect(probedRules(liveRules).map(({rel}) => rel)).toEqual(
      liveRules.filter(({rule}) => typeof citation(rule)?.pinnedAt === 'string').map(({rel}) => rel)
    )
  })

  // The live catalog's shape, pinned so the check cannot silently lose its subject.
  // If this ever reds because the applicable set emptied, the probe reports
  // `spec-currency-no-applicable-source` rather than measuring 0 unexplained.
  it('has at least one commit-pinned GitHub source to ask the currency question of', () => {
    expect(probedRules(liveRules).filter(({rule}) => classifySource(citation(rule)!.pinnedAt).kind === 'github-raw').length).toBeGreaterThan(0)
  })

  // THE NEAR-MISS GUARD (atlas decision 0129 consumer round). The llms.txt source is this
  // check's own motivating receipt -- a v2 shipped on 2026-08-10 against a pin from
  // 2026-07-30 and nothing in the estate noticed for a month. All five llms-txt rules are
  // rule_class: convention, so the first cut of the citation split, which keyed the probed
  // set on rule_class, would have dropped this source entirely one day after the check was
  // built to watch it. Named explicitly rather than counted, so re-introducing that bug
  // reds here with the reason attached instead of merely lowering a number.
  it('keeps the llms.txt source in scope, whatever class its rules carry', () => {
    const sources: string[] = probedRules(liveRules).map(({rule}) => citation(rule)!.pinnedAt)
    expect(sources.some((url) => url.includes('AnswerDotAI/llms-txt'))).toBe(true)
    expect(liveRules.filter(({rel}) => rel.startsWith('llms-txt/')).every(({rule}) => rule.rule_class !== 'conformance')).toBe(true)
  })
})
