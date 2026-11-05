// Per-phase CPU of the composed read's pure functions, in Node (V8, as workerd). Usage:
//   pnpm exec tsx scripts/cpu-bench/bench.mts <artifact.json> <iterations> [label]
// A fresh process with iterations=1 measures a cold JIT; iterations=300 in one process measures warm.
// Pass a fixture artifact (tests/fixtures/composed/dashboard.json), never live data.
import {readFileSync} from 'node:fs'
import {performance} from 'node:perf_hooks'
import {HIDING_FOCUS_MODES} from '@j0nathan-ll0yd/portal-contract/constants'
import {checkArtifact, COMPOSED_FRAGMENT_IDS, COMPOSED_MAX_FUTURE_SKEW_MS, type ComposedFragmentId} from '../../src/lib/composed/artifact'
import {checkFragment} from '../../src/lib/composed/fragment-policy'

const [, , file, iterationsArg, label = 'run'] = process.argv
if (file === undefined || iterationsArg === undefined) {
  throw new Error('usage: bench.mts <artifact.json> <iterations> [label]')
}
const iterations = Number(iterationsArg)
const base = JSON.parse(readFileSync(file, 'utf8')) as {fragments: Record<ComposedFragmentId, string>; composedAt: string}
const hiding = new Set<string>(HIDING_FOCUS_MODES)
const q = (a: number[], p: number): number => {
  const s = [...a].sort((x, y) => x - y)
  return s[Math.min(s.length - 1, Math.max(0, Math.ceil(p / 100 * s.length) - 1))] ?? 0
}
const phases = {decode: [] as number[], parse: [] as number[], fragments: [] as number[], checkArtifact: [] as number[]}
for (let i = 0; i < iterations; i++) {
  // A distinct text each iteration defeats the whole-text memo (artifact.ts memoizedFragments).
  const text = JSON.stringify({...base, composer: {build: 'dev'}, composedAt: new Date(Date.now() - i).toISOString()})
  const bytes = new TextEncoder().encode(text)
  let t = performance.now()
  const decoded = new TextDecoder().decode(bytes)
  phases.decode.push(performance.now() - t)
  t = performance.now()
  const value = JSON.parse(decoded) as {fragments: Record<ComposedFragmentId, string>; composedAt: string}
  phases.parse.push(performance.now() - t)
  t = performance.now()
  for (const id of COMPOSED_FRAGMENT_IDS) {
    const r = checkFragment(value.fragments[id], id, {maxGeneratedAtMs: Date.parse(value.composedAt) + COMPOSED_MAX_FUTURE_SKEW_MS, overlayMayShow: false})
    if (!r.ok) {
      throw new Error(`${id} refused: ${r.reason}`)
    }
  }
  phases.fragments.push(performance.now() - t)
  t = performance.now()
  const checked = checkArtifact(decoded, Date.now(), 'dev', hiding)
  phases.checkArtifact.push(performance.now() - t)
  if (!checked.ok) {
    throw new Error(`refused ${checked.refusal} ${checked.detail ?? ''}`)
  }
}
const bytes = Buffer.byteLength(JSON.stringify(base))
const row = (name: string, a: number[]): string =>
  `${name.padEnd(14)} first ${(a[0] ?? 0).toFixed(2).padStart(6)}  median ${q(a, 50).toFixed(2).padStart(6)}  p90 ${q(a, 90).toFixed(2).padStart(6)}  min ${
    Math.min(...a).toFixed(2).padStart(6)
  } ms`
console.log(`${label}: ${bytes} bytes, ${iterations} iteration(s)`)
for (const [name, a] of Object.entries(phases)) {
  if (a.length > 0) {
    console.log(row(name, a))
  }
}
