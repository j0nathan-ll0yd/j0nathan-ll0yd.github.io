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

import { execFileSync } from 'node:child_process';

function gh(args) {
  return execFileSync('gh', args, { encoding: 'utf-8' });
}

function fileOrUpdateIssue({ id, title }, repo, runUrl) {
  const issueTitle = `[audit] ${title}`;
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
    '20',
  ]);
  const existing = JSON.parse(existingRaw);
  const dup = existing.find((i) => i.title === issueTitle);
  const body = [
    `Check \`${id}\` failed.`,
    '',
    `Run: ${runUrl}`,
    '',
    'This is a **report-only** finding (lp-audit Phase 2, D4) -- it does not block CI or deploys. '
    + "See the run's job log for this check's own findings output.",
  ].join('\n');

  if (dup) {
    gh(['issue', 'comment', String(dup.number), '--repo', repo, '--body', `Another run failed: ${runUrl}`]);
    console.log(`Updated existing issue #${dup.number} for check "${id}"`);
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
      'audit,audit:report-only',
    ]);
    console.log(`Filed new issue for check "${id}"`);
  }
}

function main() {
  const repo = process.env.GH_REPO;
  const runUrl = process.env.GH_RUN_URL;
  const checks = JSON.parse(process.env.CHECK_RESULTS_JSON || '[]');

  const failed = checks.filter((c) => c.outcome === 'failure');
  if (failed.length === 0) {
    console.log('No failing checks in this job -- nothing to file.');
    return;
  }
  if (!repo) {
    console.error('GH_REPO env var not set -- cannot file issues.');
    process.exit(1);
  }
  for (const check of failed) {
    fileOrUpdateIssue(check, repo, runUrl);
  }
}

main();
