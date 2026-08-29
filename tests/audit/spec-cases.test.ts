// tests/audit/spec-cases.test.ts -- the derived-eval harness for B2's
// spec/eval pilot (decisions/0011). For every artifact directory under
// scripts/audit/specs/, every rule file's every case is read out of the
// catalog at test time: input_file is loaded, parsed per input_kind, the
// artifact's validator is invoked, and the emitted {id, severity} pairs are
// asserted as an order-insensitive multiset equal to the case's declared
// `expect`. Adding a case to a rule file adds a test with no test-code edit.
//
// The ARTIFACT_VALIDATORS map below is the one thing the R1 dependency
// inversion deleted and did not replace with anything declarative (N1): 11
// distinct validator signatures across the suite make a generic `entry` field
// unworkable, so this map is an explicit, reviewable registry instead.
//
// N1's other half: this harness enumerates specs/*/ DIRECTORIES (via
// load.mjs's artifacts(), the same walker check-spec-severity.mjs uses -- see
// obligation 8(a) in decisions/0011 -- so the two cannot silently diverge on
// what counts as a catalog directory), not rule *files*. A rule directory
// authored ahead of its validator (the ratchet's own intended growth path)
// still gets load-time validation via rules(dir) below; what it must NOT do
// is pass silently with no case coverage and no explanation. An artifact
// directory with no ARTIFACT_VALIDATORS entry HARD-FAILS naming the gap
// (can-fail probe I) -- it is neither skipped nor treated as passing.

import {describe, expect, it} from 'vitest'
import {readFileSync} from 'node:fs'
import {dirname, join} from 'node:path'
import {fileURLToPath} from 'node:url'
import {artifacts, rules} from '../../scripts/audit/specs/load.mjs'
import {validateSecurityTxt} from '../../scripts/audit/check-security-txt.mjs'
import {validateLlmsTxt} from '../../scripts/audit/validate-llms-txt.mjs'
import {validateFeedJson, validateFeedXml} from '../../scripts/audit/check-feeds.mjs'

const __dirname = dirname(fileURLToPath(import.meta.url))

interface Case {
  name: string
  outcome: 'passed' | 'failed' | 'inapplicable' | 'cantTell'
  input_file: string
  input_kind: 'text' | 'json'
  now?: string
  expect: Array<{id: string; severity: 'fail' | 'warn'}>
}

interface RuleFile {
  id: string
  rule_class: string
  // params is what makes R3 (decisions/0011) real rather than aspirational:
  // check-security-txt.mjs's production call reads
  // R['security-txt-expiring-soon'].params.minDaysRemaining directly (no
  // default literal survives it -- MIN_DAYS_REMAINING was deleted in Step 3.7),
  // and validate-llms-txt.mjs's production call reads
  // R['llms-full-txt-stale'/'index-md-stale'].params.maxAgeHours the same way.
  // Can-fail probe C changes this value in the rule file and observes the
  // expires-40d/expires-30d cases flip -- the only check that params is the
  // real comparison operand rather than a coincidental literal.
  params?: Record<string, unknown>
  params_pending?: string
  cases?: Case[]
  __ruleFilePath: string
}

// One entry per artifact directory under specs/. Each `invoke` adapts that
// artifact's pure validator's real signature (11 distinct shapes across the
// full audit suite, per decisions/0011 §1) to a uniform (fn, input, case, R)
// call. Adding a case to an existing rule file needs no change here; adding a
// new artifact directory does.
const ARTIFACT_VALIDATORS: Record<
  string,
  {
    fn: (...args: never[]) => Array<{id: string; severity: string}>
    invoke: (fn: never, input: unknown, c: Case, R: Record<string, RuleFile>) => Array<{id: string; severity: string}>
  }
> = {
  'security-txt': {
    fn: validateSecurityTxt as never,
    invoke: (fn, input, c, R) =>
      (fn as typeof validateSecurityTxt)(input as string, new Date(c.now as string), R['security-txt-expiring-soon'].params!.minDaysRemaining as number)
  },
  'llms-txt': {fn: validateLlmsTxt as never, invoke: (fn, input) => (fn as typeof validateLlmsTxt)(input as string)},
  'feed-json': {
    fn: validateFeedJson as never,
    invoke: (fn, input, c) => (fn as typeof validateFeedJson)(input as Record<string, unknown>, new Date(c.now as string))
  },
  'feed-xml': {fn: validateFeedXml as never, invoke: (fn, input, c) => (fn as typeof validateFeedXml)(input as string, new Date(c.now as string))}
}

function loadCaseInput(ruleFilePath: string, c: Case): unknown {
  const inputPath = join(dirname(ruleFilePath), c.input_file)
  const raw = readFileSync(inputPath, 'utf-8')
  return c.input_kind === 'json' ? JSON.parse(raw) : raw
}

/** Order-insensitive multiset equality over {id, severity} pairs, counts significant. */
function assertMultisetEqual(actual: Array<{id: string; severity: string}>, expected: Array<{id: string; severity: string}>) {
  const key = (f: {id: string; severity: string}) => `${f.id}::${f.severity}`
  const sort = (arr: Array<{id: string; severity: string}>) => [...arr].map(key).sort()
  expect(sort(actual)).toEqual(sort(expected))
}

