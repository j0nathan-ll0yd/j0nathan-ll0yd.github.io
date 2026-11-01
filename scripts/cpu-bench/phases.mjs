// Averages inclusive CPU per named phase of the `GET /` path over several .cpuprofile files.
// Usage: node scripts/cpu-bench/phases.mjs <divisor> <file.cpuprofile...>
// An async function's continuations nest under the microtask root, so inclusive figures overlap.
import {readFileSync} from 'node:fs'
const [, , divisor, ...files] = process.argv
const PHASES = [
  ['total active (JS + native, excl. idle/program)', null],
  ['(program): V8 compile/native, unattributed', '(program)'],
  ['(garbage collector)', '(garbage collector)'],
  ['readComposed: the read (proxy fetch + probe) + checkArtifact', 'readComposed'],
  ['  readGatedConcurrently: focus probe + artifact fetch (proxy.ts)', 'readGatedConcurrently'],
  ['  checkArtifact: parse + schema + fragments + record', 'checkArtifact'],
  ['    checkFragments: the 13 fragment checks (memo miss)', 'checkFragments'],
  ['    checkRecord', 'checkRecord'],
  ['  TextDecoder.decode', 'decode'],
  ['cutShell: HTMLRewriter mark + cutMarked (once per isolate)', 'cutShell'],
  ['  cutMarked', 'cutMarked'],
  ['fitsShell', 'fitsShell'],
  ['assemble: the string splice', 'assemble'],
  ['withDashboardHeaders', 'withDashboardHeaders'],
  ['logRender: the ssr_render log line', 'logRender'],
  ['attemptPublished: the published read and its answer (atlas decision 0164)', 'attemptPublished'],
  ['  readPublished: the two KV reads, judgeFocus, judgeFragments', 'readPublished'],
  ['    judgeFragments: parse + shape + fromWireFacts + fitsShell', 'judgeFragments'],
  ['  valueFreeFor: the value-free set, once per isolate (sync part)', 'valueFreeFor'],
  ['  checkValueFree: JSON.parse of the whole set + shape', 'checkValueFree'],
  ['  valueFreeVariant: the variant (inclusive of checkedVariant)', 'valueFreeVariant'],
  ['    checkedVariant: checkFragments on the variant (first use)', 'checkedVariant'],
  ['onRequest: the middleware (inclusive of the route)', 'onRequest'],
  ['parseAccept / prefersMarkdown', 'prefersMarkdown'],
  ['serve: the whole handler', 'serve']
]
const rows = PHASES.map(() => [])
for (const file of files) {
  const p = JSON.parse(readFileSync(file, 'utf8'))
  const byId = new Map(p.nodes.map((n) => [n.id, n]))
  const parent = new Map()
  for (const n of p.nodes) {
    for (const c of n.children ?? []) {
      parent.set(c, n.id)
    }
  }
  const self = new Map()
  for (let i = 0; i < p.samples.length; i++) {
    self.set(p.samples[i], (self.get(p.samples[i]) ?? 0) + (p.timeDeltas[i] ?? 0))
  }
  const incl = new Map()
  let active = 0, program = 0
  for (const [id, t] of self) {
    const n = byId.get(id)
    const fn = n.callFrame.functionName
    if (fn === '(program)') {
      program += t
      continue
    }
    if (fn === '(idle)' || fn === '(root)') {
      continue
    }
    active += t
    const seen = new Set()
    let cur = id
    while (cur !== undefined) {
      const m = byId.get(cur)
      const k = m.callFrame.functionName
      if (!seen.has(k)) {
        seen.add(k)
        incl.set(k, (incl.get(k) ?? 0) + t)
      }
      cur = parent.get(cur)
    }
  }
  PHASES.forEach(([, fn], i) => rows[i].push(fn === null ? active : fn === '(program)' ? program : (incl.get(fn) ?? 0)))
}
const d = Number(divisor)
console.log(`${files.length} profile(s), per request (÷${d}); ms: mean [min..max]`)
PHASES.forEach(([label], i) => {
  const v = rows[i].map((x) => x / 1000 / d)
  const mean = v.reduce((a, b) => a + b, 0) / v.length
  console.log(`${mean.toFixed(2).padStart(7)}  [${Math.min(...v).toFixed(2)}..${Math.max(...v).toFixed(2)}]  ${label}`)
})
