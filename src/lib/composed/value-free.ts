// The value-free pages (atlas decision 0160, PR B): what `/` shows while the focus value hides, the
// gate is shut over a visible value, or the focus signal cannot be read. The website build composes
// them with the same composer as the data-bearing artifact (`composeValueFree`), so they carry the
// same markup and scoped-style hashes, and no export value.
//
// The build checks every variant with the Worker's own allowlist and compiles the checked set into
// the Worker (scripts/build-value-free.mjs, ./compiled-value-free.ts; atlas decision 0164 row 1,
// owner decision 2026-11-01). The Worker does not read, parse or check them when it serves them: it
// looks the variant up, and still checks the build and the shell fit (src/lib/data-plane/ssr-response.ts).
import {HIDING_FOCUS_MODES} from '@j0nathan-ll0yd/portal-contract/constants'
import {type CheckedValueFreePage, type CheckedValueFreeSet, fromWireFacts, GATE_VARIANT, UNREADABLE_VARIANT, type ValueFreeSet} from './artifact'

/** Every variant the Worker can ask for. The build refuses a set without one of them, or with another. */
export const VALUE_FREE_VARIANTS: readonly string[] = Object.freeze([...HIDING_FOCUS_MODES, GATE_VARIANT, UNREADABLE_VARIANT])

/** The module scripts/build-value-free.mjs writes (src/lib/composed/value-free.generated.ts). */
export interface GeneratedValueFreeModule {
  /** The sha256 of the JSON text of VALUE_FREE_SET: the bytes the build checked. */
  VALUE_FREE_SHA256: string
  /** The set the build's gate admitted (./artifact.ts `checkValueFreeSet`), with the facts in wire form. */
  VALUE_FREE_SET: ValueFreeSet
}

/** A compiled set as the Worker holds it: the facts as sets, for the shell check. */
export interface CompiledValueFree {
  set: CheckedValueFreeSet
  /**
   * The sha256 the build checked: the marker `build-value-free.mjs --check` requires exactly one
   * Worker module to carry. Nothing reads it at request time.
   */
  sha256: string
}

/** The generated module as a compiled set. The build checked its shape, so this only converts. */
export function compiledValueFree(generated: GeneratedValueFreeModule): CompiledValueFree {
  const {build, variants} = generated.VALUE_FREE_SET
  const checked: Record<string, CheckedValueFreePage> = {}
  for (const [key, page] of Object.entries(variants)) {
    checked[key] = {summary: page.summary, fragments: page.fragments, facts: fromWireFacts(page.facts)}
  }
  return {set: {build, variants: checked}, sha256: generated.VALUE_FREE_SHA256}
}

/**
 * The compiled set the Worker holds, or null (review of website #429, M3). It runs at module scope,
 * when the Worker starts, where a throw would take every route down. A module the build's gate
 * admitted converts without a throw; one that skipped the gate may not. So a module that does not
 * convert serves the data-free page wherever a value-free page would answer, logs why, and leaves
 * every other route up. Null too when the bundle holds no module.
 */
export function loadCompiledValueFree(generated: GeneratedValueFreeModule | undefined): CompiledValueFree | null {
  if (generated === undefined) {
    return null
  }
  try {
    return compiledValueFree(generated)
  } catch (error) {
    // The reason names the conversion that failed (a TypeError on the module's shape), never a value.
    console.error(`[value-free] the compiled value-free pages cannot be used, so hiding and unreadable answers serve the data-free page: ${String(error)}`)
    return null
  }
}

/**
 * The value-free set the Worker of build `build` serves: the compiled set, when the build that
 * compiled it is this one; otherwise null, and the Worker serves the data-free page. A Worker with no
 * compiled set (a fresh checkout) gets null too. `unknown` is the id of a build without one; two of
 * them never prove the same build (review L9).
 */
export function valueFreeFor(build: string, compiled: CompiledValueFree | null): CheckedValueFreeSet | null {
  return compiled !== null && compiled.set.build === build && build !== 'unknown' ? compiled.set : null
}

/**
 * The page for a suppressed read (its hiding value, or the gate) or an unreadable focus signal. The
 * build compiled in every variant in VALUE_FREE_VARIANTS, so null means a hiding value the build did
 * not know; the Worker then serves the data-free page.
 */
export function valueFreeVariant(
  set: CheckedValueFreeSet,
  read: {kind: 'suppressed'; currentFocus: string | null} | {kind: 'focus-unreadable'}
): CheckedValueFreePage | null {
  const key = read.kind === 'focus-unreadable' ? UNREADABLE_VARIANT : read.currentFocus ?? GATE_VARIANT
  return Object.hasOwn(set.variants, key) ? set.variants[key] ?? null : null
}
