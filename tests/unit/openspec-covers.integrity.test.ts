// Integrity of the openspec-covers contract this repo CONSUMES, not of a copy it keeps.
//
// Until atlas decision 0079 item 4 wave 2b the rule was vendored at scripts/vendor/openspec-covers.mjs
// and this file pinned its sha256 as a literal, refusing to read the sidecar vendored beside it --
// because a coordinated local edit could move bytes and sidecar together. That reasoning does not
// survive the migration and must not be cargo-culted through it: the bytes now ship in a
// lockfile-pinned tarball this repo cannot write to, so reading the shipped sidecar is the
// documented consumption path (package README, "Locating a `.sha256` sidecar"). What replaced the
// literal is the lockfile integrity hash plus the three assertions below.
//
// Sidecars ship but are deliberately NOT `exports` subpaths: `.sha256` is neither a code nor an
// asset extension, so declaring one would classify INDETERMINATE under the export-surface rule and
// poison that package's own surface verdict permanently. They are located relative to the tier's
// reference module URL instead.

import {describe, expect, it} from 'vitest'
import {readFileSync} from 'node:fs'
import {createHash} from 'node:crypto'
import {COVERS_SPEC_VERSION} from '@j0nathan-ll0yd/estate-contracts/openspec-covers'

/**
 * The covers spec version this repo's openspec/ tree was written against.
 *
 * Kept in lockstep with EXPECTED_SPEC_VERSION in scripts/openspec-covers.mjs, which is the blocking
 * CI gate. This is the assertion with real teeth: bytes agreeing with their own sidecar is a
 * corrupted-install check, but a version bump means the RULE moved and openspec/ has to move with
 * it. v4 added `requirement-without-scenario`.
 */
const EXPECTED_SPEC_VERSION = 4

const REFERENCE_URL = new URL(import.meta.resolve('@j0nathan-ll0yd/estate-contracts/openspec-covers'))
const SIDECAR_URL = new URL('reference.mjs.sha256', REFERENCE_URL)

// Read as bytes, not utf8: a line-ending rewrite must fail the digest, and reading as utf8 then
// re-encoding could mask one.
const referenceBytes = readFileSync(REFERENCE_URL)
const sidecarFields = readFileSync(SIDECAR_URL, 'utf8').trim().split(/\s+/)

describe('the shipped openspec-covers contract is intact', () => {
  it('the rule agrees with the sidecar the package ships beside it', () => {
    const digest = createHash('sha256').update(referenceBytes).digest('hex')

    expect(digest, 'the shipped rule disagrees with its own sidecar -- reinstall with pnpm install --frozen-lockfile').toBe(sidecarFields[0])
  })

  it('the sidecar is the two-field format, not a bare hash', () => {
    // The digest assertion above reads only the first field, so a sidecar rewritten to a BARE hash
    // would still pass there. An `awk '{print $1}'` one-liner did exactly that to one of these
    // files once and silently broke the format for every consumer, so assert the format itself.
    expect(sidecarFields).toStrictEqual([sidecarFields[0], 'reference.mjs'])
  })

  it('declares the spec version this repo was written against', () => {
    // Guards the other direction. Bytes and sidecar always agree with each other -- they ship
    // together -- so only this catches a release that changed the RULE. A bump reds here and in
    // the blocking gate until openspec/ is reconciled and both constants move in one change.
    expect(COVERS_SPEC_VERSION).toBe(EXPECTED_SPEC_VERSION)
  })
})
