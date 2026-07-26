#!/usr/bin/env node
// scripts/audit/lib/file-check-issues.mjs -- D5: one GitHub issue per failing
// check id, updated (a comment appended) rather than duplicated on repeat
// failures. Invoked once per job from .github/workflows/audit-web.yml with a
// JSON array of `{ id, title, outcome }` built from that job's step outcomes.
// Shells out to `gh` (preinstalled + auto-authenticated via GH_TOKEN on
// GitHub-hosted runners) rather than adding an Octokit dependency.
//
// Deliberately NOT driven by the GitHub Actions `failure()` job-status
// function: every check step in audit-web.yml runs `continue-on-error: true`
// so one failing check doesn't skip the checks after it or the Healthchecks
// ping, which means the job's aggregate status stays 'success' and
// `failure()` never fires. This script reads each step's own `outcome`
// instead, which continue-on-error does NOT mask (verified against
// tests/smoke -- .github/workflows/smoke-check.yml's existing
// `steps.smoke.outcome == 'failure'` pattern for the same reason).
//
// Report-only phase (D4): labels only (`audit`, `audit:report-only`); this
// script and its caller have no blocking behavior.

import {execFileSync} from 'node:child_process'

// The labels every audit issue is tagged with. Kept in sync with the repo via
// ensureLabel() below so a missing label can never red the audit job (the
// original failure mode: `gh issue create --label audit` exited 1 with
// "'audit' not found", and the filing step -- unlike the check steps -- had no
// continue-on-error, so the whole job went red). Defense in depth over the
// one-time `gh label create` bootstrap; enforced at the highest tier (estate
// rule B10) rather than by hand-created labels alone.
const AUDIT_LABELS = [
  {name: 'audit', color: 'ededed', description: 'lp-audit finding'},
  {name: 'audit:report-only', color: 'ededed', description: 'report-only (non-blocking) audit finding'}
]

function gh(args) {
  return execFileSync('gh', args, {encoding: 'utf-8'})
}

/**
 * Idempotently create/update a label. `--force` makes `gh label create` a
 * no-op-or-update when the label already exists, so this is safe to run every
 * time. Failures are logged and swallowed: label provisioning is best-effort
 * infrastructure and must never fail the audit job it supports.
 */
function ensureLabel({name, color, description}, repo) {
  try {
    gh(['label', 'create', name, '--repo', repo, '--color', color, '--description', description, '--force'])
  } catch (err) {
    console.warn(`Warning: could not ensure label "${name}": ${err.message}`)
  }
}

function fileOrUpdateIssue({id, title}, repo, runUrl) {
  const issueTitle = `[audit] ${title}`
  const existingRaw = gh([
    'issue',
    'list',
    '--repo',
    repo,
    '--state',
    'open',
    '--label',
    'audit',
    '--search',
    `"${issueTitle}" in:title`,
    '--json',
    'number,title',
    '--limit',
    '20'
  ])
  const existing = JSON.parse(existingRaw)
  const dup = existing.find((i) => i.title === issueTitle)
  const body = [
    `Check \`${id}\` failed.`,
    '',
    `Run: ${runUrl}`,
    '',
    'This is a **report-only** finding (lp-audit Phase 2, D4) -- it does not block CI or deploys. ' +
    "See the run's job log for this check's own findings output."
  ].join('\n')

  if (dup) {
    gh(['issue', 'comment', String(dup.number), '--repo', repo, '--body', `Another run failed: ${runUrl}`])
    console.log(`Updated existing issue #${dup.number} for check "${id}"`)
  } else {
    gh([
      'issue',
      'create',
      '--repo',
      repo,
      '--title',
      issueTitle,
      '--body',
      body,
      '--label',
      'audit,audit:report-only'
    ])
    console.log(`Filed new issue for check "${id}"`)
  }
}

function main() {
  const repo = process.env.GH_REPO
  const runUrl = process.env.GH_RUN_URL
  const checks = JSON.parse(process.env.CHECK_RESULTS_JSON || '[]')

  const failed = checks.filter((c) => c.outcome === 'failure')
  if (failed.length === 0) {
    console.log('No failing checks in this job -- nothing to file.')
    return
  }
  if (!repo) {
    // Report-only infrastructure must never red the audit job it reports on
    // (estate rule: the filer supports the audit, it does not gate it). Log
    // loudly and exit clean rather than exit(1).
    console.error('GH_REPO env var not set -- cannot file issues; skipping.')
    return
  }

  // Provision labels before any create/list so a missing label can't red the
  // job. Idempotent and best-effort (see ensureLabel).
  for (const label of AUDIT_LABELS) {
    ensureLabel(label, repo)
  }

  for (const check of failed) {
    // A `gh` hiccup while filing one issue must not abort the loop or fail the
    // job -- log it and move on. dedupe-by-title behavior is preserved inside
    // fileOrUpdateIssue; this only guards its I/O.
    try {
      fileOrUpdateIssue(check, repo, runUrl)
    } catch (err) {
      console.error(`Warning: could not file/update issue for check "${check.id}": ${err.message}`)
    }
  }
}

main()
