// Integrity of the llms-structure contract this repo CONSUMES, not of a copy it keeps.
//
// Until atlas decision 0079 item 4 wave 2b the reference was vendored at
// scripts/audit/lib/llms-structure.mjs with its `.sha256` sidecar, and this file pinned the digest
// as a literal so a hand-edit to the copy would red. The copy is gone: the reference now arrives as
// `@j0nathan-ll0yd/estate-contracts/llms-structure`, exact-pinned in package.json and resolved from
// the lockfile, so there is no local file left to hand-edit.
//
// THE PIN INVERTS. The old test refused to trust the vendored sidecar, because that sidecar was
// vendored too and a coordinated local edit would move both. The bytes now ship inside a
// lockfile-pinned tarball this repo cannot write to, so reading the shipped sidecar is the
// documented consumption path (package README, "Locating a `.sha256` sidecar") rather than a hole.
// Sidecars ship but are deliberately NOT `exports` subpaths -- `.sha256` classifies INDETERMINATE
// under the export-surface rule -- so they are located relative to the tier's reference module URL.
//
// The Stryker `isInstrumented` waiver this file used to carry is gone with the vendored copy.
// It existed because the mutation run rewrote the very bytes being digested; node_modules is never
// instrumented, so the waiver would now only be a hole.

import {createHash} from 'node:crypto'
import {readFileSync} from 'node:fs'
import {describe, expect, it} from 'vitest'
import {LLMS_STRUCTURE_SPEC_VERSION} from '@j0nathan-ll0yd/estate-contracts/llms-structure'

/** The spec version this repo's rule catalog and property suite were written against. */
const EXPECTED_SPEC_VERSION = 3

const REFERENCE_URL = new URL(import.meta.resolve('@j0nathan-ll0yd/estate-contracts/llms-structure'))
const SIDECAR_URL = new URL('reference.mjs.sha256', REFERENCE_URL)

// Read once, as bytes: a line-ending rewrite must fail the digest, and reading
// as utf8 then re-encoding could mask one.
const referenceBytes = readFileSync(REFERENCE_URL)
const sidecarFields = readFileSync(SIDECAR_URL, 'utf8').trim().split(/\s+/)

describe('the shipped llms-structure reference is intact', () => {
  it('the reference agrees with the sidecar the package ships beside it', () => {
    const digest = createHash('sha256').update(referenceBytes).digest('hex')

    expect(digest, 'the shipped reference disagrees with its own sidecar -- reinstall with pnpm install --frozen-lockfile').toBe(sidecarFields[0])
  })

  it('the sidecar is the two-field format, not a bare hash', () => {
    // The digest assertion above reads only the first field, so a sidecar rewritten to a BARE hash
    // would still pass there. An `awk '{print $1}'` one-liner did exactly that to one of these
    // files once and silently broke the format for every consumer, so assert the format itself.
    expect(sidecarFields).toStrictEqual([sidecarFields[0], 'reference.mjs'])
  })

  it('declares the spec version this repo was written against', () => {
    // Guards the other direction, and it is the assertion with real teeth. Bytes and sidecar always
    // agree with each other -- they ship together -- so only this catches a release that changed
    // the RULE. Bytes could legitimately change while the rules stay compatible, but a rule change
    // MUST bump this, and the bump must be reviewed on both sides.
    expect(LLMS_STRUCTURE_SPEC_VERSION).toBe(EXPECTED_SPEC_VERSION)
  })
})