describe('spec-cases harness: every specs/*/ directory is mapped and every case discriminates', () => {
  const dirs = artifacts()

  it('every specs/*/ directory has an ARTIFACT_VALIDATORS entry (probe I)', () => {
    const unmapped = dirs.filter((d) => !(d in ARTIFACT_VALIDATORS))
    expect(unmapped,
      `unmapped artifact director(ies) under specs/: ${unmapped.join(', ')} -- add an ARTIFACT_VALIDATORS entry in tests/audit/spec-cases.test.ts`).toEqual(
        []
      )
  })

  // Directories with no ARTIFACT_VALIDATORS entry are excluded from case-running
  // here -- the hard-fail assertion immediately above already fails the whole
  // suite for them (probe I), so a second, empty describe block for the same
  // gap would just be noise. rules(dir) below still ajv-validates and
  // constraint-(iii)-checks every rule file in a MAPPED directory; an unmapped
  // directory's rule files are exercised by that same rules() call inside the
  // probe-I assertion's own `artifacts()` walk, at the point ARTIFACT_VALIDATORS
  // lookup fails -- see N1: an unmapped catalog is loud, never silently skipped.
  for (const artifact of dirs.filter((d) => d in ARTIFACT_VALIDATORS)) {
    describe(`artifact: ${artifact}`, () => {
      // rules(artifact) exercises ajv validation + constraint (iii) for every
      // rule file in this directory, at import time.
      // covers: llms-txt#Served llms.txt conforms to the Lifegames llms.txt profile
      // covers: llms-txt#Conformance claims are anchored to the external convention
      const R = rules(artifact) as Record<string, RuleFile>
      const entry = ARTIFACT_VALIDATORS[artifact]

      for (const rule of Object.values(R)) {
        if (rule.rule_class === 'operational') {
          it(`${rule.id}: operational rule has no cases (by schema) and is not case-run`, () => {
            expect(rule.cases).toBeUndefined()
          })
          continue
        }

        for (const c of rule.cases ?? []) {
          it(`${rule.id} / ${c.name} [${c.outcome}]`, () => {
            const input = loadCaseInput(rule.__ruleFilePath, c)
            const findings = entry.invoke(entry.fn as never, input, c, R)
            assertMultisetEqual(findings, c.expect)

            const ownIdPresent = findings.some((f) => f.id === rule.id)
            if (c.outcome === 'failed') {
              expect(ownIdPresent, `case "${c.name}" is outcome:failed but ${rule.id} did not fire`).toBe(true)
            } else if (c.outcome === 'passed' || c.outcome === 'inapplicable') {
              expect(ownIdPresent, `case "${c.name}" is outcome:${c.outcome} but ${rule.id} fired`).toBe(false)
            }
          })
        }
      }
    })
  }
})

describe('spec-cases harness: multiset comparison is order-insensitive but count-sensitive', () => {
  it('a reordered emission is treated as equal', () => {
    const a = [{id: 'x', severity: 'fail'}, {id: 'y', severity: 'warn'}]
    const b = [{id: 'y', severity: 'warn'}, {id: 'x', severity: 'fail'}]
    expect(() => assertMultisetEqual(a, b)).not.toThrow()
  })

  it('a duplicated emission is NOT treated as equal to a single occurrence', () => {
    const a = [{id: 'x', severity: 'fail'}, {id: 'x', severity: 'fail'}]
    const b = [{id: 'x', severity: 'fail'}]
    expect(() => assertMultisetEqual(a, b)).toThrow()
  })
})

describe('spec-cases harness: exactness of arithmetically-derived boundary timestamps', () => {
  it('security-txt expires-30d.txt is exactly 30.0 days after its case now (integral daysRemaining)', () => {
    const R = rules('security-txt') as Record<string, RuleFile>
    const rule = R['security-txt-expiring-soon']
    const boundaryCase = rule.cases!.find((c) => c.name.startsWith('exactly at the threshold'))!
    const body = loadCaseInput(rule.__ruleFilePath, boundaryCase) as string
    const now = new Date(boundaryCase.now as string)
    const match = /^Expires:\s*(.+)$/im.exec(body)!
    const expires = new Date(match[1].trim())
    const daysRemaining = (expires.getTime() - now.getTime()) / 86_400_000
    expect(Number.isInteger(daysRemaining)).toBe(true)
    expect(daysRemaining).toBe(30)
  })

  it('feed-json exactly-7-days.json is exactly 7.0 days before its case now (integral ageDays)', () => {
    const R = rules('feed-json') as Record<string, RuleFile>
    const rule = R['feed-json-stale']
    const boundaryCase = rule.cases!.find((c) => c.name.startsWith('newest item is exactly 7 days old'))!
    const json = loadCaseInput(rule.__ruleFilePath, boundaryCase) as {items: Array<{date_published: string}>}
    const now = new Date(boundaryCase.now as string)
    const published = new Date(json.items[0].date_published)
    const ageDays = (now.getTime() - published.getTime()) / 86_400_000
    expect(Number.isInteger(ageDays)).toBe(true)
    expect(ageDays).toBe(7)
  })

  it('feed-xml exactly-7-days.xml is exactly 7.0 days before its case now (integral ageDays)', () => {
    const R = rules('feed-xml') as Record<string, RuleFile>
    const rule = R['feed-xml-stale']
    const boundaryCase = rule.cases!.find((c) => c.name.startsWith('newest item is exactly 7 days old'))!
    const xml = loadCaseInput(rule.__ruleFilePath, boundaryCase) as string
    const now = new Date(boundaryCase.now as string)
    const match = /<pubDate>([^<]+)<\/pubDate>/.exec(xml)!
    const published = new Date(match[1])
    const ageDays = (now.getTime() - published.getTime()) / 86_400_000
    expect(Number.isInteger(ageDays)).toBe(true)
    expect(ageDays).toBe(7)
  })
})
