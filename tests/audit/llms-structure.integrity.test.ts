// Consumer-side byte and spec-version pin for the shared llms-structure reference.
// Re-vendor the canonical file, sidecar, and constants together; never hand-edit the copy.
// Digest assertions stand down only while Stryker has instrumented this same file, because the
// mutation run intentionally changes its bytes. The normal unit suite always checks the real pin.

import {createHash} from 'node:crypto'
import {readFileSync} from 'node:fs'
import {dirname, resolve} from 'node:path'
import {fileURLToPath} from 'node:url'
import {describe, expect, it} from 'vitest'
import {LLMS_STRUCTURE_SPEC_VERSION} from '../../scripts/audit/lib/llms-structure.mjs'

/** sha256 of the canonical v3 reference. Shared, verbatim, with the producer's pin. */
const LLMS_STRUCTURE_SHA256 = '50ac4620b1981486f92e285f497e6e8a90fbc8c8bb2bd2272698550f4d6662fc'

/** The spec version this repo's rule catalog and property suite were written against. */
const EXPECTED_SPEC_VERSION = 3

const REFERENCE_PATH = resolve(dirname(fileURLToPath(import.meta.url)), '../../scripts/audit/lib/llms-structure.mjs')
const SIDECAR_PATH = `${REFERENCE_PATH}.sha256`

// Read once, as bytes: a line-ending rewrite must fail the digest, and reading
// as utf8 then re-encoding could mask one.
const referenceBytes = readFileSync(REFERENCE_PATH)

// Stryker's instrumentation preamble declares a per-file namespace and a mutant
// switch. Detecting it in the BYTES is the robust test, not an env var or a
// global: the question the digest assertions ask is "are these the shipped
// bytes?", so the waiver must key on the same bytes. Anything else on disk --
// a hand-edit, a formatter pass, a re-vendor from the wrong revision -- carries
// no marker, so the assertions run and fail, which is the whole point.
const STRYKER_INSTRUMENTATION_MARKERS = ['stryMutAct_', '__stryker']
const isInstrumented = STRYKER_INSTRUMENTATION_MARKERS.some((marker) => referenceBytes.includes(marker))

describe('vendored llms-structure reference', () => {
  it.skipIf(isInstrumented)('is byte-identical to the pinned canonical reference', () => {
    const digest = createHash('sha256').update(referenceBytes).digest('hex')

    expect(digest, 'vendored reference drifted from the pin -- re-vendor rather than hand-edit').toBe(LLMS_STRUCTURE_SHA256)
  })

  it('declares the spec version this repo was written against', () => {
    // Guards the other direction: bytes could legitimately change while the
    // rules stay compatible, but a rule change MUST bump this, and a bump must
    // be reviewed on both sides. Reads the imported constant, so it holds under
    // instrumentation too -- stryker has no numeric-literal mutator.
    expect(LLMS_STRUCTURE_SPEC_VERSION).toBe(EXPECTED_SPEC_VERSION)
  })

  it.skipIf(isInstrumented)('carries the canonical .sha256 sidecar, declaring the same digest', () => {
    // The sidecar is copied from atlas alongside the reference. Checking it
    // against the same constant catches a half-done re-vendor -- new bytes with
    // the old sidecar, or a sidecar copied without its file. Waived alongside
    // the digest above: the two are one fact about a pristine tree.
    const declared = readFileSync(SIDECAR_PATH, 'utf-8').trim().split(/\s+/)[0]

    expect(declared, 'the .sha256 sidecar disagrees with the pin -- re-vendor both files together').toBe(LLMS_STRUCTURE_SHA256)
  })
})
