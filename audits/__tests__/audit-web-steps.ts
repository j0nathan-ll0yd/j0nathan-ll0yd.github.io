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

import {readFileSync} from 'node:fs'
import {resolve} from 'node:path'

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

/** The `MEASURED_STEPS` records forwarded by a job's Healthchecks.io ping step. */
export function measuredStepRecords(job: WorkflowJob): {step: string; outcome: string; measured: string; reason: string}[] {
  const ping = job.steps.find((s) => s.name === 'Healthchecks.io ping')
  const block = ping ? /^ {10}MEASURED_STEPS: \|\n((?: {12}.+\n)+)/m.exec(ping.body)?.[1] : undefined
  if (!block) {
    return []
  }
  return block.split('\n').map((line) => line.trim()).filter(Boolean).map((line) => {
    const [step, outcome, measured, ...rest] = line.split('|')
    return {step, outcome, measured: measured ?? '', reason: rest.join('|')}
  })
}
