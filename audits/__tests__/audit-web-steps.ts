// One parser for audit-web.yml's step structure, shared by the workflow-wiring suite
// and the measurement-channel census.
//
// WHY SHARED. Both suites reason about "the set of CHECK steps in a tier". Two parsers
// can disagree, and the way they disagree is that one of them stops seeing a step --
// which is the silent-shrinking-population defect the measurement channel exists to
// end. One parser means they cannot.
//
// Regex rather than a YAML parse because this repo has no `yaml` dependency and adding
// one to read a file the sibling suite already regexes would be a new supply-chain
// edge for no new signal.

import {chmodSync, readFileSync, writeFileSync} from 'node:fs'
import {join, resolve} from 'node:path'

export const WORKFLOW_PATH = resolve('.github/workflows/audit-web.yml')
export const WORKFLOW = readFileSync(WORKFLOW_PATH, 'utf8')

export interface WorkflowStep {
  /** The step's `name:` value. */
  name: string
  /** The step's `id:` value, or null when it declares none. */
  id: string | null
  /** Raw YAML for the step, comments included. */
  body: string
  /** True when the step carries `continue-on-error: true`. */
  reportOnly: boolean
  /** Audit runner paths the step invokes, repo-relative. */
  runners: string[]
}

export interface WorkflowJob {
  /** The job key (`daily`, `weekly`, `monthly`). */
  key: string
  body: string
  steps: WorkflowStep[]
}

/** Jobs in declaration order, each with its steps. */
export function parseJobs(workflow = WORKFLOW): WorkflowJob[] {
  const jobs: WorkflowJob[] = []
  const headers = [...workflow.matchAll(/^ {2}([A-Za-z0-9_-]+):$/gm)]
  for (const [index, header] of headers.entries()) {
    const start = header.index
    const end = index + 1 < headers.length ? headers[index + 1].index : workflow.length
    const body = workflow.slice(start, end)
    jobs.push({key: header[1], body, steps: parseSteps(body)})
  }
  return jobs
}

/** Steps within one job body, in declaration order. */
export function parseSteps(jobBody: string): WorkflowStep[] {
  const steps: WorkflowStep[] = []
  const headers = [...jobBody.matchAll(/^ {6}- name: (.+)$/gm)]
  for (const [index, header] of headers.entries()) {
    const start = header.index
    const end = index + 1 < headers.length ? headers[index + 1].index : jobBody.length
    const body = jobBody.slice(start, end)
    // Comment lines are stripped before reading the invocation, so a comment that
    // NAMES a runner ("do not reintroduce ...") is never mistaken for one.
    const executable = body.split('\n').filter((line) => !/^\s*#/.test(line)).join('\n')
    steps.push({
      name: header[1].trim(),
      id: /^ {8}id: (\S+)$/m.exec(body)?.[1] ?? null,
      body,
      reportOnly: /^ {8}continue-on-error: true$/m.test(body),
      runners: [...new Set([...executable.matchAll(/(audits\/checks\/[A-Za-z0-9._-]+\.mjs)/g)].map((m) => m[1]))]
    })
  }
  return steps
}

/**
 * The CHECK steps of a job: those that carry an `id` AND run report-only.
 *
 * `continue-on-error: true` is the discriminator that matters. It is exactly what
 * makes a step's failure invisible to `job.status`, so it is exactly the set that
 * needs a measurement channel. Setup steps (`chrome`, `focus_mode`) and the
 * artifact-upload steps are not checks and must never claim -- `focus_mode` carries
 * `continue-on-error` but no runner, and is excluded by name below because it is a
 * probe the checks consume rather than a check with a verdict of its own.
 */
export const NON_CHECK_STEP_IDS = new Set(['chrome', 'focus_mode'])

export function checkSteps(job: WorkflowJob): WorkflowStep[] {
  return job.steps.filter((s) => s.id !== null && s.reportOnly && !NON_CHECK_STEP_IDS.has(s.id))
}

export interface MeasuredStepRecord {
  step: string
  outcome: string
  measured: string
  /** The trailing fields minus the `until=` marker, rejoined in order. */
  reason: string
  /** The `until=YYYY-MM-DD` value, or `''` when the record carries no marker. */
  deadline: string
}

/**
 * The `MEASURED_STEPS` records forwarded by a job's Healthchecks.io ping step.
 *
 * Splits the trailing fields exactly as `audits/healthchecks-ping.sh` does: `until=YYYY-MM-DD` is
 * lifted out wherever it sits, and everything else is the prose reason. Position-independent
 * because the reason is prose and may contain `|`, so "the last field is the date" would be a
 * guess -- and backward compatible, because a record with no marker parses as it always did.
 */
export function measuredStepRecords(job: WorkflowJob): MeasuredStepRecord[] {
  const block = measuredStepsBlock(job)
  if (!block) {
    return []
  }
  return block.split('\n').map((line) => line.trim()).filter(Boolean).map((line) => {
    const [step, outcome, measured, ...rest] = line.split('|')
    const marker = rest.find((field) => field.startsWith('until='))
    return {
      step,
      outcome,
      measured: measured ?? '',
      reason: rest.filter((field) => field !== marker).join('|'),
      deadline: marker ? marker.slice('until='.length) : ''
    }
  })
}

/**
 * The raw `MEASURED_STEPS` block of a job's Healthchecks.io ping step, one record per line with
 * the YAML indentation removed and the `${{ }}` expressions left as written. `''` when absent.
 * The ONE reader of that block: the record parser above and the tests that render it both use it.
 */
export function measuredStepsBlock(job: WorkflowJob): string {
  const ping = job.steps.find((s) => s.name === 'Healthchecks.io ping')
  const block = ping ? /^ {10}MEASURED_STEPS: \|\n((?: {12}.+\n)+)/m.exec(ping.body)?.[1] : undefined
  return block ? block.replace(/^ {12}/gm, '') : ''
}

export interface ReconcilerBinding {
  /** The env var name the reconciler script reads as `process.env.<name>`. */
  name: string
  /** The step whose result it binds. */
  step: string
  /** What it binds: `outcome`, or `outputs.<key>`. */
  field: string
}

/**
 * The `env:` bindings of a reconciler step, `NAME: ${{ steps.<id>.<field> }}`, in order. The ONE
 * parser of that shape: the wiring census and the B6 tier tests both read bindings through it.
 */
export function reconcilerBindings(step: WorkflowStep): ReconcilerBinding[] {
  return [...step.body.matchAll(/^ {10}([A-Z0-9_]+): \$\{\{ steps\.([a-z0-9_]+)\.(outcome|outputs\.[a-z_]+) \}\}$/gm)].map((m) => ({
    name: m[1],
    step: m[2],
    field: m[3]
  }))
}

/**
 * Install a fake `curl` in `dir` that appends the last argument it was handed (the URL) to `log`
 * and exits `exitCode`. Put `dir` first on PATH to drive the real `audits/healthchecks-ping.sh`
 * without touching the network.
 */
export function installCurlStub(dir: string, log: string, exitCode = 0): void {
  const shim = join(dir, 'curl')
  writeFileSync(shim, `#!/usr/bin/env bash\nfor arg in "$@"; do :; done\necho "$arg" >> ${JSON.stringify(log)}\nexit ${exitCode}\n`)
  chmodSync(shim, 0o755)
}
