// pnpm-build-only -- the Worker compiles its generated modules only in the pass that checked them
// (atlas decision 0164 row 1; review of website #429, M1).
//
// The Worker compiles in two generated modules: the cut of the data-free page
// (src/lib/composed/shell.generated.ts, scripts/build-shell.mjs) and the value-free pages the Worker's
// own allowlist admitted (src/lib/composed/value-free.generated.ts, scripts/build-value-free.mjs). The
// Worker does not check the value-free pages when it serves them, so the build gate is their only
// check. `pnpm build` (scripts/build-site.mjs) deletes both modules, writes them through their gates
// between its two `astro build` passes, and sets BUILD_SITE_PASS_VARIABLE on the second pass only. This
// plugin fails any build that loads either module without that marker: a direct `astro build` would
// otherwise compile a stale or hand-edited module that no gate checked.
//
// `apply: 'build'`: `astro dev` and the test runners run Vite in serve mode, and keep the modules.
// Self-test: tests/unit/pnpm-build-only.test.ts. tests/build/pnpm-build-only.test.ts runs a real
// `astro build` without the marker and requires it to fail.

/** The environment variable scripts/build-site.mjs sets on the `astro build` pass that compiles the modules in. */
export const BUILD_SITE_PASS_VARIABLE = 'HD_BUILD_SITE_PASS'
/** Its value: the second pass, after the gates wrote the modules. */
export const BUILD_SITE_PASS = '2'
/** The modules the Worker compiles in, by their path in the repository. */
export const GENERATED_MODULES = Object.freeze(['src/lib/composed/shell.generated.ts', 'src/lib/composed/value-free.generated.ts'])

/** The generated module a resolved module id names, or null. */
export function generatedModule(id) {
  const file = id.replace(/\\/g, '/').split('?')[0]
  return GENERATED_MODULES.find((module) => file.endsWith('/' + module)) ?? null
}

function failure(module) {
  return 'pnpm-build-only: this build compiles ' +
    module +
    ', but scripts/build-site.mjs did not start it. Only `pnpm build` compiles the generated modules,' +
    ' right after their gates checked them; a direct `astro build` would compile whatever file is on disk' +
    ' (atlas decision 0164 row 1). Run `pnpm build`.'
}

/** The Vite plugin. `env` is the process environment; a test passes its own. */
export function pnpmBuildOnly(env = process.env) {
  return {
    name: 'pnpm-build-only',
    apply: 'build',
    enforce: 'pre',
    load(id) {
      const module = generatedModule(id)
      if (module !== null && env[BUILD_SITE_PASS_VARIABLE] !== BUILD_SITE_PASS) {
        this.error(failure(module))
      }
      return null
    }
  }
}
