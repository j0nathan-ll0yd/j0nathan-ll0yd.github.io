// Summarizes a .cpuprofile: active CPU (JS and native, excluding idle and program), self time by function and by module.
// Usage: node scripts/cpu-bench/summarize.mjs <file.cpuprofile> [divisor=1] [top=30]
import {readFileSync} from 'node:fs'
const [, , file, divisor = '1', top = '30'] = process.argv
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
const name = (n) => n.callFrame.functionName || '(anon)'
const mod = (n) => (n.callFrame.url || '').replace(/^.*\/dist\/server\//, '').replace(/^file:\/\/.*\/node_modules\//, 'nm:') || '(native)'
let active = 0, idle = 0, program = 0, gc = 0
const byFn = new Map(), byMod = new Map(), inclFn = new Map()
for (const [id, t] of self) {
  const n = byId.get(id)
  if (name(n) === '(program)') {
    program += t
    continue
  }
  if (['(idle)', '(root)'].includes(name(n))) {
    idle += t
    continue
  }
  if (name(n) === '(garbage collector)') {
    gc += t
  }
  active += t
  const fk = `${name(n)} @ ${mod(n)}:${n.callFrame.lineNumber}`
  byFn.set(fk, (byFn.get(fk) ?? 0) + t)
  byMod.set(mod(n), (byMod.get(mod(n)) ?? 0) + t)
  const seen = new Set()
  let cur = id
  while (cur !== undefined) {
    const m = byId.get(cur)
    const k = `${name(m)} @ ${mod(m)}`
    if (!seen.has(k)) {
      seen.add(k)
      inclFn.set(k, (inclFn.get(k) ?? 0) + t)
    }
    cur = parent.get(cur)
  }
}
const d = Number(divisor), ms = (t) => (t / 1000 / d).toFixed(2)
console.log(
  `${file.split('/').slice(-2).join('/')}: active ${ms(active)} ms per request (÷${d}; gc ${ms(gc)}), program ${ms(program)}, idle ${
    (idle / 1000).toFixed(1)
  } ms total, samples ${p.samples.length}`
)
console.log('-- self by module')
for (const [k, v] of [...byMod].sort((a, b) => b[1] - a[1]).slice(0, 12)) {
  console.log(ms(v).padStart(7), k)
}
console.log('-- inclusive by function (top)')
for (const [k, v] of [...inclFn].sort((a, b) => b[1] - a[1]).slice(0, Number(top))) {
  console.log(ms(v).padStart(7), k)
}
console.log('-- self by function (top)')
for (const [k, v] of [...byFn].sort((a, b) => b[1] - a[1]).slice(0, Number(top))) {
  console.log(ms(v).padStart(7), k)
}
