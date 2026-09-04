// audits/lib/differential.mjs -- reusable differential tester for two
// implementations of the same pure function. Replaces the one-off fuzz/classify/
// diff scripts written for atlas decision 0036 (posture 3, llms.txt): those were
// three scratch drivers that each rebuilt sampling, normalization, and counting.
//
// The harness COLLECTS divergences instead of failing on the first one, because
// the question a differential run answers is "which behaviours can the
// evaluation layer not distinguish?", not "is there at least one?". Classes,
// counts, and the smallest input per class are the reportable answer.
//
// The seed is fixed by default so a reported divergence is reproducible.

import fc from 'fast-check'

const UNCLASSIFIED = 'unclassified'

const defaultEq = (a, b) => JSON.stringify(a) === JSON.stringify(b)

const run = (impl, input) => {
  try {
    return {value: impl(input)}
  } catch (error) {
    return {error: `THREW: ${error.message}`}
  }
}

/**
 * Compare two implementations over inputs drawn from a fast-check arbitrary.
 *
 * @param {(input: any) => any} implA reference implementation
 * @param {(input: any) => any} implB candidate implementation
 * @param {import('fast-check').Arbitrary<any>} arbitrary input generator
 * @param {{runs?: number, seed?: number, eq?: (a: any, b: any) => boolean, classify?: (input: any, a: any, b: any) => string | null}} [options]
 * @returns {{runs: number, divergent: number, byClass: Record<string, number>, unclassifiedCount: number, minimalPerClass: Record<string, any>}}
 */
export function differential(implA, implB, arbitrary, options = {}) {
  const {runs = 20000, seed = 42, eq = defaultEq, classify = () => null} = options
  const byClass = {}
  const minimalPerClass = {}
  let divergent = 0

  for (const input of fc.sample(arbitrary, {numRuns: runs, seed})) {
    const a = run(implA, input)
    const b = run(implB, input)
    const same = a.error !== undefined || b.error !== undefined ? a.error === b.error : eq(a.value, b.value)
    if (same) {
      continue
    }

    divergent++
    const label = classify(input, a.value, b.value) ?? UNCLASSIFIED
    byClass[label] = (byClass[label] ?? 0) + 1
    const incumbent = minimalPerClass[label]
    if (incumbent === undefined || String(input).length < String(incumbent).length) {
      minimalPerClass[label] = input
    }
  }

  return {runs, divergent, byClass, unclassifiedCount: byClass[UNCLASSIFIED] ?? 0, minimalPerClass}
}
