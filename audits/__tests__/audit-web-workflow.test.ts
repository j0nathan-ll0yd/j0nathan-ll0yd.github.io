import {readFileSync} from 'node:fs'
import {resolve} from 'node:path'
import {describe, expect, it} from 'vitest'
import {checkSteps, measuredStepRecords, parseJobs} from './audit-web-steps.ts'

const workflowPath = resolve('.github/workflows/audit-web.yml')
const workflow = readFileSync(workflowPath, 'utf8')

// Comment lines stripped. The comments deliberately quote the commands and
// failure modes they warn against ("do not reintroduce apt-get", "used to shell
// out to xmllint"), so the banned-command assertions below must look at what the
// workflow EXECUTES, not at what it explains.
const executable = workflow.split('\n').filter((line) => !/^\s*#/.test(line)).join('\n')
const countOccurrences = (text: string, snippet: string) => text.split(snippet).length - 1

// The three managed-issue reconciler steps, concatenated. Assertions about what the
// RECONCILER may read belong here rather than against the whole file: since the
// measurement channel landed, the dead-man ping step reads `steps.<id>.outcome`
// deliberately, and a workflow-wide ban on that string would forbid the correct
// wiring of a different consumer. The two answer different questions -- the
// reconciler asks "was the artifact healthy", the dead-man asks "did the transport
// work at all" -- and only the first must never see a raw report-only outcome.
const reconcilerScript = parseJobs(workflow).flatMap((job) => job.steps).filter((s) => s.name === 'Reconcile managed audit issues').map((s) => s.body).join(
  '\n'
)

const reconcileCondition = `if: >-
          always() && (
            github.event_name == 'schedule' ||
            (github.event_name == 'workflow_dispatch' && (inputs.scheduled_by_external == true || inputs.validate_reconciler == true))
          )`

const pingCondition =
  "if: always() && (github.event_name == 'schedule' || (github.event_name == 'workflow_dispatch' && inputs.scheduled_by_external == true))"

describe('audit-web issue reconciliation wiring', () => {
  it('gives the workflow issue-write permission and reconciles all three scheduled buckets', () => {
    expect(workflow).toMatch(/permissions:\n(?:  .*\n)*  issues: write/m)
    expect(workflow.match(/name: Reconcile managed audit issues/g)).toHaveLength(3)
    expect(workflow.match(/uses: actions\/github-script@/g)?.length).toBeGreaterThanOrEqual(3)
    expect(workflow.match(/client: reconciler\.createGithubClient\(github\)/g)).toHaveLength(3)
    // Atlas decision 0092: reconcile scheduled and trusted external dispatches.
    // Decision 0091 keeps explicit reconciler validation independent of pings.
    expect(countOccurrences(workflow, reconcileCondition)).toBe(3)
    // Linear regex (no nested quantifier) — the earlier /(?:\s+.*\n)*/ form was a
    // catastrophic-backtracking ReDoS that hung the vitest run.
    expect(workflow).toMatch(/validate_reconciler:\n {8}description: [^\n]*\n {8}type: boolean\n {8}default: false/)
    expect(workflow).toMatch(/scheduled_by_external:\n {8}description: [^\n]*\n {8}type: boolean\n {8}default: false/)
    expect(executable).not.toMatch(/\bgh\s+(issue|label)\b/)
  })

  it('passes every check outcome, including successes needed for recovery', () => {
    expect(workflow).toContain("outcome: '${{ steps.smoke.outcome }}'")
    expect(workflow).toContain("outcome: '${{ steps.llms.outputs.issue_outcome }}'")
    expect(workflow).toContain("outcome: '${{ steps.security_txt.outcome }}'")
  })

  it('preserves the merged llms command failure for its managed issue bucket', () => {
    const llmsStep = executable.match(/      - name: B2 -- llms structure \+ origin\/site coherence\n[\s\S]*?(?=\n      - name: B2 -- Cloudflare)/)?.[0] ??
      ''
    expect(llmsStep).toContain('id: llms')
    expect(llmsStep).toContain('continue-on-error: true')
    expect(llmsStep).toContain('pnpm exec tsx audits/checks/b2-llms.mjs')
    expect(executable).not.toMatch(/b2-llms\.mjs[^\n]*(\|\| true|; true)/)
    expect(workflow).toContain("{id: 'llms', title: 'B2 llms structure + origin/site coherence', outcome: '${{ steps.llms.outputs.issue_outcome }}'}")
    // Scoped to the reconciler: a report-only step's process outcome cannot separate
    // "measured and failed" from "could not measure", so the ISSUE lifecycle must read
    // the tri-state output. The dead-man ping step reads `steps.llms.outcome` on
    // purpose, and that is a different consumer answering a different question.
    expect(reconcilerScript).not.toContain('steps.llms.outcome')
  })

  it('runs the merged llms check under suppression with no evidence envelope left behind (decision 0119 D1)', () => {
    const llmsStep = executable.match(/      - name: B2 -- llms structure \+ origin\/site coherence\n[\s\S]*?(?=\n      - name: B2 -- Cloudflare)/)?.[0] ??
      ''
    expect(llmsStep).not.toContain("if: steps.focus_mode.outputs.suppressed != 'true'")
    expect(workflow).not.toMatch(/steps\.llms\.outputs\.issue_outcome[^\n]*(\|\||success|failure)/)

    // The retired spoke-evidence relay: no --evidence-out flag, no B2_EVIDENCE_*
    // transport env, no envelope upload step. The tri-state issue_outcome output
    // is the surviving channel.
    expect(executable).not.toContain('--evidence-out artifacts/llms-assurance/spoke-b2.json')
    expect(workflow).not.toContain('B2_EVIDENCE_')
    expect(workflow).not.toContain('Upload B2 llms coherence evidence')
    expect(workflow).not.toContain('llms-assurance-b2-spoke-evidence')
  })

  it('wires a fail-closed read-only Cloudflare rule audit with existing secret names', () => {
    const auditStep =
      executable.match(/      - name: B2 -- Cloudflare llms cache rules \(read-only\)\n[\s\S]*?(?=\n      - name: Upload Cloudflare)/)?.[0] ?? ''
    expect(auditStep).toContain('id: llms_cache_rules')
    expect(auditStep).toContain('continue-on-error: true')
    expect(auditStep).toContain('CLOUDFLARE_API_TOKEN: ${{ secrets.CLOUDFLARE_API_TOKEN }}')
    expect(auditStep).toContain('CLOUDFLARE_ACCOUNT_ID: ${{ secrets.CLOUDFLARE_ACCOUNT_ID }}')
    expect(auditStep).toContain('CLOUDFLARE_ZONE_ID: ${{ secrets.CLOUDFLARE_ZONE_ID }}')
    expect(auditStep).toContain('node audits/checks/b2-check-cloudflare-llms-cache-rules.mjs')
    expect(auditStep).toContain('--evidence-out artifacts/llms-assurance/cloudflare-cache-rules.json')

    const uploadStep = executable.match(/      - name: Upload Cloudflare llms cache-rule evidence\n[\s\S]*?(?=\n      - name: B2 -- sitemap)/)?.[0] ?? ''
    expect(uploadStep).toContain('if: always()')
    expect(uploadStep).toContain('path: artifacts/llms-assurance/cloudflare-cache-rules.json')
    expect(workflow).toContain(
      "{id: 'llms-cache-rules', title: 'B2 Cloudflare llms cache-rule audit', outcome: '${{ steps.llms_cache_rules.outputs.issue_outcome }}'}"
    )
    expect(reconcilerScript).not.toContain('steps.llms_cache_rules.outcome')
  })

  it('conditions gated checks on the shared focus probe without touching honest static checks', () => {
    expect(workflow).toContain('run: node audits/probe-suppression.mjs --github-output')
    // Two workflow-level skips remain (feeds, lychee); the merged llms check
    // self-probes instead of skipping at the workflow level (decision 0119 D2).
    expect(workflow.match(/if: steps\.focus_mode\.outputs\.suppressed != 'true'/g)).toHaveLength(2)
    expect(workflow).toContain('Lighthouse result is focus-mode-conditioned')
    expect(workflow).toContain('pa11y / result is focus-mode-conditioned')
    expect(workflow).toContain("{id: 'llms', title: 'B2 llms structure + origin/site coherence', outcome: '${{ steps.focus_mode.outcome }}'}")
    expect(workflow).toContain("{id: 'feeds', title: 'B2 feed.xml/feed.json validator', outcome: '${{ steps.focus_mode.outcome }}'}")
    expect(workflow).toContain("{id: 'lychee', title: 'B5 lychee link check', outcome: '${{ steps.focus_mode.outcome }}'}")
    expect(workflow).not.toMatch(/id: sitemap[\s\S]{0,120}focus_mode/)
  })
})

describe('audit-web runner isolation', () => {
  // These jobs run on self-hosted arm64 runners behind a default-deny egress
  // allowlist that excludes ports.ubuntu.com and deb.nodesource.com. A per-run
  // package install exits 100 there and kills the whole report-only job before
  // any check runs -- runs 31999694781, 32600311656 and 32695529989 all died
  // this way, leaving B2 live-artifact validation dark from 2026-08-10.
  it('installs no system packages at run time', () => {
    expect(executable).not.toMatch(/apt-get|apt install|yum |apk add|brew install/)
  })

  it('keeps every job on self-hosted runners', () => {
    const runners = executable.match(/runs-on: .*/g) || []
    expect(runners).toHaveLength(3)
    for (const runner of runners) {
      expect(runner).toContain('self-hosted')
      expect(runner).not.toContain('ubuntu-latest')
    }
  })

  it('validates the sitemap in-process rather than shelling out to xmllint', () => {
    expect(executable).not.toContain('xmllint')
    expect(executable).toContain('run: node audits/checks/b2-validate-sitemap.mjs')
  })
})

describe('audit-web tier gating', () => {
  // The external scheduler is the only clock (atlas decisions 0092/0093) and
  // this workflow has no `schedule:` trigger, so a `github.event.schedule`
  // comparison can never be true -- dead code whose only possible effect is to
  // silently disable a job if a trigger shape ever changes. Ruling R9a (atlas
  // decision 0116) deleted the three dead arms; this pins the deletion.
  it('gates each tier on the dispatch input alone, with no dead cron-equality arms', () => {
    expect(workflow).not.toContain('github.event.schedule')
    expect(workflow).toContain("if: github.event_name == 'workflow_dispatch' && (inputs.tier == 'daily' || inputs.tier == 'all')")
    expect(workflow).toContain("if: github.event_name == 'workflow_dispatch' && (inputs.tier == 'weekly' || inputs.tier == 'all')")
    expect(workflow).toContain("if: github.event_name == 'workflow_dispatch' && (inputs.tier == 'monthly' || inputs.tier == 'all')")
  })
})

describe('audit-web dead-man switch', () => {
  // The switch answers "did the lane run to measurement". A crashed job used to
  // ping plain success while every bucket reported "skipped", so neither the
  // reconciler nor Healthchecks.io raised anything.
  const pings = executable.match(/- name: Healthchecks\.io ping[\s\S]*?run: bash audits\/healthchecks-ping\.sh/g) || []

  it('routes all three pings through the shared script with the job status', () => {
    expect(pings).toHaveLength(3)
    for (const ping of pings) {
      // Atlas decision 0092: only schedules and trusted external dispatches ping.
      // Reconciler-validation and ordinary human dispatches do not.
      expect(ping).toContain(pingCondition)
      expect(ping).toContain('JOB_STATUS: ${{ job.status }}')
    }
  })

  // Ruling R9a (atlas decision 0116): all three tiers used to ping the SAME
  // tile, so a dead weekly or monthly dispatch refreshed nothing distinct and
  // the daily ping masked it. One tile per tier makes that undeclarable, and
  // HC_SECRET_NAME makes an unarmed tier's skip message name the right secret.
  it('pings one distinct tile per tier, so a dead weekly or monthly lane cannot hide behind the daily ping', () => {
    const [daily, weekly, monthly] = pings
    expect(daily).toContain('HC_URL: ${{ secrets.HC_PING_AUDIT_WEB }}')
    expect(daily).toContain('HC_SECRET_NAME: HC_PING_AUDIT_WEB\n')
    expect(weekly).toContain('HC_URL: ${{ secrets.HC_PING_AUDIT_WEB_WEEKLY }}')
    expect(weekly).toContain('HC_SECRET_NAME: HC_PING_AUDIT_WEB_WEEKLY')
    expect(monthly).toContain('HC_URL: ${{ secrets.HC_PING_AUDIT_WEB_MONTHLY }}')
    expect(monthly).toContain('HC_SECRET_NAME: HC_PING_AUDIT_WEB_MONTHLY')
    // Exactly one ping per secret: the masking defect was one secret used three times.
    expect(countOccurrences(workflow, 'HC_URL: ${{ secrets.HC_PING_AUDIT_WEB }}')).toBe(1)
    expect(countOccurrences(workflow, 'HC_URL: ${{ secrets.HC_PING_AUDIT_WEB_WEEKLY }}')).toBe(1)
    expect(countOccurrences(workflow, 'HC_URL: ${{ secrets.HC_PING_AUDIT_WEB_MONTHLY }}')).toBe(1)
  })

  it('no longer curls the ping URL inline, which could not distinguish a wedged lane', () => {
    expect(executable).not.toMatch(/curl .*\$HC_URL/)
  })
})

// THE MEASUREMENT CHANNEL, tier by tier (atlas decision 0122). PR #290 gave the weekly
// `llms` step a `measured` channel; one step of fourteen had it, and a tile is per
// TIER. These assertions are the static half of "any step that claims zero wedges the
// tier": the shell rung can only act on records the workflow actually forwards, so an
// unforwarded step is silently outside the rule.
describe('audit-web measurement channel', () => {
  const tiers = parseJobs(workflow).filter((job) => ['daily', 'weekly', 'monthly'].includes(job.key))

  it('finds all three tiers, so the per-tier assertions below cover the whole workflow', () => {
    expect(tiers.map((t) => t.key)).toEqual(['daily', 'weekly', 'monthly'])
  })

  it.each(tiers)('$key forwards one record per check step, in declaration order', (tier) => {
    // ORDER as well as membership: a record list that drifts out of step order is the
    // shape in which a copy-paste binds one step's id to another step's outcome.
    expect(measuredStepRecords(tier).map((r) => r.step)).toEqual(checkSteps(tier).map((s) => s.id))
  })

  it.each(tiers)('$key binds every record to its OWN step outcome and count', (tier) => {
    for (const record of measuredStepRecords(tier)) {
      expect(record.outcome).toBe(`\${{ steps.${record.step}.outcome }}`)
      // `.outcome`, never `.conclusion`: with `continue-on-error: true`, conclusion is
      // always `success` and would carry no information about the check.
      expect(record.outcome).not.toContain('.conclusion')
      // UNCONDITIONAL, and that is the whole assertion. This rung used to run only
      // `if (record.measured.startsWith('${{'))`, which read a falsified record as an
      // opt-out: replace a step's interpolation with a positive integer literal
      // (`analytics|${{ ... }}|1`) and the step's real count is never read, the constant
      // can never be `0`, and the step goes permanently dark while the tier pings green.
      // Measured: mutants `analytics|failure|1` and `headers|failure|7` both survived the
      // full suite, and driving the real ping script with the first printed "every step
      // that claims a count measured something".
      //
      // Atlas A19 does catch it (`step-measurement-misbound`), but A19 is a report-only hub
      // check on a daily cadence in another repo, and merging here IS a production deploy.
      // The gate has to be the one that blocks the PR carrying the mutant.
      expect([`\${{ steps.${record.step}.outputs.measured }}`, 'n/a', 'deferred']).toContain(record.measured)
    }
  })

  it.each(tiers)('$key never lets a setup step claim a measurement', (tier) => {
    // `chrome` resolves a binary path and `focus_mode` probes suppression for the
    // checks that consume it. Neither judges an artifact, so neither may assert the
    // tier measured something.
    const claimed = measuredStepRecords(tier).map((r) => r.step)
    expect(claimed).not.toContain('chrome')
    expect(claimed).not.toContain('focus_mode')
  })

  it.each(tiers)('$key gives every non-numeric declaration a stated reason', (tier) => {
    // Atlas decision 0107's not-applicable versus indeterminate split, mirrored from
    // atlas A19's `lane-unmeasured-scope-unreasoned` rung: a declaration without a
    // reason exempts a step forever and silently, which is the hole the declaration
    // exists to close. The shell wedges on it; this reds before it ever runs.
    for (const record of measuredStepRecords(tier).filter((r) => ['n/a', 'deferred'].includes(r.measured))) {
      expect({step: record.step, reason: record.reason.length > 0}).toEqual({step: record.step, reason: true})
    }
  })

  it('declares exactly the four tool runs as not-applicable, and one step as deferred', () => {
    const all = tiers.flatMap((tier) => measuredStepRecords(tier))
    // The four are third-party tool runs whose verdict IS their own exit code; they
    // hold no artifact set to count, so a number under this field would mean something
    // different from what it means everywhere else (atlas decision 0122 D1).
    expect(all.filter((r) => r.measured === 'n/a').map((r) => r.step).sort()).toEqual(['lhci', 'lychee', 'pa11y', 'smoke'])
    // `llms_cache_rules` COULD claim; it is blocked on atlas 0120 D2's owner action.
    // `deferred` rather than `n/a` keeps that distinction readable.
    expect(all.filter((r) => r.measured === 'deferred').map((r) => r.step)).toEqual(['llms_cache_rules'])
    expect(all.find((r) => r.step === 'llms_cache_rules')?.reason).toContain('0120 D2')
  })

  it.each(tiers)('$key dates every deferral and leaves every not-applicable undated', (tier) => {
    // A DEFERRAL IS TEMPORAL AND A NOT-APPLICABLE IS STRUCTURAL. Without a deadline the
    // two behave identically and a disclosed gap becomes an indefinite one: the
    // `llms_cache_rules` deferral produced a green job, no issue and no wedge on run
    // 34164468115 while all five Cloudflare reads returned 403 -- the same shape as run
    // 34086625518, the receipt decision 0122 opened with. `audits/healthchecks-ping.sh`
    // wedges past the date; this reds before the lane ever runs.
    for (const record of measuredStepRecords(tier)) {
      if (record.measured === 'deferred') {
        expect({step: record.step, deadline: record.deadline}).toEqual({step: record.step, deadline: expect.stringMatching(/^\d{4}-\d{2}-\d{2}$/)})
      } else {
        // Nowhere else, so `until=` cannot drift into a field that grants nothing.
        expect({step: record.step, deadline: record.deadline}).toEqual({step: record.step, deadline: ''})
      }
    }
  })

  it('carries no scalar MEASURED left over from the single-step channel', () => {
    // One channel, one shape. A stale `MEASURED:` would be read by nothing and would
    // look wired -- exactly the dead-wiring class this change removes from the weekly
    // job's `outputs:` block.
    expect(workflow).not.toMatch(/^ +MEASURED: /m)
    expect(workflow).not.toMatch(/^ {4}outputs:$/m)
  })

  it('routes every tier ping through the shared script that acts on the records', () => {
    // BOTH HALVES SHIP TOGETHER. Records without the rung change nothing, and the rung
    // without records leaves every field empty, which is "not claimed", never a pass.
    for (const tier of tiers) {
      const ping = tier.steps.find((s) => s.name === 'Healthchecks.io ping')
      expect(ping?.body).toContain('MEASURED_STEPS: |')
      expect(ping?.body).toContain('run: bash audits/healthchecks-ping.sh')
    }
  })
})
