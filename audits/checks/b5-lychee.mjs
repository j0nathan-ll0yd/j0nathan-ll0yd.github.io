#!/usr/bin/env node
// audits/checks/b5-lychee.mjs -- B5. Judges the JSON report the lychee action writes
// for the live HTML, llms.txt and feed.xml link sets. lychee fetches; this runner owns
// the verdict, because lychee's own exit code cannot tell three different answers apart.
//
// THREE ANSWERS, NOT TWO. Every checked link lands in exactly one class:
//   - judged and green: lychee held an HTTP answer that it accepted;
//   - judged and failing: an HTTP error status, a DNS failure, a TLS failure or a timeout;
//   - UNMEASURED: the TCP connection was refused before any HTTP exchange.
//
// WHY A REFUSAL IS UNMEASURED. The self-hosted runners sit behind a default-deny egress
// floor (ci-runners-private firewall/colima/egress-isolation.sh). DOCKER-USER ends in
// `-p tcp -j REJECT --reject-with tcp-reset`, so every host outside the hostname allowlist
// and the CIDR lanes answers with a TCP reset. lychee reports that reset as "Connection
// refused". A down server that resets the port looks byte-identical from inside the
// runner, so a refusal proves nothing about the link. It is never a pass, because nothing
// was fetched, and never a site failure, because the runner cannot tell it from its own
// firewall. Weekly run 38428346533 is the receipt: 15 refusals over 6 hosts, all 200 from
// open egress, and every one of those hosts resolved to an address in no allow set.
//
// A DNS failure stays a FAILURE. The floor allows port 53, so NXDOMAIN is a real answer
// about the link. lychee words it "Connection failed", which this runner never reads as a
// refusal.
//
// MANAGED ISSUE. `issue_outcome` follows the reconciler's tri-state
// (audits/lib/file-check-issues.mjs): any failing link is `failure`; no failing link but
// at least one unmeasured link is `indeterminate`, which leaves the issue as it stands,
// because a partially measured bucket must never close it; only a wholly measured green
// run is `success`. `issue_note` names every unmeasured link, its reason and the counts,
// and the reconciler posts it on the open managed issue once per run.

import {appendFileSync, readFileSync} from 'node:fs'
import {isMain, report} from '../lib/http.mjs'

// A18 coverage declaration (atlas decision 0145). The links B5 follows are third-party
// pages, not registered estate surfaces. Metadata only -- the hub reads it statically.
export const ARTIFACTS = []

/** lychee 0.24 `status.details` for a TCP reset at connect time. Matched exactly, never by prefix. */
export const CONNECTION_REFUSED_DETAIL = 'Connection refused - server may be down or port blocked'

export const UNMEASURED_REASON = 'connection refused before any HTTP exchange. The runner egress floor ' +
  '(ci-runners-private firewall/colima/egress-isolation.sh, DOCKER-USER REJECT tcp-reset) answers every host ' +
  'outside its allowlists this way, so the runner cannot tell a firewall block from a down server'

export const EXCLUDED_REASON = 'declared in .lycheeignore (or a lychee built-in exclusion); never fetched'

/** Upper bound on the links listed in the managed-issue note. Counts are always complete. */
const NOTE_LINK_LIMIT = 60

/**
 * lychee's process exit codes that mean "the run completed": 0 with no link errors, 2 with
 * some. The action's entrypoint swallows every code under `fail: false`, so anything else
 * (1 for a configuration or runtime error, 101 for a panic) reaches only this check.
 */
export const COMPLETED_EXIT_CODES = new Set(['0', '2'])

/** Throws unless the fetcher completed. An absent code (a local run outside Actions) is accepted. */
export function assertCompletedRun(exitCode) {
  if (exitCode !== undefined && exitCode !== '' && !COMPLETED_EXIT_CODES.has(exitCode)) {
    throw new Error(`lychee exited ${exitCode}, not 0 or 2: the run did not complete, so its report cannot be judged`)
  }
}

/** True when lychee reported a refused TCP connection, the only answer this runner reads as unmeasured. */
export function isConnectionRefused(entry) {
  return entry?.status?.details === CONNECTION_REFUSED_DETAIL
}

