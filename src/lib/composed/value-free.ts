// The value-free pages (atlas decision 0160, PR B): what `/` shows while the focus value hides, the
// gate is shut over a visible value, or the focus signal cannot be read. The website build composes
// them with the same composer as the data-bearing artifact (scripts/build-composer.mjs --value-free),
// so they carry the same markup and scoped-style hashes, and no export value. The Worker reads them
// once per isolate through the ASSETS binding.
import {HIDING_FOCUS_MODES} from '@j0nathan-ll0yd/portal-contract/constants'
import {checkValueFree, GATE_VARIANT, UNREADABLE_VARIANT, type ValueFreePage, type ValueFreeSet} from './artifact'

/** Every variant the Worker can ask for. A set without one of them is not used at all. */
export const VALUE_FREE_VARIANTS: readonly string[] = Object.freeze([...HIDING_FOCUS_MODES, GATE_VARIANT, UNREADABLE_VARIANT])

let cached: {key: string; set: Promise<ValueFreeSet | null>} | null = null

/** The checked set for build `build`, once per isolate; null when the asset is missing or another build's. */
export function valueFreeFor(build: string, read: () => Promise<Response>): Promise<ValueFreeSet | null> {
  const key = build
  if (!cached || cached.key !== key) {
    const set = read().then(async (response) => (response.ok ? checkValueFree(await response.text(), build, VALUE_FREE_VARIANTS) : null))
    cached = {key, set}
    // A failed read is not cached: the next request reads the asset again.
    set.then((value) => {
      if (value === null && cached?.set === set) {
        cached = null
      }
    }, () => {
      if (cached?.set === set) {
        cached = null
      }
    })
  }
  return cached.set
}

/**
 * The page for a suppressed read (its hiding value, or the gate) or an unreadable focus signal. A
 * checked set holds every variant in VALUE_FREE_VARIANTS, so null means a hiding value the build did not
 * know, and the Worker serves the data-free page.
 */
export function valueFreeVariant(
  set: ValueFreeSet,
  read: {kind: 'suppressed'; currentFocus: string | null} | {kind: 'focus-unreadable'}
): ValueFreePage | null {
  const key = read.kind === 'focus-unreadable' ? UNREADABLE_VARIANT : read.currentFocus ?? GATE_VARIANT
  return set.variants[key] ?? null
}

export function resetValueFreeForTest(): void {
  cached = null
}
