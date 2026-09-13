// audits/__tests__/llms-severity-parity.test.ts -- the tether on the rule file's
// TOP-LEVEL `severity` field for the five structural llms.txt ids.
//
// THE SEVERITY IS STATED TWICE AND APPLIED ONCE. `audits/specs/llms-txt/*.rule.json`
// declares a `severity` per id; `@j0nathan-ll0yd/estate-contracts/rule-catalog/llms-txt`
// declares the same five ids with their own. The one that SHIPS is the catalog's --
// `audits/checks/b2-llms.mjs:105` runs `LLMS_TXT_CATALOG.stamp(checkLlmsStructure(rawText))`,
// so for these five ids the local `severity` field never reaches a finding.
// `rule.schema.json` already says so in prose ("the value here is the declared-case
// expectation that keeps the two tethered"); nothing held THAT field to it.
//
// WHAT ALREADY COVERS PART OF THIS, stated because it is most of the answer.
// `audits/__tests__/spec-cases.test.ts` runs each declared case through
// `validateLlmsTxt` -- which stamps from the catalog -- and multiset-compares the
// `{id, severity}` output against that case's `expect` array. So the CASE-LEVEL
// severities are already tethered to the catalog, and an edit that moves a rule's
// `cases[].expect[].severity` reds there.
//
// WHAT NOTHING COVERED: the top-level `severity` field ON ITS OWN. Measured on this
// branch by editing `llms-txt-h2-no-file-list.rule.json` to `"severity": "fail"` and
// leaving its `cases[].expect` at `warn`:
//
//   b2-check-spec-severity.mjs   exit 0    monotonic ratchet, RANK = {warn: 1, fail: 2};
//                                          every comparison is RANK[a] < RANK[b], so it
//                                          blocks a WEAKENING and admits a strengthening
//                                          by construction -- the wrong shape for drift,
//                                          which has no preferred direction
//   b2-check-spec-verification   exit 0    asks about citation shape, not severity
//   b2-check-spec-drift          exit 0    asks whether a quote is still faithful
//   spec-cases.test.ts           94/94     never reads the top-level field
//
// That field is not decorative: `severity-baseline.json` ratchets it, so a silent
// drift leaves the baseline recording a severity nothing emits, and the next reader
// of the rule file is told the wrong thing about the check they are triaging.
//
// The second assertion guards the other direction: a `convention`-class id declared
// locally but ABSENT from the catalog. `stamp` throws on an id no catalog rule carries,
// which is the runtime half of surjectivity, but it only throws when a finding is
// actually produced -- on a live weekly run, against whatever the served llms.txt
// happens to contain that day. This reds at unit time instead.
//
// SCOPE: the five CONVENTION ids only. The three OPERATIONAL ids (`llms-txt-fetch`,
// `index-md`, `llms-full-txt`) are transport conditions the shared catalog deliberately
// does not carry -- `b2-llms.mjs` still emits those through `emit(R, ...)` off the local
// rule files, so for them the local `severity` IS the applied one and there is nothing
// to compare.

import {describe, expect, it} from 'vitest'
import {LLMS_TXT_CATALOG} from '@j0nathan-ll0yd/estate-contracts/rule-catalog/llms-txt'
import {rules} from '../specs/load.mjs'

describe('llms.txt severity parity: local rule.json against the shared catalog', () => {
  const local = rules('llms-txt')
  const shared = LLMS_TXT_CATALOG.rules

  it('every catalog rule exists locally at the identical severity', () => {
    for (const [id, rule] of Object.entries(shared)) {
      expect(local[id], `${id} is in the shared catalog, absent from audits/specs/llms-txt/`).toBeDefined()
      expect(local[id].severity, `${id}: rule.json and the shared catalog disagree`).toBe(rule.severity)
    }
  })

  it('no locally-declared convention rule is missing from the catalog that stamps it', () => {
    const stamped = new Set(Object.keys(shared))
    for (const rule of Object.values(local).filter((r) => r.rule_class === 'convention')) {
      expect(stamped.has(rule.id), `${rule.id} is convention-class locally, uncarried by the catalog`).toBe(true)
    }
  })
})
