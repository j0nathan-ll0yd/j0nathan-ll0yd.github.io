// audits/__tests__/fixtures/validate-llms-txt.regenerated.mjs -- TEST FIXTURE, NOT
// PRODUCTION CODE.
//
// PROVENANCE: copied verbatim from atlas decision 0036 (posture 3, llms.txt),
// evidence file decisions/evidence/0036-posture3-llms-txt/validate-llms-txt.regenerated.mjs.
// The ONLY edit is this header and the specs/load.mjs import path below, which
// moves from './specs/load.mjs' (the file sat next to the validator under the
// pre-0111 scripts/audit/ layout) to the relative path from
// audits/__tests__/fixtures/. The
// validation logic is unchanged, so audits/__tests__/llms-differential.test.ts
// reproduces the divergence classes 0036 reported.
//
// A blind regeneration of validateLlmsTxt from the rule
// catalog (audits/specs/llms-txt/*.rule.json) plus its declared cases,
// written WITHOUT reading the original validate-llms-txt.mjs. It exists to
// answer ADR 0006's Deletion Test question for this grain -- "if this were
// deleted and regenerated from its specification and evaluations, what would
// tell us the result was correct?" -- and ADR 0011 follow-up (c), which asks
// for exactly this rehearsal on llms.txt.
//
// Everything below was derived from these five declared expectations:
//   llms-txt-h1                 first non-blank line matches /^#\s+\S/
//   llms-txt-second-h1          (given a valid H1) no further line matches /^#\s+\S/
//   llms-txt-blockquote         (given a valid H1) the next non-blank line matches /^>\s+\S/
//   llms-txt-h2-no-file-list    every H2 section has >= 1 line matching /^[-*]\s+/
//   llms-txt-non-link-list-item (once an H2 is seen) each list item matches
//                               /^[-*]\s+\[name\](url)(: notes)?$/
//
// INFERENCES THE SPECIFICATION DOES NOT STATE. Each is a place a regenerated
// implementation could diverge while every declared case stays green -- the
// actual output of this rehearsal:
//   (1) What syntax opens an H2 section. No rule says. Assumed /^##\s+/.
//   (2) Whether a violated rule emits ONCE or PER OCCURRENCE. Every declared
//       case contains exactly one instance of each violation, so the multiset
//       assertion cannot discriminate. Assumed per-occurrence for the two
//       section rules and once for second-h1.
//   (3) Whether a list item appearing BEFORE any H2 is checked. The
//       applicability says "once at least one H2 has been seen", so assumed no.
//   (4) The exact shape of "[name](url)" and of the optional ": notes" tail.

import {emit, rules} from '../../specs/load.mjs'

const H1 = /^#\s+\S/
const H2 = /^##\s+/
const BLOCKQUOTE = /^>\s+\S/
const LIST_ITEM = /^[-*]\s+/
// Inference (4): a markdown link, optionally followed by a colon and notes.
const LINK_LIST_ITEM = /^[-*]\s+\[[^\]]+\]\([^)]+\)(?::\s+\S.*)?$/

/**
 * @param {string} body raw llms.txt contents
 * @returns {Array<{severity: string, id: string, message: string}>}
 */
export function validateLlmsTxt(body) {
  const R = rules('llms-txt')
  const findings = []

  const lines = String(body).split(/\r?\n/)
  const nonBlank = lines.filter((line) => line.trim() !== '')

  // --- llms-txt-h1 -------------------------------------------------------
  const firstLine = nonBlank[0]
  const hasValidH1 = firstLine !== undefined && H1.test(firstLine)
  if (!hasValidH1) {
    findings.push(emit(R, 'llms-txt-h1', 'first non-blank line is not an H1 (expected "# Title")'))
  }

  // The next two rules declare applicability "an llms.txt body [whose first
  // non-blank line is / that already has] a valid H1", so both are
  // inapplicable without one -- missing-h1.txt expects ONLY llms-txt-h1.
  if (hasValidH1) {
    // --- llms-txt-blockquote ---------------------------------------------
    const afterH1 = nonBlank[1]
    if (afterH1 === undefined || !BLOCKQUOTE.test(afterH1)) {
      findings.push(emit(R, 'llms-txt-blockquote', 'the line after the H1 is not a "> summary" blockquote'))
    }

    // --- llms-txt-second-h1 ----------------------------------------------
    // Inference (2): emitted once however many extra H1s appear.
    if (nonBlank.slice(1).some((line) => H1.test(line))) {
      findings.push(emit(R, 'llms-txt-second-h1', 'a second H1 appears after the first'))
    }
  }

  // --- the two H2-section rules -----------------------------------------
  // Inference (1): an H2 opens at /^##\s+/ and runs to the next H2 or EOF.
  // Inference (3): items before the first H2 are not checked.
  let inSection = false
  let sectionHeading = ''
  let sectionHasListItem = false

  const closeSection = () => {
    if (inSection && !sectionHasListItem) {
      findings.push(emit(R, 'llms-txt-h2-no-file-list', `H2 section "${sectionHeading}" contains no file list`))
    }
  }

  for (const line of lines) {
    if (H2.test(line)) {
      closeSection()
      inSection = true
      sectionHeading = line.replace(H2, '').trim()
      sectionHasListItem = false
      continue
    }
    if (inSection && LIST_ITEM.test(line)) {
      sectionHasListItem = true
      // Inference (2): emitted per offending item.
      if (!LINK_LIST_ITEM.test(line)) {
        findings.push(emit(R, 'llms-txt-non-link-list-item', `list item is not a markdown link: ${line.trim()}`))
      }
    }
  }
  closeSection()

  return findings
}
