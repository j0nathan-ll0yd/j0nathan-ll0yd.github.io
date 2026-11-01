// The value-free pages, checked at build time and compiled into the Worker (atlas decision 0164 row 1;
// owner decision 2026-11-01).
//
// scripts/build-value-free.mjs writes ./value-free.generated.ts from this build's composer after the
// Worker's own allowlist admitted every variant; `pnpm build` runs it between its two `astro build`
// passes (scripts/build-site.mjs), so the second Worker bundle compiles it in, and
// `build-value-free.mjs --check` proves it. The module is gitignored: on a fresh checkout this glob
// finds nothing, and the Worker serves the data-free page wherever it would serve a value-free one.
// After a local build, `astro dev` and the unit tests find that build's module; the Worker uses it only
// when its build is the Worker's own (./value-free.ts `valueFreeFor`).
import {type CompiledValueFree, compiledValueFree, type GeneratedValueFreeModule} from './value-free'

const found = import.meta.glob<GeneratedValueFreeModule>('./value-free.generated.ts', {eager: true})

/** The compiled set and the sha256 the build checked, or null when this bundle has none. */
export const COMPILED_VALUE_FREE: CompiledValueFree | null = (() => {
  const generated = found['./value-free.generated.ts']
  return generated === undefined ? null : compiledValueFree(generated)
})()
