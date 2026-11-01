// Profiles `GET /` on the three published-read paths (atlas decision 0164 row 1): `published` (a
// visible focus value and fresh fragments), `suppressed` (a hiding focus value: the value-free page)
// and `unavailable` (no focus key: the value-free page). Each round seeds the local PAGE namespace for
// one path and profiles a fresh isolate (scripts/cpu-bench/profile.mjs, PLANE=none), in rotation, so
// a change in host load falls on every path alike. Prints the first request's CPU (JS plus V8
// compile) and the warm CPU per request, per path, with the load average of each run and the sha256
// of the body each run served.
// Usage: [PORT=..] [INSPECTOR_PORT=..] [OUT=/tmp/cpu-prof] [BUILDS=label:dir,...] node scripts/cpu-bench/paths.mjs <label> [rounds=5] [warmRequests=50]
// Needs a built dist/ and dist-composer/ (pnpm build). Run from the repo root. Local data only.
// BUILDS compares builds in one session: each dir holds a saved `dist` and `dist-composer`, copied
// into place before that build's runs, so every build meets the same host load in each round.
import {execFileSync} from 'node:child_process'
import {readFileSync, writeFileSync} from 'node:fs'

const [, , label = 'paths', roundsArg = '5', warmArg = '50'] = process.argv
const ROUNDS = Number(roundsArg), WARM = Number(warmArg)
const OUT = process.env.OUT ?? '/tmp/cpu-prof'
const PATHS = [
  {name: 'published', focus: undefined, expect: 'live,stale,partial'},
  {name: 'suppressed', focus: 'Work', expect: 'suppressed'},
  {name: 'unavailable', focus: '-', expect: 'unavailable'}
]
const BUILDS = (process.env.BUILDS ?? '').split(',').filter(Boolean).map((entry) => {
  const at = entry.indexOf(':')
  return {name: entry.slice(0, at), dir: entry.slice(at + 1)}
})

/** Active CPU (JS and native, without idle and program) and `(program)` of one .cpuprofile, in ms. */
function cpuOf(file) {
  const profile = JSON.parse(readFileSync(file, 'utf8'))
  const byId = new Map(profile.nodes.map((node) => [node.id, node]))
  let active = 0, program = 0
  for (let i = 0; i < profile.samples.length; i++) {
    const name = byId.get(profile.samples[i]).callFrame.functionName
    const t = profile.timeDeltas[i] ?? 0
    if (name === '(program)') {
      program += t
    } else if (name !== '(idle)' && name !== '(root)') {
      active += t
    }
  }
  return {active: active / 1000, program: program / 1000}
}

/** Copies a saved build into dist/ and dist-composer/, where wrangler dev and seed-kv.mjs read it. */
function useBuild(build) {
  for (const part of ['dist', 'dist-composer']) {
    execFileSync('rsync', ['-a', '--delete', `${build.dir}/${part}/`, `${part}/`])
  }
}

/** One fresh isolate on one path: seed, profile, and the run's record. */
function profilePath(build, path, round) {
  const env = {...process.env}
  delete env.FOCUS
  if (path.focus !== undefined) {
    env.FOCUS = path.focus
  }
  execFileSync('node', ['scripts/cpu-bench/seed-kv.mjs'], {env, stdio: 'ignore'})
  const run = `${label}${build.name ? `-${build.name}` : ''}-${path.name}-${round}`
  const output = execFileSync('node', ['scripts/cpu-bench/profile.mjs', run, String(WARM), '100'], {
    env: {...process.env, PLANE: 'none', EXPECT: path.expect, OUT},
    encoding: 'utf8'
  })
  const line = JSON.parse(output.trim().split('\n').filter((text) => text.startsWith('{')).pop())
  const cold = cpuOf(`${OUT}/${run}/cold-first.cpuprofile`)
  const warm = WARM > 0 ? cpuOf(`${OUT}/${run}/warm-${WARM}.cpuprofile`) : {active: 0, program: 0}
  const record = {
    build: build.name,
    path: path.name,
    round,
    loadavg: line.loadavg,
    coldActive: cold.active,
    coldProgram: cold.program,
    cold: cold.active + cold.program,
    warm: (warm.active + warm.program) / Math.max(1, WARM),
    coldWallMs: line.coldWallMs,
    bodySha256: line.bodySha256
  }
  console.error(
    `${run}: cold ${record.cold.toFixed(2)} ms (JS ${cold.active.toFixed(2)} + compile ${cold.program.toFixed(2)}), warm ${
      record.warm.toFixed(2)
    } ms/request, load ${line.loadavg.join(' ')}, body ${line.bodySha256.slice(0, 12)}`
  )
  return record
}

const builds = BUILDS.length > 0 ? BUILDS : [{name: '', dir: null}]
const runs = []
for (let round = 1; round <= ROUNDS; round++) {
  for (const build of builds) {
    if (build.dir !== null) {
      useBuild(build)
    }
    for (const path of PATHS) {
      runs.push(profilePath(build, path, round))
    }
  }
}
writeFileSync(`${OUT}/${label}-runs.json`, JSON.stringify(runs, null, 1))

const quantile = (values, p) => {
  const sorted = [...values].sort((a, b) => a - b)
  return sorted[Math.min(sorted.length - 1, Math.max(0, Math.ceil(p / 100 * sorted.length) - 1))]
}
const mean = (values) => values.reduce((a, b) => a + b, 0) / values.length
const f = (value) => value.toFixed(2)
console.log(`${label}: ${ROUNDS} fresh isolates per build and path, warm ${WARM} requests; ms of CPU (JS + V8 compile)`)
console.log(
  '| build | path | cold median | cold p90 | cold mean | cold min..max | of which compile (mean) | warm median | load (1 min) min..max | body sha256 |'
)
console.log('| --- | --- | --- | --- | --- | --- | --- | --- | --- | --- |')
for (const build of builds) {
  for (const path of PATHS) {
    const mine = runs.filter((run) => run.build === build.name && run.path === path.name)
    const cold = mine.map((run) => run.cold)
    const loads = mine.map((run) => run.loadavg[0])
    const bodies = [...new Set(mine.map((run) => run.bodySha256.slice(0, 12)))].join(' ')
    console.log(
      `| ${build.name || '-'} | ${path.name} | ${f(quantile(cold, 50))} | ${f(quantile(cold, 90))} | ${f(mean(cold))} | ${f(Math.min(...cold))}..${
        f(Math.max(...cold))
      } | ${f(mean(mine.map((run) => run.coldProgram)))} | ${f(quantile(mine.map((run) => run.warm), 50))} | ${f(Math.min(...loads))}..${
        f(Math.max(...loads))
      } | ${bodies} |`
    )
  }
}
console.log(`runs: ${OUT}/${label}-runs.json; phases: node scripts/cpu-bench/phases.mjs 1 ${OUT}/${label}-<build>-<path>-*/cold-first.cpuprofile`)
