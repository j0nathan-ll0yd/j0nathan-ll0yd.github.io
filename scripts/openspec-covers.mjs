#!/usr/bin/env node
// The openspec-covers gate. The rule itself is NOT in this repo: it arrives as
// `@j0nathan-ll0yd/estate-contracts/openspec-covers`, exact-pinned in package.json and resolved
// from the lockfile (atlas decisions 0079 item 4 wave 2b, 0080).
//
// It used to be a 992-line verbatim copy at scripts/vendor/openspec-covers.mjs, pinned by a
// sha256 sidecar vendored beside it. That copy is gone, and with it the whole
// transcription-defect class: there is no local file left to hand-edit, so "edit the rule, edit
// the sidecar" is not a move anyone in this repo can make.
//
// THE PIN INVERTS, AND THAT IS DELIBERATE. The old check hashed the local copy against a local
// sidecar and refused to trust either alone. That reasoning does not survive the migration: the
// sidecar now ships inside a lockfile-pinned tarball this repo cannot write to, so reading it is
// the DOCUMENTED consumption path (package README, "Locating a `.sha256` sidecar"). Sidecars ship
// but are deliberately not `exports` subpaths -- `.sha256` classifies INDETERMINATE under the
// export-surface rule and would poison that package's own surface verdict -- so they are located
// relative to the tier's reference module URL.
//
// What still fails loudly here: a corrupted or partial install (bytes vs sidecar), a sidecar
// rewritten to a bare hash (format), and a contract release that moved the RULE under this repo
// without the repo moving with it (EXPECTED_SPEC_VERSION).

import {readFileSync} from 'node:fs'
import {dirname, resolve} from 'node:path'
import {fileURLToPath} from 'node:url'
import {createHash} from 'node:crypto'
import {checkCoversDetailed, COVERS_SPEC_VERSION} from '@j0nathan-ll0yd/estate-contracts/openspec-covers'

const __filename = fileURLToPath(import.meta.url)
const __dirname = dirname(__filename)
const REPO_ROOT = resolve(__dirname, '..')

/**
 * The covers spec version this repo's openspec/ tree was written against.
 *
 * v4 added `requirement-without-scenario`: every `### Requirement:` must carry at least one
 * `#### Scenario:`. Moving this number means the rule changed under us -- read the tier README,
 * bring openspec/ into line with the new rule, and move the constant in the same change.
 */
const EXPECTED_SPEC_VERSION = 4

/** The tier's reference module URL. Sidecars sit beside it; the layout is flat and stable. */
const REFERENCE_URL = new URL(import.meta.resolve('@j0nathan-ll0yd/estate-contracts/openspec-covers'))

export function checkCoversIntegrity() {
  const referenceBytes = readFileSync(REFERENCE_URL)

  // `<sha256>  <filename>` -- TWO whitespace-separated fields, not a bare hash. An
  // `awk '{print $1}'` one-liner rewrote one of these to a bare hash once and silently broke the
  // format for every consumer, so the FORMAT is asserted, not merely parsed past.
  const fields = readFileSync(new URL('reference.mjs.sha256', REFERENCE_URL), 'utf8').trim().split(/\s+/)
  if (fields.length !== 2 || fields[1] !== 'reference.mjs') {
    throw new Error(`openspec-covers sidecar is not the two-field <sha256>  reference.mjs format: got ${JSON.stringify(fields)}`)
  }

  const actualSha = createHash('sha256').update(referenceBytes).digest('hex')
  if (actualSha !== fields[0]) {
    throw new Error(
      `openspec-covers sha256 mismatch! The shipped rule disagrees with the sidecar shipped beside it. ` +
        `Expected ${fields[0]}, got ${actualSha}. Reinstall: pnpm install --frozen-lockfile`
    )
  }

  if (COVERS_SPEC_VERSION !== EXPECTED_SPEC_VERSION) {
    throw new Error(
      `openspec-covers spec version ${COVERS_SPEC_VERSION} is not the ${EXPECTED_SPEC_VERSION} this repo was written against. ` +
        'A rule change landed in @j0nathan-ll0yd/estate-contracts; reconcile openspec/ and move EXPECTED_SPEC_VERSION together.'
    )
  }

  return true
}

function main() {
  const isBlocking = process.argv.includes('--blocking')
  const isJson = process.argv.includes('--json')

  checkCoversIntegrity()

  const result = checkCoversDetailed({cwd: REPO_ROOT})

  if (isJson) {
    console.log(JSON.stringify({specVersion: COVERS_SPEC_VERSION, ...result}, null, 2))
  } else {
    console.log(
      `openspec-covers (spec version ${COVERS_SPEC_VERSION}): ${result.specsScanned} spec file(s), ` +
        `${result.requirementsFound} requirement(s), ${result.testFilesScanned} test file(s), ` +
        `${result.coversAnnotationsFound} covers: annotation(s)`
    )

    if (result.findings.length === 0) {
      console.log('OK: every requirement has a covering test and every covers: annotation resolves.')
    } else {
      console.log('')
      for (const finding of result.findings) {
        console.log(`[${finding.type}] ${finding.file}:${finding.line} — ${finding.message}`)
      }
      console.log('')
      console.log(isBlocking
        ? `FAIL: ${result.findings.length} covers-conformance finding(s).`
        : `${result.findings.length} covers-conformance finding(s) (report-only; pass --blocking to gate).`)
    }
  }

  if (isBlocking && result.findings.length > 0) {
    process.exit(1)
  }
}

if (process.argv[1] && fileURLToPath(import.meta.url) === resolve(process.argv[1])) {
  main()
}
