// audits/lib/llms-issue-outcome.ts -- the tri-state managed-issue channel for the
// weekly B2 llms check (atlas decision 0119 D1). The Atlas spoke-evidence envelope
// this repo used to emit is retired; this fold survives it because it is
// managed-issue lifecycle, not hub evidence. The workflow reconciler consumes
// `steps.llms.outputs.issue_outcome`, never the step outcome: a report-only step's
// process outcome cannot distinguish "measured and failed" from "could not
// measure", and a missing output is deliberately indeterminate.

import {appendFile} from 'node:fs/promises'

export type LlmsCheckStatus = 'passed' | 'failed' | 'unknown'
export type ManagedIssueOutcome = 'success' | 'failure' | 'indeterminate'

/**
 * Fold definitive failures and observation gaps into the check's tri-state
 * status: any failure wins, otherwise any observation gap wins, otherwise passed.
 */
export function llmsCheckStatus(failureCount: number, unknownCount: number): LlmsCheckStatus {
  if (failureCount > 0) {
    return 'failed'
  }
  return unknownCount > 0 ? 'unknown' : 'passed'
}

/** Map check status to the existing managed-issue reconciler vocabulary. */
export function managedIssueOutcome(status: LlmsCheckStatus): ManagedIssueOutcome {
  if (status === 'passed') {
    return 'success'
  }
  if (status === 'failed') {
    return 'failure'
  }
  return 'indeterminate'
}

/** Append `issue_outcome=` to GITHUB_OUTPUT so the reconciler reads the measured tri-state. */
export async function writeIssueOutcome(outputPath: string | undefined, status: LlmsCheckStatus): Promise<void> {
  if (!outputPath) {
    return
  }
  await appendFile(outputPath, `issue_outcome=${managedIssueOutcome(status)}\n`, 'utf8')
}

/**
 * Append `measured=` to GITHUB_OUTPUT — the dead-man's-switch channel.
 *
 * SEPARATE FROM `issue_outcome` ON PURPOSE, because the two answer different questions.
 * `issue_outcome` asks "was the artifact healthy" and drives managed-issue lifecycle.
 * `measured` asks "did the transport work at all", and it is the only one the dead-man reads:
 * a lane that ran, reached nothing, and exited cleanly is byte-identical to a healthy one without
 * it (atlas decisions 0083, 0107, 0122).
 *
 * BOTH HALVES SHIP TOGETHER. Publishing this count without the `measured=0` rung in
 * `audits/healthchecks-ping.sh` changes nothing, and adding the rung without this count makes the
 * field empty — which the script treats as "not claimed", never as a pass.
 */
export async function writeMeasurement(outputPath: string | undefined, measured: number): Promise<void> {
  if (!outputPath) {
    return
  }
  await appendFile(outputPath, `measured=${measured}\n`, 'utf8')
}