function entries(map) {
  return Object.entries(map ?? {}).flatMap(([source, list]) => (list ?? []).map((entry) => ({source, ...entry})))
}

function count(value, name) {
  if (!Number.isInteger(value) || value < 0) {
    throw new TypeError(`lychee report field "${name}" must be a non-negative integer, got ${JSON.stringify(value)}`)
  }
  return value
}

/**
 * Pure classification of a lychee JSON report.
 *
 * Counts are per link OCCURRENCE, the unit lychee's own totals use. The report must be
 * internally consistent (every total equals its map, and the classes sum to `total`);
 * a report that is not throws, because a measurer that cannot account for every link
 * would publish a count it cannot stand behind.
 */
export function classifyLycheeReport(json) {
  const total = count(json?.total, 'total')
  const successful = count(json?.successful, 'successful')
  const errors = entries(json?.error_map)
  const timeouts = entries(json?.timeout_map)
  const excluded = count(json?.excludes, 'excludes')
  const unknown = count(json?.unknown ?? 0, 'unknown')
  const unsupported = count(json?.unsupported ?? 0, 'unsupported')

  if (errors.length !== count(json?.errors, 'errors') || timeouts.length !== count(json?.timeouts ?? 0, 'timeouts')) {
    throw new Error(
      `lychee report maps disagree with its totals: error_map ${errors.length} vs errors ${json.errors}, ` +
        `timeout_map ${timeouts.length} vs timeouts ${json.timeouts}`
    )
  }
  if (successful + errors.length + timeouts.length + excluded + unknown + unsupported !== total) {
    throw new Error(
      `lychee report does not account for every link: ${successful} successful + ${errors.length} errors + ` +
        `${timeouts.length} timeouts + ${excluded} excluded + ${unknown} unknown + ${unsupported} unsupported != ${total} total`
    )
  }

  const refused = errors.filter(isConnectionRefused)
  const failing = [...errors.filter((entry) => !isConnectionRefused(entry)), ...timeouts]
  return {
    total,
    passed: successful,
    failing,
    refused,
    excluded,
    excludedLinks: entries(json?.excluded_map),
    // lychee could not classify these (an unrecognised status, or a scheme it does not
    // check). They hold no verdict, so they are unmeasured too, under their own reason.
    otherUnmeasured: unknown + unsupported,
    measured: successful + failing.length
  }
}

/** Tri-state for the managed-issue reconciler. */
export function issueOutcome(result) {
  if (result.failing.length > 0) {
    return 'failure'
  }
  if (result.measured === 0 || result.refused.length > 0 || result.otherUnmeasured > 0) {
    return 'indeterminate'
  }
  return 'success'
}

function hosts(list) {
  return [...new Set(list.map((entry) => new URL(entry.url).hostname))].sort()
}

function unique(list) {
  return new Set(list.map((entry) => entry.url)).size
}

/** One-line tally used in the step log, the step summary and the issue note. */
export function tally(result) {
  const unmeasured = result.refused.length + result.otherUnmeasured
  return `${result.total} links: ${result.measured} measured (${result.passed} green, ${result.failing.length} failing), ` +
    `${unmeasured} unmeasured (${result.refused.length} connection-refused, ${result.otherUnmeasured} unknown/unsupported), ` +
    `${result.excluded} excluded`
}

/** Findings for the shared report helper. Only a failing link carries `fail`; an unmeasured link is never a pass and never a failure. */
export function findingsFor(result) {
  const findings = result.failing.map((entry) => ({
    severity: 'fail',
    id: 'link-broken',
    message: `${entry.url} (in ${entry.source}): ${entry.status?.text ?? 'no status'}`
  }))
  if (result.refused.length > 0) {
    findings.push({
      severity: 'warn',
      id: 'links-unmeasured-connection-refused',
      message: `${result.refused.length} link(s), ${unique(result.refused)} unique, over ${hosts(result.refused).length} host(s) ` +
        `(${hosts(result.refused).join(', ')}) are UNMEASURED: ${UNMEASURED_REASON}`
    })
  }
  if (result.otherUnmeasured > 0) {
    findings.push({severity: 'warn', id: 'links-unmeasured-unknown', message: `${result.otherUnmeasured} link(s) returned no status lychee could judge`})
  }
  if (result.excluded > 0) {
    findings.push({severity: 'info', id: 'links-excluded', message: `${result.excluded} link(s) excluded, ${EXCLUDED_REASON}`})
  }
  return findings
}

