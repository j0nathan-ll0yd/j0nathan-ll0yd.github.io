// The value-free pages, checked at build time and compiled into the Worker (atlas decision 0164 row 1;
// owner decision 2026-11-01).
//
// scripts/build-value-free.mjs writes ./value-free.generated.ts from this build's composer after the
// Worker's own allowlist admitted every variant; `pnpm build` runs it between its two `astro build`
// passes (scripts/build-site.mjs), so the second Worker bundle compiles it in, and
// `build-value-free.mjs --check` proves it. Any other build that loads the module fails
// (scripts/vite-pnpm-build-only.mjs), so no module the gate did not check reaches the Worker. The
// module is gitignored: on a fresh checkout this glob finds nothing, and the Worker serves the data-free
// page wherever it would serve a value-free one. After a local build, `astro dev` and the unit tests
// find that build's module; the Worker uses it only when its build is the Worker's own (./value-free.ts
// `valueFreeFor`).
import {type CompiledValueFree, type GeneratedValueFreeModule, loadCompiledValueFree} from './value-free'

const found = import.meta.glob<GeneratedValueFreeModule>('./value-free.generated.ts', {eager: true})

/**
 * The compiled set and the sha256 the build checked, or null when this bundle has none or its module
 * does not convert (./value-free.ts `loadCompiledValueFree`): a throw here would fail every route.
 */
export const COMPILED_VALUE_FREE: CompiledValueFree | null = loadCompiledValueFree(found['./value-free.generated.ts'])
