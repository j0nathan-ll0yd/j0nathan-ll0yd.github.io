// tests/audit/llms-structure.integrity.test.ts -- the CONSUMER-side integrity
// pin for the vendored shared structural validator. Mirrors the producer's
// test/contracts/llms-structure.integrity.test.ts in mantle-LifegamesPortal.
//
// scripts/audit/lib/llms-structure.mjs is a VERBATIM copy of the canonical
// reference at atlas contracts/llms-structure/reference.mjs. Producer and
// consumer running the same bytes is the whole point: a file that passes on one
// side cannot fail on the other for a reason neither side can see.
//
// UNTIL THIS FILE, THAT WAS ASSERTED AND NOT CHECKED HERE. The producer pinned
// its copy by sha256; this repo carried only a comment saying the copy was
// pinned. A local edit, a formatter touching the file, or a re-vendor from a
// different revision would all have gone unnoticed on the consumer side. The
// adversarial review of the Phoenix feature working model raised that asymmetry
// as HIGH; these three assertions close it.
//
// TO RE-VENDOR: copy the canonical bytes over the file, copy the canonical
// .sha256 sidecar next to it, update LLMS_STRUCTURE_SHA256 and the expected spec
// version below in the SAME commit, and re-vendor on the producer side too.
// Never hand-edit the vendored copy.
//
// The vendored file is excluded from dprint (dprint.json `excludes`), as it is
// on the producer side, so a formatter run cannot silently break the digest.
// dprint's `includes` covers scripts/**/*.mjs, so without that exclude a
// `pnpm run format` would have been one config bump away from reformatting it.

import {createHash} from 'node:crypto'
import {readFileSync} from 'node:fs'
import {dirname, resolve} from 'node:path'
import {fileURLToPath} from 'node:url'
import {describe, expect, it} from 'vitest'
import {LLMS_STRUCTURE_SPEC_VERSION} from '../../scripts/audit/lib/llms-structure.mjs'

/** sha256 of the canonical v3 reference. Shared, verbatim, with the producer's pin. */
const LLMS_STRUCTURE_SHA256 = 'bb9a6db74e226626fa105be032cb984f478571a3ec9607ce7e4d513a7baf42c1'

/** The spec version this repo's rule catalog and property suite were written against. */
const EXPECTED_SPEC_VERSION = 3

const REFERENCE_PATH = resolve(dirname(fileURLToPath(import.meta.url)), '../../scripts/audit/lib/llms-structure.mjs')
const SIDECAR_PATH = `${REFERENCE_PATH}.sha256`

describe('vendored llms-structure reference', () => {
  it('is byte-identical to the pinned canonical reference', () => {
    // Read as bytes, not text: a line-ending rewrite must fail this, and reading
    // as utf8 then re-encoding could mask one.
    const digest = createHash('sha256').update(readFileSync(REFERENCE_PATH)).digest('hex')

    expect(digest, 'vendored reference drifted from the pin -- re-vendor rather than hand-edit').toBe(LLMS_STRUCTURE_SHA256)
  })

  it('declares the spec version this repo was written against', () => {
    // Guards the other direction: bytes could legitimately change while the
    // rules stay compatible, but a rule change MUST bump this, and a bump must
    // be reviewed on both sides.
    expect(LLMS_STRUCTURE_SPEC_VERSION).toBe(EXPECTED_SPEC_VERSION)
  })

  it('carries the canonical .sha256 sidecar, declaring the same digest', () => {
    // The sidecar is copied from atlas alongside the reference. Checking it
    // against the same constant catches a half-done re-vendor -- new bytes with
    // the old sidecar, or a sidecar copied without its file.
    const declared = readFileSync(SIDECAR_PATH, 'utf-8').trim().split(/\s+/)[0]

    expect(declared, 'the .sha256 sidecar disagrees with the pin -- re-vendor both files together').toBe(LLMS_STRUCTURE_SHA256)
  })
})