function linkLines(list) {
  const lines = list.slice(0, NOTE_LINK_LIMIT).map((entry) => `- \`${entry.url}\` (in \`${entry.source}\`)`)
  if (list.length > NOTE_LINK_LIMIT) {
    lines.push(`- ... and ${list.length - NOTE_LINK_LIMIT} more (see the run's step summary)`)
  }
  return lines
}

/**
 * Markdown for the managed issue and the step summary. Empty when nothing needs saying:
 * a wholly measured run with no exclusions has no blind spot to declare.
 */
export function issueNote(result) {
  if (result.refused.length === 0 && result.otherUnmeasured === 0 && result.failing.length === 0) {
    return ''
  }
  const lines = [`B5 link check: ${tally(result)}.`]
  if (result.failing.length > 0) {
    lines.push('', `**Failing (${result.failing.length}):**`, ...result.failing.slice(0, NOTE_LINK_LIMIT).map((entry) =>
      `- \`${entry.url}\` (in \`${entry.source}\`): ${entry.status?.text ?? 'no status'}`
    ))
  }
  if (result.refused.length > 0) {
    lines.push('',
      `**Unmeasured, connection refused (${result.refused.length} links, ${unique(result.refused)} unique, hosts: ` +
        `${hosts(result.refused).join(', ')}):** ${UNMEASURED_REASON}. These are neither passes nor site failures.`, ...linkLines(result.refused))
  }
  if (result.excluded > 0) {
    lines.push('', `**Excluded (${result.excluded}):** ${EXCLUDED_REASON}.`, ...linkLines(result.excludedLinks))
  }
  return lines.join('\n')
}

function summaryMarkdown(result) {
  const note = issueNote(result)
  return ['## B5 lychee link check', '', note || `B5 link check: ${tally(result)}.`, ''].join('\n')
}

/** Append `issue_outcome` and the multi-line `issue_note` to GITHUB_OUTPUT. A no-op outside Actions. */
export function writeIssueOutputs(result, deps = {}) {
  const append = deps.append ?? appendFileSync
  // Read the environment only when the caller did not speak, as publishMeasured does: a
  // destructuring default cannot tell an explicit `outputPath: undefined` from silence.
  const outputPath = Object.hasOwn(deps, 'outputPath') ? deps.outputPath : process.env.GITHUB_OUTPUT
  if (!outputPath) {
    return
  }
  const note = issueNote(result)
  const delimiter = `B5_NOTE_${Date.now()}_${Math.random().toString(36).slice(2)}`
  if (note.split('\n').includes(delimiter)) {
    throw new Error('issue note collides with its output delimiter')
  }
  append(outputPath, `issue_outcome=${issueOutcome(result)}\nissue_note<<${delimiter}\n${note}\n${delimiter}\n`, 'utf8')
}

function main() {
  assertCompletedRun(process.env.LYCHEE_EXIT_CODE)
  const reportPath = process.argv[2] ?? 'lychee/out.json'
  const result = classifyLycheeReport(JSON.parse(readFileSync(reportPath, 'utf8')))
  writeIssueOutputs(result)
  if (process.env.GITHUB_STEP_SUMMARY) {
    appendFileSync(process.env.GITHUB_STEP_SUMMARY, summaryMarkdown(result), 'utf8')
  }
  console.log(tally(result))
  for (const entry of result.refused) {
    console.log(`  [unmeasured] ${entry.url} (in ${entry.source})`)
  }
  process.exit(report('lychee', findingsFor(result), result.measured))
}

if (isMain(import.meta.url)) {
  main()
}
