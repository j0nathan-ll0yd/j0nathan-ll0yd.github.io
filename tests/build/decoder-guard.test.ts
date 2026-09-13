import {readdirSync, readFileSync} from 'fs'
import path from 'path'
import {describe, expect, it} from 'vitest'

// THE DECODER'S OWN-PROPERTY GUARD, ASSERTED IN THE FORM THIS REPO ACTUALLY SHIPS.
//
// `decodeArtifact(key, value)` from @j0nathan-ll0yd/portal-contract selects a validator from a
// table of generated validators and admits the key with `Object.hasOwn`. That single call is the
// whole gate: choose an inherited name instead and the "validator" becomes `Object`, which returns
// a truthy object for every input, so an arbitrary payload decodes as valid.
//
// WHY THE UNIT SUITE CANNOT COVER THIS. The producer reads its table through `import * as
// validators`. A native ESM module namespace has a NULL prototype, so under vitest `key in
// validators` and `Object.hasOwn(validators, key)` agree and neither form admits `constructor`.
// A BUNDLER materialises that namespace as a plain object rooted at `Object.prototype`, and there
// the two forms disagree: `'constructor' in ns` is true. This repo bundles it into the live
// production chunk, so the bundle is the only place the guard is load-bearing and therefore the
// only place a test can pin it. The consumer-side contract test lives in tests/unit/api.test.ts
// and says so explicitly.
//
// MEASURED, in the shipped chunk: replacing `Object.hasOwn(validators, key)` with
// `key in validators` in the published package leaves the whole unit suite green and reds this
// file, with `decodeArtifact('constructor', {evil: 1})` returning `{evil: 1}` instead of throwing.
//
// A TEXT ASSERTION, DELIBERATELY, and this is its limit. Importing the chunk would execute the
// live-data runtime (DOM writes, polling timers) inside the build suite. `Object.hasOwn` is a
// global member access that survives minification verbatim, so the guard's presence is readable
// from the emitted bytes even though its behaviour is not. If a bundler upgrade reshapes this
// expression the test reds loudly and a human re-reads the chunk -- the fail-safe direction.
const astroDir = path.resolve(process.cwd(), 'dist', '_astro')

// The producer's own message literal, the stable anchor: it is a string the generated decoder
// emits and no minifier renames.
const DECODER_THROW = 'Unknown artifact resource'

// `if (!Object.hasOwn(<table>, <key>)) throw TypeError(...)`, minified. Whitespace is optional
// because the emitted form carries none.
const OWN_PROPERTY_GATE = /!\s*Object\.hasOwn\(\s*[A-Za-z_$][\w$]*\s*,\s*[A-Za-z_$][\w$]*\s*\)\s*\)\s*throw\s+TypeError\(`Unknown artifact resource/

function chunksContainingDecoder(): {file: string; source: string}[] {
  return readdirSync(astroDir).filter((file) => file.endsWith('.js')).map((file) => ({file, source: readFileSync(path.join(astroDir, file), 'utf-8')}))
    .filter(({source}) => source.includes(DECODER_THROW))
}

describe('bundled artifact decoder', () => {
  it('ships the decoder into a production chunk at all', () => {
    // A decoder that vanished from the bundle is the defect this whole layer exists to prevent
    // (atlas decision 0124 section 5): arriving bodies would reach the UI unchecked again.
    expect(chunksContainingDecoder().map((c) => c.file).length).toBeGreaterThan(0)
  })

  it('admits a resource key by own property, never by prototype-chain membership', () => {
    for (const {file, source} of chunksContainingDecoder()) {
      // Every occurrence, not the first: a second bundled copy with a weaker gate is the same
      // defect wearing a different chunk name.
      let index = source.indexOf(DECODER_THROW)
      while (index !== -1) {
        // 120 chars is comfortably wider than the emitted gate and narrow enough that an unrelated
        // `Object.hasOwn` elsewhere in the chunk cannot drift into the window and vouch for it.
        const window = source.slice(Math.max(0, index - 120), index + DECODER_THROW.length)
        expect({file, window: OWN_PROPERTY_GATE.test(window) ? 'own-property gate' : window}).toEqual({file, window: 'own-property gate'})
        index = source.indexOf(DECODER_THROW, index + 1)
      }
    }
  })
})
